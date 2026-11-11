import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StageCore, runEnemies, syncMessages, ME } from '../public/shared/stage-core.js';
import { STAGES, ENEMIES, mapOf, stageMaxHp, BOARD_HEAL, REWARD } from '../public/shared/stage.js';
import { DESKS, deskTiles, onTile, GAUGE } from '../public/shared/rules.js';
import { resolveLoadout, levelInfo, STAGE_LEVEL_MAX, LEVEL_MAX, ITEMS, GACHA_POOL } from '../public/shared/catalog.js';
import Physics from '../public/shared/physics.js';
import { RoomCore } from '../public/shared/core.js';
import { createFakeD1 } from './fake-d1.js';
import * as D from '../src/db.js';
import { handleStage } from '../src/stage-host.js';

const lo = (level = 1, ruler = 'ruler:straight30-acrylic') => resolveLoadout({ ruler }, undefined, level, STAGE_LEVEL_MAX);
const make = (map = 1, level = 1) => {
  const c = new StageCore('kahen', map, { name: 'テスト', loadout: lo(level) });
  c.rand = () => 0.99;
  return c;
};
const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test('どの盤面も、定規と敵は残っている机の上にあり、重なっていない', () => {
  for (const [sid, st] of Object.entries(STAGES)) {
    st.maps.forEach((m, mi) => {
      assert.equal(m.boards.length, mi === st.maps.length - 1 ? 5 : 3, `${sid} マップ${mi + 1} の盤面の数`);
      m.boards.forEach((b, bi) => {
        const desk = DESKS[b.desk];
        assert.ok(desk, `机の並べ方 ${b.desk}`);
        const tiles = deskTiles(desk).filter((t) => !b.tiles || b.tiles.includes(t.i));
        assert.ok(b.foes.length >= 1 && b.foes.length <= 4, '敵は1〜4体');
        const all = [{ spec: 'straight30-acrylic', ...b.me }, ...b.foes.map((f) => ({ spec: f.spec || ENEMIES[f.t].spec, ...f }))];
        const bodies = all.map((x, k) => Physics.createBody('b' + k, k, x.spec, x.x, x.y, x.a ?? 0));
        for (const body of bodies) {
          for (const v of Physics.worldVerts(body)) {
            assert.ok(tiles.some((t) => onTile(t, v.x, v.y)), `${sid} マップ${mi + 1} 盤面${bi + 1}：${body.specKey} がはみ出している (${v.x.toFixed(1)}, ${v.y.toFixed(1)})`);
          }
        }
        for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
          assert.equal(Physics.collide(bodies[i], bodies[j]), null, `${sid} マップ${mi + 1} 盤面${bi + 1}：${bodies[i].specKey} と ${bodies[j].specKey} が重なっている`);
        }
      });
    });
  }
});

test('マップが進むほど、同じ敵の体力が多い', () => {
  const hp1 = make(1).s.game.bodies[1].hp;
  const c3 = make(3);
  const eraser3 = c3.s.game.bodies.find((b) => b.enemy === 'eraser');
  assert.equal(hp1, ENEMIES.eraser.hp);
  assert.ok(eraser3.hp > hp1);
});

test('敵は体力0で倒れ、全部倒すと次の盤面へ。体力は持ち越して少し回復する', () => {
  const c = make(1);
  const g = c.s.game;
  g.bodies[1].hp = 0.5;
  g.bodies[0].hp = 50;
  // 自分の番：消しゴムに当てる
  const me = g.bodies[0], foe = g.bodies[1];
  const len = Math.hypot(foe.x - me.x, foe.y - me.y);
  const out = c.handle(ME, { t: 'flick', lx: 0, ly: 0, dx: (foe.x - me.x) / len, dy: (foe.y - me.y) / len, power: 0.8 });
  assert.equal(out[0].msg.t, 'shot');
  assert.equal(c.s.game.players[1].alive, false, '消しゴムが倒れた');
  assert.equal(c.s.game.boardClear, true);
  const hpAfter = c.s.game.bodies[0].hp;
  const next = runEnemies(c);
  assert.equal(next[0].stage, 'board');
  assert.equal(c.s.stage.board, 1);
  assert.equal(c.s.game.bodies[0].hp, Math.min(stageMaxHp(1), hpAfter + BOARD_HEAL));
  assert.equal(c.s.game.turn, 0);
  assert.equal(c.s.game.bodies.length, 1 + mapOf('kahen', 1).boards[1].foes.length);
});

test('ライフは3つ。2回までは落ちても盤面に戻り、3回目でそのマップは失敗', () => {
  const c = make(1);
  const fall = () => {
    // 机の端で、外向きに強くはじく
    Object.assign(c.s.game.bodies[0], { x: -28, y: 0, a: Math.PI / 2 });
    c.handle(ME, { t: 'flick', lx: 0, ly: 0, dx: -1, dy: 0, power: 1 });
    runEnemies(c, Date.now(), seeded(3));
  };
  c.s.game.bodies[0].hp = 20;
  fall();
  assert.equal(c.s.phase, 'aim');
  assert.equal(c.s.stage.lives, 2);
  const me = c.s.game.bodies[0];
  assert.equal(me.state, 'desk');
  assert.deepEqual([me.x, me.y], [-18, 0], '盤面の最初の位置に戻る');
  assert.equal(me.hp, 50, '体力は最大の半分まで戻る');
  assert.equal(c.s.game.turn, 0);
  assert.equal(c.snapshot().stage.lives, 2);
  assert.equal(c.s.stage.shots, 1, '戻っても打った回数は1回');
  fall();
  assert.equal(c.s.stage.lives, 1);
  fall();
  assert.equal(c.s.phase, 'over');
  assert.equal(c.s.stage.result.cleared, false);
  assert.match(c.s.stage.result.reason, /ライフがなくなった.*自滅/);
  assert.equal(c.handle(ME, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.5 })[0].msg.t, 'error');
});

test('最後の盤面の敵を倒すとマップクリアになり、記録が1回だけ取り出せる', () => {
  const c = make(2);
  for (let b = 0; b < 3; b++) {
    const g = c.s.game;
    g.bodies.forEach((x, i) => { if (i > 0) { x.state = 'gone'; } });
    c.finishTurn(0);
    assert.equal(c.s.game.boardClear, true);
    const m = c.nextBoard();
    if (b < 2) assert.equal(m.stage, 'board');
    else assert.equal(m.stage, 'clear');
  }
  assert.equal(c.s.phase, 'over');
  assert.equal(c.s.stage.result.cleared, true);
  const rec = c.takeRecord();
  assert.equal(rec.map, 2);
  assert.equal(c.takeRecord(), null);
});

test('敵の番：消しゴムはすぐそばの自分を削り、離れていれば何もしない', () => {
  const c = make(1);
  const g = c.s.game;
  const e = g.bodies[1];
  Object.assign(g.bodies[0], { x: e.x - 6, y: e.y, a: Math.PI / 2 });
  g.turn = 1;
  const out = c.enemyTurn();
  assert.equal(out.length, 1);
  assert.ok(g.bodies[0].hp < stageMaxHp(1));
  assert.equal(c.s.game.turn, 0);
  const far = make(1);
  far.s.game.turn = 1;
  assert.equal(far.enemyTurn().length, 0);
  assert.equal(far.s.game.bodies[0].hp, stageMaxHp(1));
});

test('敵の番：修正テープは近くの仲間を直す。画びょうは触れた定規にトゲのダメージ', () => {
  const c = make(4);
  c.loadBoard(1, null); // 修正テープとクリップ2つ
  const g = c.s.game;
  const tape = g.bodies.findIndex((b) => b.enemy === 'tape');
  const clip = g.bodies.findIndex((b) => b.enemy === 'clip');
  g.bodies[clip].hp = 5;
  g.bodies[clip].x = g.bodies[tape].x - 8; g.bodies[clip].y = g.bodies[tape].y;
  g.turn = tape;
  c.enemyTurn();
  assert.ok(g.bodies[clip].hp > 5);

  const t = make(3); // 画びょう
  const tg = t.s.game;
  const tack = tg.bodies.findIndex((b) => b.enemy === 'tack');
  const tb = tg.bodies[tack];
  Object.assign(tg.bodies[0], { x: tb.x - 6, y: tb.y, a: Math.PI / 2 });
  t.handle(ME, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.35 });
  assert.ok(tg.bodies[0].hp < stageMaxHp(1), 'ぶつかった自分もトゲでダメージ');
  assert.equal(tg.bodies[tack].x, tb.x, '画びょうは動かない');
});

test('動く敵は自分を狙ってはじき、敵の番が終わると自分の番に戻る', () => {
  const c = make(2);
  const out = runEnemies(c, Date.now(), seeded(5)); // 自分の番なので何もしない
  assert.equal(out.length, 0);
  c.s.game.turn = 1;
  const msgs = runEnemies(c, Date.now(), seeded(5));
  assert.ok(msgs.some((m) => m.t === 'shot' && m.by === 1), '鉛筆がはじいた');
  assert.ok(c.s.phase === 'over' || c.s.game.turn === 0);
});

test('何もしない置物の番のあとも、画面へ送る最後の状態は自分の番になっている', () => {
  // マップ1の盤面1：遠くの消しゴムは何もしない（メッセージを出さない）
  const c = make(1);
  const msgs = c.handle(ME, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 }).map((o) => o.msg);
  msgs.push(...runEnemies(c));
  syncMessages(c, msgs);
  const last = msgs.filter((m) => m.state).at(-1);
  assert.equal(c.s.game.turn, 0);
  assert.equal(last.state.game.turn, 0);
  // のりと画びょうだけが残った盤面でも同じ
  const d = make(4);
  d.loadBoard(0, null);
  d.s.game.bodies.forEach((b, i) => { if (b.enemy === 'pencil') { b.state = 'gone'; d.s.game.players[i].alive = false; } });
  const m2 = d.handle(ME, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 }).map((o) => o.msg);
  m2.push(...runEnemies(d));
  syncMessages(d, m2);
  assert.equal(m2.filter((m) => m.state).at(-1).state.game.turn, 0);
});

test('ステージでは Lv.50 まで効き、体力の最大が増える。対人では Lv.10 まで', () => {
  const exp = 30000;
  assert.equal(levelInfo(exp).level, LEVEL_MAX);
  assert.equal(levelInfo(exp, STAGE_LEVEL_MAX).level, STAGE_LEVEL_MAX);
  const st = resolveLoadout({ ruler: 'ruler:straight30-acrylic' }, undefined, 50, STAGE_LEVEL_MAX);
  const pv = resolveLoadout({ ruler: 'ruler:straight30-acrylic' }, undefined, 50);
  assert.equal(pv.level, 10);
  assert.equal(st.level, 50);
  assert.ok(st.mods.mass > pv.mods.mass);
  const c = new StageCore('kahen', 1, { name: 'x', loadout: st });
  assert.equal(c.s.game.bodies[0].maxHp, stageMaxHp(50));
  assert.ok(stageMaxHp(50) > 200);
  // ステージでは重さ・はじく力の上乗せが +10% で止まらない
  const body = c.makeBody(c.s.game.bodies[0]);
  assert.ok(body.m > Physics.RULERS['straight30-acrylic'].mass * 1.15);
});

test('折りたたみ定規：体力が減るほど長い形になり、ガチャには出ない。必殺技「全開」でその1打だけ全開', () => {
  assert.ok(ITEMS['ruler:folding-acrylic']);
  assert.ok(!GACHA_POOL.some((it) => it.id === 'ruler:folding-acrylic'));
  assert.equal(Physics.shapeOf('folding-acrylic', 100, 100), 'folding1');
  assert.equal(Physics.shapeOf('folding-acrylic', 50, 100), 'folding2');
  assert.equal(Physics.shapeOf('folding-acrylic', 20, 100), 'folding3');
  // 対人の対戦でも使える
  const r = new RoomCore('ABCDE', 'quick');
  const a = r.join('A').member, b = r.join('B').member;
  r.setLoadout(a.id, resolveLoadout({ ruler: 'ruler:folding-acrylic' }));
  r.handle(a.id, { t: 'ready', on: true }); r.handle(b.id, { t: 'ready', on: true });
  const g = r.s.game;
  assert.equal(r.skillOf(0), 'fullopen');
  assert.equal(r.makeBody(g.bodies[0]).shapeKey, 'folding1');
  g.bodies[0].hp = 30;
  assert.equal(r.makeBody(g.bodies[0]).shapeKey, 'folding3');
  g.bodies[0].hp = 100;
  g.gauge[0] = GAUGE.max;
  const shot = r.handle(a.id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.2, skill: true })[0].msg;
  assert.equal(shot.skill, 'fullopen');
});

test('ボスは体力で形が変わる', () => {
  const c = make(10);
  c.loadBoard(4, null);
  const g = c.s.game;
  const boss = g.bodies.find((b) => b.enemy === 'boss');
  assert.ok(boss.maxHp >= ENEMIES.boss.hp);
  assert.equal(c.makeBody(boss).shapeKey, 'folding1');
  boss.hp = boss.maxHp * 0.5;
  assert.equal(c.makeBody(boss).shapeKey, 'folding2');
  boss.hp = boss.maxHp * 0.2;
  assert.equal(c.makeBody(boss).shapeKey, 'folding3');
});

// ---- サーバー（Durable Object の代わりに、保存先だけ用意して動かす） ----
const db = await createFakeD1();
const skip = !db && 'この Node には node:sqlite がないため省略';
if (db) await D.ensureSchema(db);
function fakeRoom() {
  const store = new Map();
  return {
    env: { DB: db },
    ctx: { storage: { async get(k) { return store.get(k); }, async put(k, v) { store.set(k, structuredClone(v)); }, async delete(k) { store.delete(k); }, async setAlarm() {} } },
  };
}
const call = async (room, user, path, body) => {
  const res = await handleStage(room, new Request('https://stage' + path, body ? { method: 'POST', body: JSON.stringify(body) } : {}), user);
  return { status: res.status, data: await res.json() };
};

test('サーバー：マップは順に開放され、クリアするとえんぴつ（初回だけ）と経験値、最後に定規がもらえる', { skip }, async () => {
  const u = (await D.upsertGoogleUser(db, 'stage-1', 'すてーじ')).user;
  const user = { id: u.id, name: u.name };
  const room = fakeRoom();
  const locked = await call(room, user, '/stage/start', { stage: 'kahen', map: 2 });
  assert.equal(locked.status, 403);
  const ok = await call(room, user, '/stage/start', { stage: 'kahen', map: 1 });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.messages[0].t, 'welcome');
  assert.equal(ok.data.messages[0].state.stage.map, 1);
  // 途中から読み直せる
  assert.equal((await call(room, user, '/stage/run')).data.run.state.stage.map, 1);
  // 最後の盤面まで飛ばして、敵を倒した状態にする
  const core = room.stage;
  core.loadBoard(2, { hp: 80, gauge: 0 });
  core.s.stage.board = 2;
  core.s.game.bodies.forEach((b, i) => { if (i > 0) b.hp = 0.1; });
  core.rand = () => 0.99;
  // 当てなくても倒れるよう、体力0にしておき、そっとはじく
  core.s.game.bodies.forEach((b, i) => { if (i > 0) b.hp = 0; });
  const before = (await db.prepare('SELECT coins FROM users WHERE id = ?').bind(u.id).first()).coins;
  const r1 = await call(room, user, '/stage/act', { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  const reward = r1.data.messages.find((m) => m.t === 'reward');
  assert.ok(reward, JSON.stringify(r1.data.messages.map((m) => m.t)));
  assert.equal(reward.first, true);
  assert.equal(reward.coins, REWARD.coins(1));
  assert.equal(reward.total, before, 'えんぴつは受け取り箱に届く');
  assert.equal(reward.inbox, true);
  const box = await D.inboxOf(db, u.id);
  assert.ok(box.some((x) => x.kind === 'stage' && x.coins === REWARD.coins(1)));
  assert.equal(reward.exp.gain, REWARD.exp(1));
  assert.equal((await D.stageProgress(db, u.id)).kahen.cleared, 1);
  // 2回目のクリアは経験値だけ
  await call(room, user, '/stage/start', { stage: 'kahen', map: 1 });
  room.stage.loadBoard(2, { hp: 80, gauge: 0 }); room.stage.s.stage.board = 2;
  room.stage.s.game.bodies.forEach((b, i) => { if (i > 0) b.hp = 0; });
  const r2 = await call(room, user, '/stage/act', { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  const rw2 = r2.data.messages.find((m) => m.t === 'reward');
  assert.equal(rw2.first, false);
  assert.equal(rw2.coins, 0);
  // マップ10まで記録を進めて、最後のマップの初クリアで折りたたみ定規
  for (let m = 2; m <= 9; m++) await D.recordStageClear(db, { userId: u.id, stage: 'kahen', map: m, ruler: 'ruler:straight30-acrylic', shots: 10 });
  const last = await D.recordStageClear(db, { userId: u.id, stage: 'kahen', map: 10, ruler: 'ruler:straight30-acrylic', shots: 30 });
  assert.equal(last.item, 'ruler:folding-acrylic');
  assert.ok(!(await D.ownedSet(db, u.id)).has('ruler:folding-acrylic'), '受け取るまでは持っていない');
  await D.claimInbox(db, u.id);
  assert.ok((await D.ownedSet(db, u.id)).has('ruler:folding-acrylic'));
  const again = await D.recordStageClear(db, { userId: u.id, stage: 'kahen', map: 10, ruler: 'ruler:straight30-acrylic', shots: 25 });
  assert.equal(again.item, null);
  assert.equal((await D.stageProgress(db, u.id)).kahen.maps[10].best, 25);
});

test('サーバー：持っていない定規では始められない。ほかの人の攻略は動かせない', { skip }, async () => {
  const u = (await D.upsertGoogleUser(db, 'stage-2', 'べつ')).user;
  const room = fakeRoom();
  const bad = await call(room, { id: u.id, name: u.name }, '/stage/start', { stage: 'kahen', map: 1, ruler: 'ruler:protractor-acrylic' });
  assert.equal(bad.status, 400);
  await call(room, { id: u.id, name: u.name }, '/stage/start', { stage: 'kahen', map: 1 });
  const other = await call(room, { id: 'someone', name: 'x' }, '/stage/act', { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.5 });
  assert.equal(other.status, 404);
});
