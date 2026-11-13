// バトル道場の進行を、1人に1つの Durable Object（名前は dojo:<アカウントID>）で受け持つ。
// 部屋と同じクラス（Room）の中で動かすので、wrangler.jsonc は変えなくてよい。
// 画面からは HTTP で「ようす・始める・はじく・やめる」を送り、結果（自分の1打と、続くクラスメイトの番）をまとめて返す。
// 進み具合（次の番号・最高記録・30人破り）はデータベース。試合の途中はこの Durable Object に保存する。
// 試合の途中で画面を閉じたら、次に道場を開いたとき（または次の試合を始めたとき）に負けにする。
import { DojoCore, runCpu, ME } from '../public/shared/dojo-core.js';
import { classmateByNo, TEACHER_NO, TEACHER_RULER, TEACHER_SPEC, dojoSkillOf } from '../public/shared/dojo.js';
import { resolveLoadout, LEVEL_MAX, DEFAULT_RULER } from '../public/shared/catalog.js';
import { syncMessages } from '../public/shared/stage-core.js';
import { ensureSchema, loadoutFor, getConfig, avatarOf, dojoProgress, dojoBegin, recordDojo } from './db.js';
import { VERSION } from '../public/shared/version.js';

const KEY = 'dojo';
const json = (obj, status = 200) => Response.json(obj, { status, headers: { 'cache-control': 'no-store' } });

// クラスメイトの定規（先生は黒板用の大きな定規）
export function cpuLoadout(mate, cfg) {
  if (mate.ruler === TEACHER_RULER) {
    const base = resolveLoadout({ ruler: DEFAULT_RULER }, cfg, mate.level, LEVEL_MAX);
    return {
      ...base, ruler: null, specKey: TEACHER_SPEC, name: '黒板用の大きな定規', rarity: 'SSR', art: 'board', trait: null, traitPct: 0, tune: cfg.rulers?.[TEACHER_SPEC] || null, // 性能は設定画面の「定規の性能」で変えられる
      skill: dojoSkillOf(mate) === 'none' ? base.skill : dojoSkillOf(mate) || 'shizuka',
    };
  }
  const lo = resolveLoadout({ ruler: mate.ruler }, cfg, mate.level, LEVEL_MAX);
  const sk = dojoSkillOf(mate);
  return sk && sk !== 'none' ? { ...lo, skill: sk } : lo;
}

// 途中で終わった試合を負けにする（記録して、保存していた試合を消す）
async function abandon(room, db, user, no) {
  const r = await recordDojo(db, { userId: user.id, no, won: false, abandoned: true });
  room.dojo = null;
  await room.ctx.storage.delete(KEY);
  return { no: r.no, name: r.name, teacher: no === TEACHER_NO };
}

export async function handleDojo(room, request, user) {
  const url = new URL(request.url);
  const path = url.pathname;
  const storage = room.ctx.storage;
  const db = room.env.DB;
  if (!user) return json({ error: 'ログインしてください' }, 401);
  await ensureSchema(db);
  let core = room.dojo;
  if (core === undefined) {
    const saved = await storage.get(KEY);
    core = room.dojo = saved ? DojoCore.restore(saved) : null;
  }
  const save = async () => {
    if (room.dojo) await storage.put(KEY, room.dojo.toJSON());
    else await storage.delete(KEY);
  };
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const mine = core && core.s.members[0]?.userId === user.id;

  // 道場のようす（道場の画面を開いたとき）。途中で閉じた試合があれば、ここで負けにする
  if (path === '/dojo/state') {
    const prog = await dojoProgress(db, user.id);
    let lost = null;
    if (prog.playing) lost = await abandon(room, db, user, prog.playing);
    return json({ progress: await dojoProgress(db, user.id), lost });
  }

  if (path === '/dojo/start' && request.method === 'POST') {
    if (body.version && body.version !== VERSION) return json({ error: '新しい版が公開されています。画面を再読み込みしてください', update: true }, 409);
    let prog = await dojoProgress(db, user.id);
    let lost = null;
    if (prog.playing) { lost = await abandon(room, db, user, prog.playing); prog = await dojoProgress(db, user.id); }
    const teacher = !!body.teacher;
    if (teacher && !prog.teacherOpen) return json({ error: '担任の先生には、30人破りを達成すると挑めます' }, 403);
    const no = teacher ? TEACHER_NO : prog.next;
    const cfg = await getConfig(db);
    const mate = classmateByNo(cfg.classmates, no);
    if (!mate) return json({ error: 'その相手が見つかりません' }, 400);
    const lo = await loadoutFor(db, user.id, body.ruler || null, LEVEL_MAX);
    if (lo.error) return json({ error: lo.error }, 400);
    const av = await avatarOf(db, user.id);
    core = room.dojo = new DojoCore({ name: user.name, userId: user.id, loadout: lo.loadout, avatar: av.avatar, title: av.title }, mate, cpuLoadout(mate, cfg));
    await dojoBegin(db, user.id, no);
    await save();
    return json({ messages: [{ t: 'welcome', you: { id: ME }, state: core.snapshot(), lost }] });
  }

  // やめる：試合の途中なら降参（負け）。決着のあとなら、片付けるだけ
  if (path === '/dojo/quit' && request.method === 'POST') {
    let result = null;
    if (mine && core.s.phase === 'aim') {
      result = await recordDojo(db, { userId: user.id, no: core.s.dojo.no, won: false, abandoned: true });
    }
    room.dojo = null;
    await save();
    return json({ messages: [{ t: 'left' }], result });
  }

  if (path === '/dojo/act' && request.method === 'POST') {
    if (!mine || core.s.phase !== 'aim') return json({ error: '試合が見つかりません。道場からやり直してください', gone: true }, 404);
    if (!['flick', 'skill'].includes(body.t)) return json({ error: 'その操作はできません' }, 400);
    const messages = core.handle(ME, body).map((o) => o.msg);
    if (!messages.some((m) => m.t === 'error')) {
      try {
        messages.push(...runCpu(core));
      } catch (e) {
        // クラスメイトの番で思わぬ失敗があっても、止まらずに自分の番へ戻す
        console.error('クラスメイトの番で失敗', e);
        const g = core.s.game;
        if (core.s.phase === 'aim' && g) { g.turn = 0; g.extra = false; }
      }
      syncMessages(core, messages);
    }
    // 決着：記録して報酬を配る
    const rec = core.takeRecord();
    if (rec) {
      try {
        const r = await recordDojo(db, { ...rec, userId: user.id });
        messages.push({ t: 'dojo', ...r });
      } catch (e) {
        console.error('道場の記録に失敗', e);
        messages.push({ t: 'error', text: '結果の記録に失敗しました。時間をおいて、道場を開き直してください' });
      }
    }
    await save();
    return json({ messages });
  }
  return json({ error: 'not found' }, 404);
}
