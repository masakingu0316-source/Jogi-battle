// 破天荒編（図工室）：絵の具の水たまり・筆・パレット・はさみ・U字磁石・落雷・雷雲の雲形定規
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StageCore, runEnemies, ME } from '../public/shared/stage-core.js';
import { STAGES, STAGE_ORDER, ENEMIES, PAINT, diffOf, enemyMaxHp } from '../public/shared/stage.js';
import { resolveLoadout, STAGE_LEVEL_MAX, ITEMS, GACHA_POOL } from '../public/shared/catalog.js';
import { GAUGE, SKILLS, RULER_SKILL } from '../public/shared/rules.js';
import Physics from '../public/shared/physics.js';
import { RoomCore } from '../public/shared/core.js';
import { createFakeD1 } from './fake-d1.js';
import * as D from '../src/db.js';
import { handleStage } from '../src/stage-host.js';

const lo = (ruler = 'ruler:straight30-acrylic', level = 1) => resolveLoadout({ ruler }, undefined, level, STAGE_LEVEL_MAX);
const make = (map = 1, ruler) => {
  const c = new StageCore('hatenko', map, { name: 'テスト', loadout: lo(ruler) });
  c.rand = () => 0.5;
  return c;
};
// 盤面を作り直す：自分と、foes の敵だけ（pools の水たまり）
function board(c, foes, opt = {}) {
  const def = STAGES.hatenko.maps[c.s.stage.map - 1];
  const saved = def.boards[0];
  def.boards[0] = { desk: opt.desk || 'group', me: opt.me || { x: -40, y: 0, a: Math.PI / 2 }, pools: opt.pools || [], foes };
  try { c.loadBoard(0, null); } finally { def.boards[0] = saved; }
  return c.s.game;
}

test('破天荒編：10マップ（マップ10だけ5盤面）。編は可変定規編と破天荒編、最初から選べる', () => {
  assert.deepEqual(STAGE_ORDER, ['kahen', 'hatenko']);
  const st = STAGES.hatenko;
  assert.equal(st.maps.length, 10);
  st.maps.forEach((m, i) => assert.equal(m.boards.length, i === 9 ? 5 : 3));
  assert.equal(st.reward, 'ruler:cloud-acrylic');
  assert.ok(st.maps[9].boards[4].boss);
  assert.ok(st.maps[9].boards[4].foes.some((f) => f.t === 'cloud'));
  // マップ7・8 は場のイベントの落雷（1か所・2か所）
  assert.equal(st.maps[6].bolts, 1);
  assert.equal(st.maps[7].bolts, 2);
  // 前半は可変定規編と同じ難しさ、後半はやさしめ
  for (let m = 1; m <= 6; m++) assert.equal(diffOf('hatenko', m), m);
  for (let m = 7; m <= 10; m++) assert.ok(diffOf('hatenko', m) < m);
  // 敵の定規はマップ7で初めて出てくる
  st.maps.forEach((m, i) => m.boards.forEach((b) => {
    if (i < 6) assert.ok(!b.foes.some((f) => f.t === 'ruler'), `マップ${i + 1}に敵の定規`);
  }));
  assert.ok(st.maps[6].boards.some((b) => b.foes.some((f) => f.t === 'ruler')));
});

test('ラスボスの体力は折りたたみ定規と同じ', () => {
  const c = make(10);
  c.s.stage.board = 4;
  c.loadBoard(4, null);
  const boss = c.s.game.bodies.find((b) => b.enemy === 'cloud');
  assert.equal(boss.maxHp, enemyMaxHp('boss', 10));
  assert.equal(c.makeBody(boss).shapeKey, 'cloud');
  assert.equal(Physics.RULERS[boss.specKey].mat, 'acrylic');
});

test('雲形定規：へこんだ形のまま当たる（へこみの中に入った定規は、外形の円の中でも当たらない）', () => {
  const cloud = Physics.createBody('c', 0, 'boss-cloud', 0, 0, 0);
  assert.ok(cloud.shape.parts.length >= 2);
  // 外形の中心付近の点が、へこみのせいで形の外になっている所がある
  const outside = [];
  for (let x = -12; x <= 12; x += 1) for (let y = -6; y <= 6; y += 1) {
    if (Physics.distToBody(cloud, x, y) > 0.3) outside.push([x, y]);
  }
  assert.ok(outside.length > 0, 'へこみがある');
  // 同じ置き方なら、何度動かしても同じ結果（わざとランダムにしない）
  const run = () => {
    const w = Physics.createWorld({}, { w: 130, h: 90 });
    w.bodies.push(Physics.createBody('c', 0, 'boss-cloud', 0, 0, 0.3), Physics.createBody('r', 1, 'straight15-acrylic', -30, 4, 0));
    Physics.flick(w, w.bodies[1], 0, 0, 1, 0, 0.8);
    for (let k = 0; k < 400 && !Physics.atRest(w); k++) Physics.step(w, 1 / 240);
    return w.bodies.map((b) => [b.x.toFixed(4), b.y.toFixed(4), b.a.toFixed(4)]);
  };
  assert.deepEqual(run(), run());
});

test('赤い水たまりの上はすべりにくく、青はよくすべる（上を通っている間だけ）', () => {
  const slide = (c) => {
    const w = Physics.createWorld({}, { w: 400, h: 90 });
    if (c) w.puddles = [{ c, x: 0, y: 0, r: 300 }];
    const b = Physics.createBody('a', 0, 'straight15-acrylic', -150, 0, 0);
    w.bodies.push(b);
    Physics.flick(w, b, 0, 0, 1, 0, 0.5);
    for (let k = 0; k < 4000 && !Physics.atRest(w); k++) Physics.step(w, 1 / 240);
    return b.x + 150;
  };
  const plain = slide(null), red = slide('red'), blue = slide('blue');
  assert.ok(red < plain * 0.7, `赤 ${red} < ふつう ${plain}`);
  assert.ok(blue > plain * 1.5, `青 ${blue} > ふつう ${plain}`);
  // 緑・黄は、すべり方を変えない
  assert.ok(Math.abs(slide('green') - plain) < 0.01);
  assert.ok(Math.abs(slide('yellow') - plain) < 0.01);
  // 水たまりの外では効かない
  assert.equal(Physics.onPuddle({ c: 'red', x: 0, y: 0, r: PAINT.r }, PAINT.r + 0.5, 0), false);
  assert.equal(Physics.onPuddle({ c: 'red', pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }], w: 1 }, 5, 0.8), true);
  assert.equal(Physics.onPuddle({ c: 'red', pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }], w: 1 }, 5, 1.5), false);
});

test('水たまりの大きさは、15cm定規の長さくらい（直径）', () => {
  assert.ok(Math.abs(PAINT.r * 2 - 15) <= 3);
  const g = make(1).s.game;
  assert.ok(g.puddles.length >= 2);
  for (const p of g.puddles) assert.equal(p.r, PAINT.r);
});

test('番の終わりに緑の上にいると体力+8（回復したら消える）、黄の上にいると−5（消えない）。敵にも効く', () => {
  const c = make(2);
  const g = board(c, [{ t: 'eraser', x: 40, y: 20, a: 0 }], { pools: [{ c: 'green', x: -40, y: 0 }, { c: 'yellow', x: 40, y: 20 }] });
  g.bodies[0].hp = 50;
  const enemyHp = g.bodies[1].hp;
  c.handle(ME, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.02 });
  assert.equal(c.s.game.bodies[0].hp, 58, '緑で回復');
  assert.ok(!c.s.game.puddles.some((p) => p.c === 'green'), '回復した緑は消える');
  assert.ok(c.s.game.fx.some((e) => e.kind === 'paintHeal' && e.owner === 0));
  // 敵の番（消しゴムは置物）：番を終えると黄で−5
  runEnemies(c);
  assert.equal(c.s.game.bodies[1].hp, enemyHp - PAINT.hurt);
  assert.ok(c.s.game.puddles.some((p) => p.c === 'yellow'), '黄は消えない');
  // 体力が満タンなら緑は減らない
  const c2 = make(2);
  const g2 = board(c2, [{ t: 'eraser', x: 40, y: 20, a: 0 }], { pools: [{ c: 'green', x: -40, y: 0 }] });
  const full = g2.bodies[0].hp;
  c2.handle(ME, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.02 });
  assert.equal(c2.s.game.bodies[0].hp, full);
  assert.ok(c2.s.game.puddles.some((p) => p.c === 'green'));
});

test('筆：動いた跡にその筆の色の細い水たまりを残し、3周たつと乾いて消える', () => {
  const c = make(3);
  const g = board(c, [{ t: 'brush', c: 'blue', x: -20, y: 0, a: Math.PI / 2 }]);
  assert.equal(g.looks[1].name, '青の筆');
  // 自分で筆に当てて動かす
  c.handle(ME, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.9 });
  const trails = c.s.game.puddles.filter((p) => p.pts);
  assert.ok(trails.length >= 1, '跡ができた');
  assert.ok(trails.every((p) => p.c === 'blue' && p.w === PAINT.trailW));
  const lap0 = trails[0].lap;
  // 3周たつと乾く
  c.onLap(lap0 + 2);
  assert.ok(c.s.game.puddles.some((p) => p.pts));
  c.onLap(lap0 + 3);
  assert.ok(!c.s.game.puddles.some((p) => p.pts));
  assert.ok(c.s.game.fx.some((e) => e.kind === 'dry'));
});

test('パレット：当てると、まわり3か所に4色からランダムで水たまりがはねる', () => {
  const c = make(4);
  const g = board(c, [{ t: 'palette', x: -10, y: 0 }, { t: 'eraser', x: 50, y: 30, a: 0 }]);
  let k = 0;
  c.rand = () => [0.1, 0.3, 0.6, 0.9][k++ % 4];
  c.handle(ME, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.6 });
  const splashed = c.s.game.puddles.filter((p) => p.splash);
  assert.equal(splashed.length, 3);
  assert.ok(splashed.every((p) => PAINT.colors[p.c]));
  assert.ok(c.s.game.fx.some((e) => e.kind === 'splash' && e.owner === 1));
  void g;
});

test('はさみ：開いた刃の間で番を終えると、次にはじく力が半分（1回だけ）', () => {
  const c = make(6);
  // はさみは +x 向きに刃が開いている。刃の間に自分の定規の端が入っている
  board(c, [{ t: 'scissors', x: -46, y: 0, a: 0 }, { t: 'eraser', x: 50, y: 30, a: 0 }], { me: { x: -24, y: 0, a: 0 } });
  c.handle(ME, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.01 });
  assert.equal(c.s.game.bodies[0].cut, true);
  assert.ok(c.s.game.fx.some((e) => e.kind === 'cut' && e.owner === 0));
  runEnemies(c);
  // 半分の力ではじいた結果と、元の半分の力ではじいた結果が同じ
  const a = StageCore.restore(structuredClone(c.s)); a.rand = () => 0.99;
  const b = StageCore.restore(structuredClone(c.s)); b.rand = () => 0.99;
  b.s.game.bodies[0].cut = false;
  a.shoot({ lx: 0, ly: 0, dx: 1, dy: 0, power: 0.8 });
  b.shoot({ lx: 0, ly: 0, dx: 1, dy: 0, power: 0.4 });
  assert.equal(a.s.game.bodies[0].x, b.s.game.bodies[0].x);
  assert.ok(!a.s.game.bodies[0].cut || a.s.game.fx.filter((e) => e.kind === 'cut').length > 1);
});

test('U字磁石：近くの定規（自分・敵の定規）を少し引き寄せる。メタルは2倍。文房具は引き寄せない', () => {
  const moved = (ruler) => {
    const c = make(5, ruler);
    const g = board(c, [{ t: 'magnet', x: 0, y: 0, a: Math.PI }, { t: 'eraser', x: 14, y: 20, a: 0 }], { me: { x: -33, y: 0, a: Math.PI / 2 }, desk: 'row3' });
    g.turn = 1;
    const e0 = { x: g.bodies[2].x, y: g.bodies[2].y };
    const out = c.enemyTurn();
    assert.equal(out[0].t, 'shot');
    assert.equal(out[0].blast.kind, 'pull');
    assert.deepEqual({ x: c.s.game.bodies[2].x, y: c.s.game.bodies[2].y }, e0, '消しゴムは動かない');
    return c.s.game.bodies[0].x + 33;
  };
  const acrylic = moved('ruler:straight30-acrylic');
  const metal = moved('ruler:straight30-metal');
  assert.ok(acrylic > 1.5 && acrylic < 8, `少しずつ（${acrylic}）`);
  assert.ok(metal > acrylic * 1.7 && metal < acrylic * 2.4, `メタルは2倍くらい（${metal} / ${acrylic}）`);
  // 範囲（30cm定規1本分）の外なら何もしない
  const c = make(5);
  const g = board(c, [{ t: 'magnet', x: 40, y: 0, a: Math.PI }], { me: { x: -40, y: 0, a: Math.PI / 2 }, desk: 'row3' });
  g.turn = 1;
  assert.deepEqual(c.enemyTurn(), []);
});

test('マップ7：敵全員の番が終わると落雷を1か所予告し、次の周の初め（自分の番の直前）に落ちる', () => {
  const c = make(7);
  const g = board(c, [{ t: 'eraser', x: 50, y: 30, a: 0 }]);
  assert.equal(g.boltEvent, 1);
  c.handle(ME, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.01 });
  runEnemies(c);
  // 1周した：予告が出ている（まだ落ちない）
  assert.equal(c.s.game.turn, 0);
  assert.equal(c.s.game.bolts.length, 1);
  assert.equal(c.s.game.bolts[0].owner, -1);
  assert.ok(c.s.game.fx.some((e) => e.kind === 'boltWarn'));
  const bolt = { ...c.s.game.bolts[0] };
  // 自分の番・敵の番のあと、次の周の初めに落ちる（新しい予告も出る）
  c.handle(ME, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.01 });
  const msgs = runEnemies(c);
  const strike = msgs.find((m) => m.bolts?.some((b) => b.id === bolt.id));
  assert.ok(strike, '落雷の動きが届く');
  assert.equal(c.s.game.bolts.length, 1, '次の予告');
  assert.notEqual(c.s.game.bolts[0].id, bolt.id);
});

test('落雷：半径の中の定規にダメージ30と外向きの吹き飛ばし。ボス自身には当たらない。パレットに当たると絵の具がはねる', () => {
  const c = make(10);
  const g = board(c, [{ t: 'cloud', x: 20, y: 0, a: 0 }, { t: 'palette', x: -30, y: 20 }], { me: { x: -40, y: 0, a: Math.PI / 2 } });
  const meHp = g.bodies[0].hp, palHp = g.bodies[2].hp, bossHp = g.bodies[1].hp;
  // ボスのそばと、自分・パレットのそばに落とす
  g.bolts = [
    { id: 1, owner: 1, x: -40, y: 8, r: 16, dmg: 30, speed: 150, due: 1, skip: 0 },
    { id: 2, owner: 1, x: 20, y: 0, r: 16, dmg: 30, speed: 150, due: 1, skip: 0 },
  ];
  const out = c.handle(ME, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: -1, power: 0.01 });
  const shot = out[0].msg;
  assert.equal(shot.bolts.length, 2);
  const now = c.s.game;
  assert.equal(now.bodies[0].hp, Math.round((meHp - 30) * 10) / 10, '自分に30');
  assert.equal(now.bodies[2].hp, palHp - 30, 'パレットにも当たる');
  assert.equal(now.bodies[1].hp, bossHp, 'ボス自身には当たらない');
  assert.ok(Math.hypot(now.bodies[0].x + 40, now.bodies[0].y) > 3, '吹き飛ぶ');
  assert.ok(now.puddles.some((p) => p.splash), 'パレットの絵の具がはねた');
  assert.equal(now.turn, 1, 'ボスの番');
});

test('ボスの落雷：ゲージがたまったら使い、白い雲3か所・灰色4か所・黒い雷雲5か所。予告が出ている間は使わない', () => {
  for (const [frac, n] of [[1, 3], [0.5, 4], [0.2, 5]]) {
    const c = make(10);
    c.s.stage.board = 4;
    c.loadBoard(4, null);
    const g = c.s.game;
    const bi = g.bodies.findIndex((b) => b.enemy === 'cloud');
    g.bodies[bi].hp = Math.round(g.bodies[bi].maxHp * frac);
    g.gauge[bi] = GAUGE.max;
    g.turn = bi;
    const out = c.enemyTurn(Date.now(), () => 0.4);
    assert.equal(out[0].t, 'state');
    assert.equal(out[1].t, 'shot');
    const mine = c.s.game.bolts.filter((b) => b.owner === bi);
    assert.equal(mine.length, n, `体力${frac * 100}%で${n}か所`);
    assert.ok(mine.every((b) => b.due === bi && b.r === 16 && b.dmg === 30));
    // 予告が出ている間は、ゲージがたまっていても使わない
    c.s.game.gauge[bi] = GAUGE.max;
    c.s.game.turn = bi;
    c.enemyTurn(Date.now(), () => 0.4);
    assert.equal(c.s.game.bolts.filter((b) => b.owner === bi).length, n);
  }
});

test('雷雲の雲形定規（SSR）：全クリア報酬。必殺技「落雷」は相手のまわり3か所に自動で予告', () => {
  const item = ITEMS['ruler:cloud-acrylic'];
  assert.equal(item.rarity, 'SSR');
  assert.ok(!GACHA_POOL.includes('ruler:cloud-acrylic'));
  assert.equal(RULER_SKILL['cloud-acrylic'], 'raiun');
  assert.equal(SKILLS.raiun.mode, 'now');
  // 対人：自分が使うと相手のまわりに3か所。自分の次の番の直前に落ちる。予告中は使えない
  const r = new RoomCore('ABCDE', 'standard', 1000);
  r.rand = () => 0.5;
  const ms = [r.join('A', null, null, 1000).member, r.join('B', null, null, 1000).member];
  for (const m of ms) r.handle(m.id, { t: 'ready', on: true }, 2000);
  const g = r.s.game;
  const i = 0;
  Object.assign(g.bodies[i], { skill: 'raiun', specKey: 'cloud-acrylic' });
  g.turn = i; g.gauge[i] = GAUGE.max;
  const res = r.handle(g.order[i], { t: 'skill' });
  assert.ok(!res.some((o) => o.msg.t === 'error'), JSON.stringify(res.map((o) => o.msg)));
  assert.equal(r.s.game.bolts.length, 3);
  assert.ok(r.s.game.bolts.every((b) => b.owner === i && b.due === i));
});

// ---- サーバー ----
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

test('サーバー：破天荒編は可変定規編をクリアしていなくても遊べ、全クリアで雷雲の雲形定規', { skip }, async () => {
  const u = (await D.upsertGoogleUser(db, 'hatenko-1', 'はてんこう')).user;
  const user = { id: u.id, name: u.name };
  const room = fakeRoom();
  const ok = await call(room, user, '/stage/start', { stage: 'hatenko', map: 1 });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.messages[0].state.stage.name, '破天荒編');
  assert.equal(ok.data.messages[0].state.stage.place, '図工室');
  assert.ok(ok.data.messages[0].state.game.puddles.length >= 2);
  assert.equal((await call(room, user, '/stage/start', { stage: 'hatenko', map: 2 })).status, 403);
  for (let m = 1; m <= 9; m++) await D.recordStageClear(db, { userId: u.id, stage: 'hatenko', map: m, ruler: 'ruler:straight30-acrylic', shots: 10 });
  const prog = await D.stageProgress(db, u.id);
  assert.equal(prog.hatenko.cleared, 9);
  assert.equal(prog.kahen.cleared, 0, '可変定規編は別');
  const last = await D.recordStageClear(db, { userId: u.id, stage: 'hatenko', map: 10, ruler: 'ruler:straight30-acrylic', shots: 30 });
  assert.equal(last.item, 'ruler:cloud-acrylic');
  await D.claimInbox(db, u.id);
  assert.ok((await D.ownedSet(db, u.id)).has('ruler:cloud-acrylic'));
});
