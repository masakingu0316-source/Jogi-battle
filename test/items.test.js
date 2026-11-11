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

test('対人：体力が0になったら、机の上に残っていても倒れて決着する', () => {
  const { r, ms, g } = game();
  g.bodies[1].hp = 1;
  const m = hit(r, ms, g);
  assert.equal(m.t, 'shot');
  assert.equal(g.players[1].alive, false);
  assert.equal(g.players[1].ko, true);
  assert.equal(g.players[1].selfOut, false);
  assert.equal(g.result.winners[0], 0);
  assert.match(g.result.reason, /体力が0/);
  assert.equal(g.kos[0], 1, '倒した人の手柄になる');
  assert.ok(g.fx.some((f) => f.kind === 'down' && f.owner === 1 && f.how === 'ko'));
});

test('対人：乱戦で1人が体力0になっても、残りの人で続く。身代わりがあれば最大の半分で戻る', () => {
  const { r, ms, g } = game('melee');
  g.bodies[1].hp = 1;
  hit(r, ms, g);
  assert.equal(g.players[1].alive, false);
  assert.equal(g.result, null);
  assert.equal(r.s.phase, 'aim');
  const b = game();
  b.g.bodies[1].hp = 1; b.g.bodies[1].sub = true;
  hit(b.r, b.ms, b.g);
  assert.equal(b.g.players[1].alive, true);
  assert.equal(b.g.bodies[1].hp, 50);
  assert.equal(b.g.bodies[1].state, 'desk');
});

test('対人：インク漏れで体力が0になったら、その人の番は来ずに倒れる', () => {
  const { r, ms, g } = game('melee');
  g.shots = g.n;
  g.bodies[1].hp = SKILL_TUNE.inkDmg - 1; g.bodies[1].ink = 2;
  Object.assign(g.bodies[0], { x: -30, y: 0 });
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  assert.equal(g.players[1].alive, false);
  assert.equal(g.turn, 2, '次の人の番へ');
});

test('回復アイテム：2周目から確率で空いている所に出て、触れた定規が回復し、アイテムは消える', () => {
  const { r, ms, g } = game('standard');
  // 1周目は出ない
  r.rand = () => 0.01;
  r.maybeSpawnItem();
  assert.equal((g.items || []).length, 0);
  g.shots = g.n;
  r.maybeSpawnItem();
  assert.equal(g.items.length, 1);
  const it = g.items[0];
  assert.equal(it.heal, FIELD_ITEM.heal);
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

test('ステージ：自分の体力が0になったらライフを1つ使って戻る。敵も回復アイテムを拾える', () => {
  const c = new StageCore('kahen', 1, { name: 't', loadout: resolveLoadout({}, undefined, 1, STAGE_LEVEL_MAX) });
  c.rand = () => 0.99;
  const g = c.s.game;
  // 消しゴムのそばで体力1 → 消しゴムの番に削られて0
  const e = g.bodies[1];
  Object.assign(g.bodies[0], { x: e.x - 6, y: e.y, a: Math.PI / 2 });
  g.bodies[0].hp = 1;
  g.turn = 1;
  c.enemyTurn();
  assert.equal(c.s.stage.lives, 2);
  assert.equal(c.s.phase, 'aim');
  assert.equal(g.bodies[0].hp, Math.round(stageMaxHp(1) / 2));
  assert.ok(g.fx.some((f) => f.kind === 'down' && f.owner === 0));
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
