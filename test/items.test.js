// 体力0で倒れる・回復アイテム（ばんそうこう）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../public/shared/core.js';
import { StageCore, runEnemies, ME } from '../public/shared/stage-core.js';
import { resolveLoadout, STAGE_LEVEL_MAX } from '../public/shared/catalog.js';
import { FIELD_ITEM, SKILL_TUNE } from '../public/shared/rules.js';
import { stageMaxHp } from '../public/shared/stage.js';

function game(mode = 'quick', rulers = []) {
  const r = new RoomCore('ABCDE', mode);
  r.rand = () => 0.99;
  const n = mode === 'melee' ? 3 : 2;
  const ms = [];
  for (let i = 0; i < n; i++) {
    const m = r.join('P' + i).member;
    if (rulers[i]) r.setLoadout(m.id, resolveLoadout({ ruler: rulers[i] }));
    ms.push(m);
  }
  for (const m of ms) r.handle(m.id, { t: 'ready', on: true });
  return { r, ms, g: r.s.game };
}
// 相手に当たるように並べて、強めにはじく
function hit(r, ms, g, power = 0.6) {
  g.shots = g.n; // 1周目の「落ちても戻る」を外す
  Object.assign(g.bodies[0], { x: -8, y: 0, a: Math.PI / 2 });
  Object.assign(g.bodies[1], { x: 6, y: 0, a: Math.PI / 2 });
  return r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power })[0].msg;
}

test('対人：体力が0になっても倒れず、瀕死で残る（決着しない）', () => {
  const { r, ms, g } = game();
  g.bodies[1].hp = 1;
  const m = hit(r, ms, g, 0.45);
  assert.equal(m.t, 'shot');
  assert.equal(g.bodies[1].hp, 0);
  assert.equal(g.bodies[1].state, 'desk');
  assert.equal(g.players[1].alive, true);
  assert.equal(g.result, null);
  assert.equal(g.bodies[1].weak, true);
  assert.ok(g.fx.some((f) => f.kind === 'weak' && f.owner === 1), '瀕死になったことを知らせる');
  assert.ok(!g.fx.some((f) => f.kind === 'down'));
  // 回復すれば瀕死は抜ける
  g.bodies[1].hp = 30;
  r.markWeak();
  assert.equal(g.bodies[1].weak, undefined);
});

test('コンピュータは瀕死にならず、体力0で倒れる', () => {
  const { r, ms, g } = game();
  r.member(ms[1].id).cpu = true;
  g.bodies[1].hp = 1;
  const m = hit(r, ms, g, 0.45);
  assert.equal(m.t, 'shot');
  assert.equal(g.players[1].alive, false);
  assert.equal(g.players[1].ko, true);
  assert.equal(g.result.winners[0], 0);
  assert.ok(g.fx.some((f) => f.kind === 'down' && f.owner === 1 && f.how === 'ko'));
  assert.ok(!g.fx.some((f) => f.kind === 'weak'));
  assert.equal(r.makeBody(g.bodies[0]).weakAtZero, true, '人は瀕死になる');
});

// 同じ当て方で、当てられた側がどれだけ動いたか
function pushed(hp) {
  const { r, ms, g } = game('standard');
  g.shots = g.n;
  g.bodies[1].hp = hp;
  Object.assign(g.bodies[0], { x: -38, y: 0, a: Math.PI / 2 });
  Object.assign(g.bodies[1], { x: -24, y: 0, a: Math.PI / 2 });
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.6 });
  const b = g.bodies[1];
  return b.state === 'desk' ? Math.hypot(b.x + 24, b.y) : Infinity;
}
// 同じ力ではじいて、自分がどれだけ進んだか（相手は遠くに置く）
function slid(hp) {
  const { r, ms, g } = game();
  g.shots = g.n;
  g.bodies[0].hp = hp;
  Object.assign(g.bodies[0], { x: -30, y: 0, a: Math.PI / 2 });
  Object.assign(g.bodies[1], { x: 30, y: 25, a: 0 });
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.4 });
  return g.bodies[0].x + 30;
}

test('瀕死：当てられるとかなり飛びやすい', () => {
  const half = pushed(50), weak = pushed(0);
  assert.ok(weak > half * 5, `体力50で${half.toFixed(1)}cm → 瀕死で${weak.toFixed(1)}cm`);
});

test('瀕死：自分ではじくと、進む距離がかなり小さい', () => {
  const low = slid(1), weak = slid(0);
  assert.ok(low > 5);
  assert.ok(weak < low * 0.45, `体力1で${low.toFixed(1)}cm → 瀕死で${weak.toFixed(1)}cm`);
});

test('対人：インク漏れで体力が0になっても倒れず、瀕死のまま自分の番が来る', () => {
  const { r, ms, g } = game('melee');
  g.shots = g.n;
  g.bodies[1].hp = SKILL_TUNE.inkDmg - 1; g.bodies[1].ink = 2;
  Object.assign(g.bodies[0], { x: -30, y: 0 });
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  assert.equal(g.players[1].alive, true);
  assert.equal(g.bodies[1].hp, 0);
  assert.equal(g.turn, 1, '番は来る');
  assert.ok(g.fx.some((f) => f.kind === 'weak' && f.owner === 1));
});

test('回復アイテム：2周目から確率で空いている所に出て、触れた定規が回復し、アイテムは消える', () => {
  const { r, ms, g } = game('standard');
  // 1周目は出ない
  r.rand = () => 0.01;
  r.maybeSpawnItem();
  assert.equal((g.items || []).length, 0);
  g.shots = g.n;
  // 出る（0.01）・救急箱にはならない（0.9）・あとは置き場所
  const seq = [0.01, 0.9];
  r.rand = () => seq.length ? seq.shift() : 0.01;
  r.maybeSpawnItem();
  r.rand = () => 0.01;
  assert.equal(g.items.length, 1);
  const it = g.items[0];
  assert.equal(it.heal, FIELD_ITEM.heal);
  assert.ok(!it.big);
  r.maybeSpawnItem();
  assert.equal(g.items.length, FIELD_ITEM.max, '同時に出るのは決まった数まで');
  assert.ok(r.snapshot().game.items.length === 1);
  assert.ok(g.fx.some((f) => f.kind === 'item'));
  // アイテムの上を通るようにはじく（机の真ん中に置き直して確かめる）
  r.rand = () => 0.99;
  Object.assign(it, { x: 0, y: 0 });
  g.bodies[0].hp = 40;
  Object.assign(g.bodies[0], { x: it.x - 10, y: it.y, a: Math.PI / 2 });
  Object.assign(g.bodies[1], { x: it.x > 0 ? -40 : 40, y: 25 });
  g.turn = 0;
  const m = r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.45 })[0].msg;
  assert.equal(m.pickups.length, 1);
  assert.equal(m.pickups[0].owner, 0);
  assert.equal(g.bodies[0].hp, 40 + FIELD_ITEM.heal);
  assert.equal(g.items.length, 0);
});

test('回復アイテム：体力は最大より上がらない', () => {
  const { r, ms, g } = game('standard');
  g.shots = g.n;
  g.items = [{ id: 1, x: 0, y: 0, r: FIELD_ITEM.r, heal: 25 }];
  g.bodies[0].hp = 90;
  Object.assign(g.bodies[0], { x: -10, y: 0, a: Math.PI / 2 });
  Object.assign(g.bodies[1], { x: 30, y: 25 });
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.45 });
  assert.equal(g.bodies[0].hp, 100);
});

test('ステージ：自分の体力が0になってもライフは減らず、瀕死で残る。敵も回復アイテムを拾える', () => {
  const c = new StageCore('kahen', 1, { name: 't', loadout: resolveLoadout({}, undefined, 1, STAGE_LEVEL_MAX) });
  c.rand = () => 0.99;
  const g = c.s.game;
  // 消しゴムのそばで体力1 → 消しゴムの番に削られて0
  const e = g.bodies[1];
  Object.assign(g.bodies[0], { x: e.x - 6, y: e.y, a: Math.PI / 2 });
  g.bodies[0].hp = 1;
  g.turn = 1;
  c.enemyTurn();
  assert.equal(c.s.stage.lives, 3, 'ライフはそのまま');
  assert.equal(c.s.phase, 'aim');
  assert.equal(g.bodies[0].hp, 0);
  assert.equal(g.bodies[0].state, 'desk');
  assert.ok(g.fx.some((f) => f.kind === 'weak' && f.owner === 0));
  assert.ok(!g.fx.some((f) => f.kind === 'down' && f.owner === 0));
  assert.equal(c.makeBody(g.bodies[0]).weakAtZero, true);
  assert.equal(c.makeBody(g.bodies[1]).weakAtZero, false, '敵は瀕死にならない（0で倒れる）');
  // 敵が拾う：鉛筆の進む先にアイテム
  const d = new StageCore('kahen', 2, { name: 't', loadout: resolveLoadout({}) });
  d.rand = () => 0.99;
  const dg = d.s.game;
  const pen = dg.bodies[1];
  pen.hp = 10;
  dg.items = [{ id: 7, x: pen.x - 8, y: pen.y, r: FIELD_ITEM.r, heal: 25 }];
  Object.assign(dg.bodies[0], { x: -25, y: 15 });
  for (let k = 2; k < dg.bodies.length; k++) Object.assign(dg.bodies[k], { x: 25, y: 18 - k * 8 });
  dg.turn = 1;
  const m = d.handle('E1', { t: 'flick', lx: 0, ly: 0, dx: -1, dy: 0, power: 0.5 })[0].msg;
  assert.equal(m.pickups[0].owner, 1);
  assert.equal(dg.bodies[1].hp, 35);
});

test('ステージ：敵は体力0で倒れる（今までどおり）', () => {
  const c = new StageCore('kahen', 1, { name: 't', loadout: resolveLoadout({}) });
  c.s.game.bodies[1].hp = 0;
  c.finishTurn(0);
  assert.equal(c.s.game.players[1].alive, false);
  assert.equal(c.s.game.boardClear, true);
});

test('回復アイテム：ときどき大回復の救急箱が出て、拾うと大きく回復する', () => {
  const { r, ms, g } = game('standard');
  g.shots = g.n;
  r.rand = () => 0.01; // 出る・救急箱になる
  r.maybeSpawnItem();
  const it = g.items[0];
  assert.equal(it.big, true);
  assert.equal(it.heal, FIELD_ITEM.big.heal);
  assert.equal(it.r, FIELD_ITEM.big.r);
  assert.ok(g.fx.some((f) => f.kind === 'item' && f.big));
  assert.ok(FIELD_ITEM.big.heal > FIELD_ITEM.heal);
  r.rand = () => 0.99;
  Object.assign(it, { x: 0, y: 0 });
  g.bodies[0].hp = 20;
  Object.assign(g.bodies[0], { x: -10, y: 0, a: Math.PI / 2 });
  Object.assign(g.bodies[1], { x: -40, y: 25 });
  g.turn = 0;
  const m = r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.45 })[0].msg;
  assert.equal(m.pickups.length, 1);
  assert.equal(m.pickups[0].big, true);
  assert.equal(g.bodies[0].hp, 20 + FIELD_ITEM.big.heal);
  assert.equal(g.items.length, 0);
});

test('ステージ：コンパスは近くの定規を弾き飛ばすだけで、だれの体力も減らさない', () => {
  // 可変定規編のマップ5「横一列の廊下」の盤面1：鉛筆・消しゴム・コンパス
  const c = new StageCore('kahen', 5, { name: 't', loadout: resolveLoadout({}) });
  c.rand = () => 0.99;
  const g = c.s.game;
  const ci = g.bodies.findIndex((b) => b.specKey === 'en-compass');
  assert.ok(ci > 0);
  const cp = g.bodies[ci];
  // 自分と鉛筆をコンパスのすぐそばに、ほかの敵は遠くに
  Object.assign(g.bodies[0], { x: cp.x - 7, y: cp.y, a: Math.PI / 2 });
  const others = g.bodies.map((b, j) => j).filter((j) => j !== 0 && j !== ci);
  Object.assign(g.bodies[others[0]], { x: cp.x, y: cp.y + 7, a: 0 });
  for (const j of others.slice(1)) Object.assign(g.bodies[j], { x: -40, y: 0 });
  const before = g.bodies.map((b) => b.hp);
  const pos = { x: g.bodies[0].x, y: g.bodies[0].y };
  g.turn = ci;
  const m = c.enemyTurn()[0];
  assert.equal(m.blast.kind, 'compass');
  assert.ok(m.blast.hit.includes(0), '自分も弾かれる');
  assert.equal(m.hits.length, 0, 'ダメージは出ない');
  g.bodies.forEach((b, j) => assert.equal(b.hp, before[j], `体力はそのまま（${j}）`));
  assert.ok(Math.hypot(g.bodies[0].x - pos.x, g.bodies[0].y - pos.y) > 3, '弾き飛ばされて動いた');
});
