// バトル道場：クラスメイト31人のデータ・1試合の進行・コンピュータのくせ・記録と報酬
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './fake-d1.js';
import * as D from '../src/db.js';
import {
  defaultClassmates, sanitizeClassmates, classmateByNo, DOJO_SIZE, TEACHER_NO, TEACHER_RULER, CLEAR_REWARD, STYLES, tierOf, DOJO_PATTERNS, TITLES,
} from '../public/shared/dojo.js';
import { DojoCore, runCpu, planDojoShot, decideDojoNow, ME } from '../public/shared/dojo-core.js';
import { cpuLoadout } from '../src/dojo-host.js';
import { ITEMS, sanitizeConfig, resolveLoadout, GACHA_POOL, applyConfig } from '../public/shared/catalog.js';
import { SKILLS } from '../public/shared/rules.js';
import { sanitizeAvatar, parsePartId, partOf } from '../public/shared/avatar.js';
import Physics from '../public/shared/physics.js';

const db = await createFakeD1();
const skip = !db && 'この Node には node:sqlite がないため省略';
if (db) await D.ensureSchema(db);
let n = 0;
const newUser = async () => (await D.upsertGoogleUser(db, 'dj' + (++n), '道場' + n)).user;

test('クラスメイト：30人＋担任。番号順・班長・学級委員長・定規・必殺技・報酬が依頼のとおり', () => {
  const list = defaultClassmates();
  assert.equal(list.length, 31);
  assert.deepEqual(list.map((c) => c.no), Array.from({ length: 31 }, (_, i) => i + 1));
  assert.deepEqual(list.filter((c) => c.rank === 'leader').map((c) => c.no), [5, 10, 15, 20, 25]);
  assert.equal(classmateByNo(list, 30).rank, 'president');
  assert.equal(classmateByNo(list, TEACHER_NO).ruler, TEACHER_RULER);
  assert.equal(classmateByNo(list, TEACHER_NO).skill, 'shizuka');
  // 1〜5番は必殺技なし、6〜10番はN定規に道場だけの技
  for (let no = 1; no <= 5; no++) { assert.equal(classmateByNo(list, no).skill, 'none'); assert.equal(classmateByNo(list, no).skillUse, 'none'); }
  assert.deepEqual([6, 7, 8, 9, 10].map((no) => classmateByNo(list, no).skill), ['heal', 'heavy', 'double', 'anchor', 'bomb']);
  for (let no = 1; no <= 10; no++) assert.equal(ITEMS[classmateByNo(list, no).ruler].rarity, 'N');
  // 26〜30番はSSR（5本すべて）
  const ssr = [26, 27, 28, 29, 30].map((no) => ITEMS[classmateByNo(list, no).ruler]);
  assert.ok(ssr.every((it) => it.rarity === 'SSR'));
  assert.equal(new Set(ssr.map((it) => it.id)).size, 5);
  // Lv：1班1・2班2・3班4・4班6・5班8・6班9・30番と先生10
  assert.deepEqual([1, 6, 11, 16, 21, 26, 30, 31].map((no) => classmateByNo(list, no).level), [1, 2, 4, 6, 8, 9, 10, 10]);
  // 狙いのずれは番号が進むほど小さく、班長は少し強い
  assert.equal(classmateByNo(list, 1).aim, 15);
  assert.equal(classmateByNo(list, 5).aim, 14);
  assert.equal(classmateByNo(list, 30).aim, 2);
  assert.ok(classmateByNo(list, 29).aim > classmateByNo(list, 30).aim);
  // 報酬は全部ある持ち物で、見た目はどのパーツもある（もらえるパーツを身につけている）
  for (const c of list) {
    assert.ok(STYLES[c.style], `${c.name} のくせ`);
    assert.deepEqual(sanitizeAvatar(c.avatar, c.id), c.avatar, `${c.name} の見た目`);
    for (const id of c.reward) {
      assert.ok(ITEMS[id], `${c.name} の報酬 ${id}`);
      const at = parsePartId(id);
      if (at) { assert.equal(c.avatar[at.slot], at.key); assert.equal(partOf(at.slot, at.key).basic, false, `${id} は報酬のパーツ`); }
    }
    if (c.rank === 'leader') assert.ok(c.reward.some((id) => ITEMS[id].kind === 'pattern'), '班長は定規の柄');
  }
  // 見分けがつく：見た目がみんな違う
  assert.equal(new Set(list.map((c) => JSON.stringify(c.avatar))).size, 31);
  assert.ok(classmateByNo(list, 31).reward.includes('title:sotsugyo'));
  for (const id of CLEAR_REWARD) assert.ok(ITEMS[id], id);
});

test('道場だけの品（柄・称号）はガチャに出ない。先生の技は銘柄には付けられない', () => {
  for (const it of [...DOJO_PATTERNS, ...TITLES]) assert.ok(!GACHA_POOL.some((g) => g.id === it.id), it.id);
  assert.ok(SKILLS.shizuka.teacher);
  const cfg = sanitizeConfig({ brands: { 'ruler:straight30-acrylic': { skill: 'shizuka' } } });
  assert.ok(!cfg.brands['ruler:straight30-acrylic']?.skill);
});

test('設定でクラスメイトを変えられる：範囲の外・ない定規・ない持ち物は直す。先生の定規は変えられない', () => {
  const edited = sanitizeClassmates([
    { id: 'c06', name: '新しい名前', role: '保健委員', ruler: 'ruler:nothing', skill: 'shizuka', style: 'push', skillUse: 'pick', aim: 99, powerErr: -5, samples: 500, level: 30,
      lines: { enter: 'こんにちは', win: '勝った', lose: '' }, reward: ['avatar:item:ball', 'pattern:nothing'] },
    { id: 'teacher', ruler: 'ruler:straight15-metal', skill: 'heal' },
  ], { isRuler: (id) => !!ITEMS[id], itemOk: (id) => !!ITEMS[id] });
  const c6 = edited.find((c) => c.no === 6);
  assert.equal(c6.name, '新しい名前');
  assert.equal(c6.role, '保健委員');
  assert.equal(c6.ruler, 'ruler:tri60-rubber', 'ない定規は元のまま');
  assert.equal(c6.skill, 'heal', '先生の技は生徒には付けられない');
  assert.equal(c6.style, 'push');
  assert.equal(c6.aim, 45); assert.equal(c6.powerErr, 0); assert.equal(c6.samples, 40); assert.equal(c6.level, 10);
  assert.deepEqual(c6.lines, { enter: 'こんにちは', win: '勝った', lose: '' });
  assert.deepEqual(c6.reward, ['avatar:item:ball']);
  const t = edited.find((c) => c.no === TEACHER_NO);
  assert.equal(t.ruler, TEACHER_RULER);
  assert.equal(t.skill, 'heal');
  assert.equal(sanitizeConfig(null).classmates.length, 31);
});

const mkCore = (no, cfg = sanitizeConfig(null)) => {
  const mate = classmateByNo(cfg.classmates, no);
  return new DojoCore({ name: 'わたし', userId: 'u1', loadout: resolveLoadout({ ruler: 'ruler:straight30-acrylic' }, cfg, 3) }, mate, cpuLoadout(mate, cfg));
};

test('1試合：自分が先手。決着すると over になり、記録が1回だけ取れる', () => {
  const core = mkCore(1);
  const st = core.snapshot();
  assert.equal(st.phase, 'aim');
  assert.equal(st.game.turn, 0);
  assert.equal(st.dojo.no, 1);
  assert.equal(st.dojo.lines.enter, 'よーし、1番いくぞ！');
  assert.equal(st.members[1].cpu, true);
  assert.equal(core.skillOf(1), null, '1番は必殺技を使わない');
  // 相手の体力を0にして当てる → 勝ち
  core.s.game.bodies[1].hp = 0.5;
  let guard = 0;
  while (core.s.phase === 'aim' && guard++ < 40) {
    const g = core.s.game;
    if (g.turn === 0) {
      const b = g.bodies[0], f = g.bodies[1];
      const len = Math.hypot(f.x - b.x, f.y - b.y);
      core.handle(ME, { t: 'flick', lx: 0, ly: 0, dx: (f.x - b.x) / len, dy: (f.y - b.y) / len, power: 0.8 });
    } else runCpu(core);
  }
  assert.equal(core.s.phase, 'over');
  const rec = core.takeRecord();
  assert.equal(typeof rec.won, 'boolean');
  assert.equal(rec.no, 1);
  assert.equal(core.takeRecord(), null);
  assert.equal(core.snapshot().dojo.result.won, rec.won);
});

test('先生：黒板用の大きな定規と「静かに！」（相手のゲージを0にする）', () => {
  const core = mkCore(TEACHER_NO);
  const b = core.s.game.bodies[1];
  assert.equal(b.specKey, 'board50-wood');
  assert.equal(Physics.RULERS[b.specKey].shape, 'board50');
  assert.equal(core.skillOf(1), 'shizuka');
  const g = core.s.game;
  g.turn = 1; g.gauge = [90, 100];
  const cpu = core.s.dojo.cpu;
  assert.equal(decideDojoNow(core, 1, cpu, Math.random), true, 'タイミングを選ぶ：相手のゲージが多いとき使う');
  core.handle('C', { t: 'skill' });
  assert.deepEqual(core.s.game.gauge, [0, 0]);
  assert.equal(core.s.game.fx.at(-1).kind, 'shizuka');
});

test('くせ：まっすぐ押すだけは考えずに相手の真ん中へ、弱めにそっとは力が弱い、ずれは±の範囲', () => {
  const core = mkCore(1);
  const g = core.s.game;
  g.turn = 1;
  const me = g.bodies[1], foe = g.bodies[0];
  const shot = planDojoShot(core, 1, { style: 'straight', skillUse: 'none', aim: 0, powerErr: 0, samples: 1 }, () => 0.5);
  const ang = Math.atan2(shot.dy, shot.dx), want = Math.atan2(foe.y - me.y, foe.x - me.x);
  assert.ok(Math.abs(ang - want) < 0.05, 'ずれ0なら相手へまっすぐ');
  for (let k = 0; k < 20; k++) {
    const s = planDojoShot(core, 1, { style: 'soft', skillUse: 'none', aim: 0, powerErr: 0, samples: 2 });
    assert.ok(s.power <= 0.5 + 1e-9, '弱めにそっと');
    const w = planDojoShot(core, 1, { style: 'straight', skillUse: 'none', aim: 10, powerErr: 0, samples: 1 });
    const d = Math.abs(((Math.atan2(w.dy, w.dx) - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    assert.ok(d <= (10 * Math.PI) / 180 + 0.03, '±10°に収まる');
  }
});

test('記録：勝ち→次の番号・初勝利で報酬、負け→1番から。30人破り→称号と着せ替え、先生戦は負けても変わらない', { skip }, async () => {
  const u = await newUser();
  await D.getConfig(db);
  let p = await D.dojoProgress(db, u.id);
  assert.deepEqual([p.next, p.best, p.clears, p.teacherOpen], [1, 0, 0, false]);
  await D.dojoBegin(db, u.id, 1);
  assert.equal((await D.dojoProgress(db, u.id)).playing, 1);
  let r = await D.recordDojo(db, { userId: u.id, no: 1, won: true, ruler: 'ruler:straight30-acrylic', kos: 1 });
  assert.equal(r.first, true);
  assert.deepEqual(r.items, ['avatar:jacket:chalk']);
  assert.ok(r.coins > 0);
  assert.ok(r.exp.gain > 0);
  p = await D.dojoProgress(db, u.id);
  assert.deepEqual([p.next, p.best, p.playing], [2, 1, null]);
  // 2番に負け → 1番から。1番にもう一度勝っても報酬はない
  await D.recordDojo(db, { userId: u.id, no: 2, won: false, ruler: 'ruler:straight30-acrylic' });
  p = await D.dojoProgress(db, u.id);
  assert.deepEqual([p.next, p.best], [1, 1]);
  r = await D.recordDojo(db, { userId: u.id, no: 1, won: true, ruler: 'ruler:straight30-acrylic' });
  assert.equal(r.first, false);
  assert.deepEqual(r.items, []);
  // 途中で閉じた試合：負け、えんぴつと経験値はなし
  const coins0 = (await db.prepare('SELECT coins FROM users WHERE id = ?').bind(u.id).first()).coins;
  r = await D.recordDojo(db, { userId: u.id, no: 2, won: false, abandoned: true });
  assert.equal(r.coins, 0); assert.equal(r.exp, null);
  assert.equal((await db.prepare('SELECT coins FROM users WHERE id = ?').bind(u.id).first()).coins, coins0);
  // 30番に勝つ：30人破り。次は1番、先生に挑める。初回は称号と限定の着せ替え
  await db.prepare('UPDATE dojo SET next = 30 WHERE user_id = ?').bind(u.id).run();
  r = await D.recordDojo(db, { userId: u.id, no: 30, won: true, ruler: 'ruler:straight30-acrylic' });
  assert.equal(r.cleared, true); assert.equal(r.firstClear, true);
  for (const id of CLEAR_REWARD) assert.ok(r.items.includes(id));
  assert.ok(r.items.includes('avatar:jacket:wanshou'));
  p = await D.dojoProgress(db, u.id);
  assert.deepEqual([p.next, p.best, p.clears, p.teacherOpen], [1, 30, 1, true]);
  assert.equal(r.progress.teacherOpen, true);
  // 2回目の30人破りは、称号はもう届かない
  r = await D.recordDojo(db, { userId: u.id, no: 30, won: true, ruler: 'ruler:straight30-acrylic' });
  assert.equal(r.firstClear, false);
  assert.deepEqual(r.items, []);
  assert.equal((await D.dojoProgress(db, u.id)).clears, 2);
  // 先生：負けても何も変わらない。勝つと称号「卒業」と先生の着せ替え
  await db.prepare('UPDATE dojo SET next = 7 WHERE user_id = ?').bind(u.id).run();
  await D.recordDojo(db, { userId: u.id, no: TEACHER_NO, won: false, ruler: 'ruler:straight30-acrylic' });
  assert.equal((await D.dojoProgress(db, u.id)).next, 7);
  r = await D.recordDojo(db, { userId: u.id, no: TEACHER_NO, won: true, ruler: 'ruler:straight30-acrylic' });
  assert.deepEqual(r.items, ['avatar:outfit:jersey', 'avatar:item:shusseki', 'title:sotsugyo']);
  p = await D.dojoProgress(db, u.id);
  assert.deepEqual([p.next, p.teacherWins], [7, 1]);
  // 受け取ると持ち物になり、称号を付けられる（持っていない称号は付けられない）
  await D.claimInbox(db, u.id);
  const owned = await D.ownedSet(db, u.id);
  assert.ok(owned.has('title:sotsugyo') && owned.has('avatar:jacket:tasuki'));
  const av = (await D.avatarOf(db, u.id)).avatar;
  assert.equal((await D.saveAvatar(db, u.id, { ...av, jacket: 'tasuki' }, Date.now(), 'title:gakunen')).title, 'title:gakunen');
  assert.equal((await D.avatarOf(db, u.id)).title, 'title:gakunen');
  assert.equal((await D.saveAvatar(db, u.id, av)).title, 'title:gakunen', '称号を送らなければ今のまま');
  const other = await newUser();
  assert.ok((await D.saveAvatar(db, other.id, (await D.avatarOf(db, other.id)).avatar, Date.now(), 'title:gakunen')).error);
  const prof = await D.profile(db, await db.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first());
  assert.equal(prof.title, 'title:gakunen');
  assert.equal(prof.dojo.clears, 2);
});

test('えんぴつは対戦と同じ1日の上限に数える', { skip }, async () => {
  const u = await newUser();
  const cfg = await D.getConfig(db);
  await db.prepare('UPDATE users SET battle_day = ?, battle_earned = ? WHERE id = ?').bind(D.jstDay(), cfg.economy.dailyBattleCap - 2, u.id).run();
  const r = await D.recordDojo(db, { userId: u.id, no: 1, won: true, ruler: 'ruler:straight30-acrylic' });
  assert.equal(r.coins, 2);
  assert.equal(r.capped, true);
});

test('くせ「ゲージをためる」の子は、必殺ゲージが1.5倍たまりやすい', () => {
  const core = mkCore(19);
  assert.equal(core.s.game.bodies[1].charge, 37.5);
  assert.equal(mkCore(18).s.game.bodies[1].charge, 25);
});
