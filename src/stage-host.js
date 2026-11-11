// ステージモードの進行を、1人に1つの Durable Object（名前は stage:<アカウントID>）で受け持つ。
// 部屋と同じクラス（Room）の中で動かすので、wrangler.jsonc は変えなくてよい。
// 画面からは HTTP で「始める・はじく・必殺技・やめる」を送り、結果（自分の1打と、続く敵の番）をまとめて返す。
import { StageCore, runEnemies, syncMessages, ME } from '../public/shared/stage-core.js';
import { STAGES } from '../public/shared/stage.js';
import { STAGE_LEVEL_MAX } from '../public/shared/catalog.js';
import { ensureSchema, loadoutFor, stageProgress, recordStageClear, getConfig } from './db.js';
import { VERSION } from '../public/shared/version.js';

const KEY = 'stage';
export const STAGE_IDLE_MS = 24 * 60 * 60 * 1000; // 1日さわらなかった途中の攻略は片付ける

const json = (obj, status = 200) => Response.json(obj, { status, headers: { 'cache-control': 'no-store' } });

export async function handleStage(room, request, user) {
  const url = new URL(request.url);
  const path = url.pathname;
  const storage = room.ctx.storage;
  const db = room.env.DB;
  if (!user) return json({ error: 'ログインしてください' }, 401);
  let core = room.stage;
  if (core === undefined) {
    const saved = await storage.get(KEY);
    core = room.stage = saved ? StageCore.restore(saved) : null;
  }
  const save = async () => {
    if (room.stage) await storage.put(KEY, room.stage.toJSON());
    else await storage.delete(KEY);
    await storage.setAlarm(Date.now() + STAGE_IDLE_MS);
  };
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  if (body.version && body.version !== VERSION) return json({ error: '新しい版が公開されています。画面を再読み込みしてください', update: true }, 409);

  // 続きの攻略（画面を開き直したとき）
  if (path === '/stage/run') {
    return json({ run: core && core.s.members[0]?.userId === user.id ? { you: { id: ME }, state: core.snapshot() } : null });
  }

  if (path === '/stage/start' && request.method === 'POST') {
    const st = STAGES[body.stage];
    const map = Math.floor(Number(body.map));
    if (!st || !(map >= 1 && map <= st.maps.length)) return json({ error: 'そのマップはありません' }, 400);
    await ensureSchema(db);
    // マップは1から順に開放される
    const prog = (await stageProgress(db, user.id))[body.stage];
    if (map > prog.cleared + 1) return json({ error: `マップ${prog.cleared + 1}をクリアすると、次のマップが開放されます` }, 403);
    const lo = await loadoutFor(db, user.id, body.ruler || null, STAGE_LEVEL_MAX);
    if (lo.error) return json({ error: lo.error }, 400);
    const cfg = await getConfig(db);
    core = room.stage = new StageCore(body.stage, map, { name: user.name, userId: user.id, loadout: lo.loadout }, Date.now(), { enemyHp: cfg.enemyHp, enemyHpGrow: cfg.enemyHpGrow });
    await save();
    return json({ messages: [{ t: 'welcome', you: { id: ME }, state: core.snapshot() }] });
  }

  if (path === '/stage/quit' && request.method === 'POST') {
    room.stage = null;
    await save();
    return json({ messages: [{ t: 'left' }] });
  }

  if (path === '/stage/act' && request.method === 'POST') {
    if (!core || core.s.members[0]?.userId !== user.id) return json({ error: '攻略中のマップがありません。ステージ選択からやり直してください', gone: true }, 404);
    if (!['flick', 'skill'].includes(body.t)) return json({ error: 'その操作はできません' }, 400);
    const messages = core.handle(ME, body).map((o) => o.msg);
    if (!messages.some((m) => m.t === 'error')) {
      try {
        messages.push(...runEnemies(core));
      } catch (e) {
        // 敵の番で思わぬ失敗があっても、止まらずに自分の番へ戻す
        console.error('敵の番で失敗', e);
        const g = core.s.game;
        if (core.s.phase === 'aim' && g) { g.turn = 0; g.extra = false; }
      }
      syncMessages(core, messages);
    }
    // マップクリア：記録して報酬を配る
    const rec = core.takeRecord();
    if (rec) {
      try {
        await ensureSchema(db);
        const reward = await recordStageClear(db, { ...rec, userId: user.id });
        if (reward) messages.push({ t: 'reward', stage: true, ...reward });
      } catch (e) {
        console.error('ステージの記録に失敗', e);
        messages.push({ t: 'error', text: 'クリアの記録に失敗しました。時間をおいて、もう一度クリアしてください' });
      }
    }
    await save();
    return json({ messages });
  }
  return json({ error: 'not found' }, 404);
}

// 片付けの予約が来たとき（Room の alarm から呼ぶ）。途中の攻略をまだ残すなら true（次の予約を入れる）
export async function stageAlarm(room) {
  const saved = room.stage === undefined ? await room.ctx.storage.get(KEY) : room.stage?.toJSON();
  if (!saved) return false;
  if (Date.now() - (saved.lastActive || 0) >= STAGE_IDLE_MS - 1000) {
    await room.ctx.storage.delete(KEY);
    room.stage = null;
    return false;
  }
  await room.ctx.storage.setAlarm((saved.lastActive || Date.now()) + STAGE_IDLE_MS);
  return true;
}
