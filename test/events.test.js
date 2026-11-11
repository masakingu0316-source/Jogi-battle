// 場のイベント「ヒーリング」「強風」・必殺技の調整（不動の跳ね返し・虹の道・百八十度の照準）・回復の割合
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../public/shared/core.js';
import { StageCore } from '../public/shared/stage-core.js';
import { resolveLoadout, STAGE_LEVEL_MAX } from '../public/shared/catalog.js';
import { EVENTS, SKILL_TUNE, FIELD_ITEM } from '../public/shared/rules.js';
import { stageMaxHp } from '../public/shared/stage.js';

function game(rulers = [], mode = 'standard') {
  const r = new RoomCore('ABCDE', mode);
  r.rand = () => 0.99;
  const ms = [];
  for (let i = 0; i < 2; i++) {
    const m = r.join('P' + i).member;
    if (rulers[i]) r.setLoadout(m.id, resolveLoadout({ ruler: rulers[i] }));
    ms.push(m);
  }
  for (const m of ms) r.handle(m.id, { t: 'ready', on: true });
  const g = r.s.game;
  g.shots = 10; g.turn = 0;
  return { r, ms, g };
}
const flick = (r, id, dx, dy, power, extra = {}) => r.handle(id, { t: 'flick', lx: 0, ly: 0, dx, dy, power, ...extra })[0].msg;

test('イベント「ヒーリング」：全員の体力が最大の30%回復し、その番は机がすべりにくい', () => {
  const { r, g } = game();
  g.bodies[0].hp = 20; g.bodies[1].hp = 90;
  r.startEvent(2, 'heal');
  assert.equal(g.event.type, 'heal');
  assert.equal(g.bodies[0].hp, 20 + EVENTS.heal.pct);
  assert.equal(g.bodies[1].hp, 100, '最大より上には増えない');
  const fx = g.fx.find((f) => f.kind === 'healing');
  assert.equal(fx.healed.length, 2);
  assert.equal(r.buildWorld().params.friction, EVENTS.heal.friction);
  // 1回の番で終わる
  r.rand = () => 0.99;
  flick(r, r.s.members[0].id, 0, 1, 0.05);
  assert.equal(g.event, null);
});

test('イベント「ヒーリング」：同じはじき方でも、すべる距離が短い', () => {
  const slide = (heal) => {
    const { r, ms, g } = game(['ruler:straight30-metal']);
    Object.assign(g.bodies[0], { x: -40, y: -25, a: 0 });
    Object.assign(g.bodies[1], { x: 40, y: 25, a: 0 });
    if (heal) g.event = { type: 'heal', left: 1, id: 1 };
    flick(r, ms[0].id, 0, 1, 0.4);
    return g.bodies[0].y + 25;
  };
  const normal = slide(false), heal = slide(true);
  assert.ok(heal < normal * 0.7, `ふつう ${normal.toFixed(1)}cm / ヒーリング ${heal.toFixed(1)}cm`);
});

test('イベント「強風」：動いている定規だけが風に流される（止まっている定規は動かない）', () => {
  const run = (gale) => {
    const { r, ms, g } = game(['ruler:straight30-metal']);
    Object.assign(g.bodies[0], { x: -20, y: -20, a: 0 });
    Object.assign(g.bodies[1], { x: 30, y: 20, a: 0 });
    if (gale) { r.rand = () => 0; r.startEvent(2, 'gale'); r.rand = () => 0.99; }
    if (gale) assert.equal(g.event.ang, 0, '右向きの風');
    flick(r, ms[0].id, 0, 1, 0.45);
    return { x: g.bodies[0].x, other: { x: g.bodies[1].x, y: g.bodies[1].y } };
  };
  const calm = run(false), wind = run(true);
  assert.ok(Math.abs(calm.x + 20) < 0.5);
  assert.ok(wind.x + 20 > 3, `風で右へ ${(wind.x + 20).toFixed(1)}cm 流された`);
  assert.deepEqual(wind.other, { x: 30, y: 20 }, '止まっている定規は動かない');
});

test('場のイベントは4種類から同じ確率で選ばれる', () => {
  const seen = new Set();
  for (const v of [0, 0.3, 0.55, 0.8]) {
    const { r, g } = game();
    r.rand = () => v;
    r.startEvent(2);
    seen.add(g.event.type);
  }
  assert.deepEqual([...seen].sort(), ['chair', 'gale', 'heal', 'ice']);
});

test('不動：構えている定規に当てた定規は、大きく跳ね返される', () => {
  const back = (repel) => {
    const keep = SKILL_TUNE.anchorRepel;
    SKILL_TUNE.anchorRepel = repel;
    const { r, ms, g } = game(['ruler:straight30-acrylic', 'ruler:straight30-metal']);
    g.bodies[1].anchor = true;
    Object.assign(g.bodies[0], { x: -14, y: 0, a: Math.PI / 2 });
    Object.assign(g.bodies[1], { x: 0, y: 0, a: Math.PI / 2 });
    const m = flick(r, ms[0].id, 1, 0, 0.6);
    SKILL_TUNE.anchorRepel = keep;
    return { x: g.bodies[0].state === 'desk' ? g.bodies[0].x : -Infinity, m };
  };
  const plain = back(0), strong = back(SKILL_TUNE.anchorRepel);
  assert.ok(strong.x < plain.x - 5, `跳ね返しなし ${plain.x.toFixed(1)} / あり ${strong.x.toFixed(1)}`);
  assert.ok(strong.m.marks.some((k) => k.kind === 'repel'));
});

test('虹の道：通った跡に道が残り、次の相手の番だけ、乗った定規が道に沿って進む', () => {
  const { r, ms, g } = game(['ruler:ssr-raden45', 'ruler:straight30-acrylic']);
  g.gauge[0] = 100;
  Object.assign(g.bodies[0], { x: -40, y: -20, a: 0 });
  Object.assign(g.bodies[1], { x: 30, y: 25, a: 0 });
  flick(r, ms[0].id, 1, 0, 0.55, { skill: true });
  const road = g.rainbow;
  assert.ok(road && road.pts.length > 5, '道ができた');
  assert.equal(road.wait, false, '次の相手の番から効く');
  assert.ok(Math.abs(road.pts.at(-1).y - road.pts[0].y) < 2, 'まっすぐ右へ');
  assert.ok(r.snapshot().game.rainbow);
  // 青を道の上に置いて、下向き（道と直角）にはじく → 道に沿って横へ進む
  const mid = road.pts[Math.floor(road.pts.length / 3)];
  Object.assign(g.bodies[1], { x: mid.x, y: mid.y + 1, a: 0 });
  const startX = g.bodies[1].x;
  const m = flick(r, ms[1].id, 0.2, 1, 0.3);
  assert.ok(m.marks.some((k) => k.kind === 'ride'));
  assert.ok(Math.abs(g.bodies[1].x - startX) > 8, `道に沿って ${(g.bodies[1].x - startX).toFixed(1)}cm 進んだ`);
  assert.equal(g.rainbow, null, '相手の番が終わったら消える');
});

test('虹の道：作った本人は道に乗らない', () => {
  const { r, ms, g } = game(['ruler:ssr-raden45', 'ruler:straight30-acrylic']);
  g.rainbow = { id: 1, owner: 0, pts: [{ x: -40, y: 0 }, { x: 40, y: 0 }], wait: false };
  Object.assign(g.bodies[0], { x: 0, y: 0, a: 0 });
  Object.assign(g.bodies[1], { x: 30, y: 25, a: 0 });
  const m = flick(r, ms[0].id, 0, 1, 0.3);
  assert.ok(!m.marks.some((k) => k.kind === 'ride'));
  assert.ok(Math.abs(g.bodies[0].x) < 0.5);
});

test('百八十度：照準の道（traceShot）は、本当にはじいたときの動きと同じ', () => {
  for (const curve of [0, 60, -90]) {
    const { r, ms, g } = game(['ruler:ssr-kinpaku-prot', 'ruler:straight30-acrylic']);
    g.gauge[0] = 100;
    Object.assign(g.bodies[0], { x: -30, y: 0, a: 0.3 });
    Object.assign(g.bodies[1], { x: 40, y: 28, a: 0 });
    const input = { lx: 0.5, ly: 0, dx: 1, dy: 0.2, power: 0.6, skill: true, curve };
    const tr = r.traceShot(input);
    assert.ok(tr && tr.pts.length > 3);
    if (curve) assert.ok(tr.curveAt, '曲がった所も出る');
    const m = r.handle(ms[0].id, { t: 'flick', ...input })[0].msg;
    if (tr.fell) { assert.ok(m.falls.some((f) => f.owner === 0)); continue; }
    const end = tr.pts.at(-1);
    assert.ok(Math.hypot(end.x - g.bodies[0].x, end.y - g.bodies[0].y) < 0.05, `曲げ${curve}°：予想 ${end.x},${end.y} / 実際 ${g.bodies[0].x},${g.bodies[0].y}`);
    // 途中の点も、記録されたコマと同じ
    const f = m.frames[5];
    assert.ok(Math.hypot(tr.pts[5].x - f[0] / 100, tr.pts[5].y - f[1] / 100) < 0.05);
  }
});

test('百八十度：ほかの定規に当たる所で、照準の道は止まる', () => {
  const { r, g } = game(['ruler:ssr-kinpaku-prot', 'ruler:straight30-acrylic']);
  g.gauge[0] = 100;
  Object.assign(g.bodies[0], { x: -20, y: 0, a: 0 });
  Object.assign(g.bodies[1], { x: 0, y: 0, a: Math.PI / 2 });
  const tr = r.traceShot({ lx: 0, ly: 0, dx: 1, dy: 0, power: 0.8, skill: true, curve: 0 });
  assert.ok(tr.hitAt, '当たる所');
  assert.ok(tr.hitAt.x < -3 && tr.hitAt.x > -12, `${tr.hitAt.x}`);
  assert.equal(g.bodies[0].x, -20, '照準の計算では盤面は動かない');
  assert.equal(g.gauge[0], 100);
});

test('回復は体力の最大に対する割合：保健室35%・回復アイテム25%（体力の最大が大きいほど多く回復）', () => {
  const lv = STAGE_LEVEL_MAX;
  const c = new StageCore('kahen', 1, { name: 't', loadout: resolveLoadout({}, undefined, lv, lv) });
  c.rand = () => 0.99;
  const g = c.s.game;
  const me = g.bodies[0];
  const max = stageMaxHp(lv);
  assert.ok(max > 100);
  // 保健室
  me.hp = 10;
  c.useNow(0, 'heal');
  assert.equal(me.hp, Math.round((10 + max * SKILL_TUNE.heal / 100) * 10) / 10);
  // 回復アイテム
  me.hp = 10;
  g.items = [{ id: 1, x: me.x + 6, y: me.y, r: FIELD_ITEM.r, heal: FIELD_ITEM.heal }];
  for (let k = 1; k < g.bodies.length; k++) Object.assign(g.bodies[k], { x: me.x + 30 + k * 6, y: me.y + 20 });
  Object.assign(me, { a: Math.PI / 2 });
  const m = c.handle(g.order[0], { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.3 })[0].msg;
  assert.equal(m.pickups.length, 1);
  assert.ok(Math.abs(m.pickups[0].amount - max * FIELD_ITEM.heal / 100) < 0.11, `${m.pickups[0].amount}`);
});
