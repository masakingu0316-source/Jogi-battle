import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore, cleanName, START_WAIT_MS } from '../public/shared/core.js';
import { DESKS, deskTiles, tilesConnected, pickVanish, CRIT, GAUGE, chairSides } from '../public/shared/rules.js';
import { resolveLoadout, sanitizeConfig } from '../public/shared/catalog.js';
import Physics from '../public/shared/physics.js';
const { RULERS } = Physics;

const lastState = (out) => out.find((o) => o.msg.t === 'state' || o.msg.t === 'shot')?.msg.state;

function room(n, mode = 'standard', now = 1000) {
  const r = new RoomCore('ABCDE', mode, now);
  r.rand = () => 0.99; // クリティカルは出さない（出すテストでは差し替える）
  const ms = [];
  for (let i = 0; i < n; i++) ms.push(r.join('P' + i, null, null, now).member);
  return { r, ms };
}
// 全員が準備OKを押す
const readyAll = (r, ms, now = 2000) => ms.map((m) => r.handle(m.id, { t: 'ready', on: true }, now)).at(-1);
// 部屋を作って全員準備OKで始める
function started(n, mode = 'standard') {
  const x = room(n, mode);
  readyAll(x.r, x.ms);
  assert.equal(x.r.s.phase, 'aim');
  return x;
}

// 現在の手番の人が、相手の方向へ真ん中をはじく
function flickToward(r, power = 0.6) {
  const g = r.s.game;
  const me = g.bodies[g.turn];
  const target = g.bodies.find((b, i) => i !== g.turn && b.state === 'desk');
  return r.handle(g.order[g.turn], { t: 'flick', lx: 0, ly: 0, dx: target.x - me.x, dy: target.y - me.y, power });
}

// 1周目を終えたことにして、相手（青）を机の右端ぎりぎりに置く
function pushToEdge(r) {
  const g = r.s.game;
  g.shots = g.n;
  g.turn = 0;
  Object.assign(g.bodies[1], { x: 28, y: 0, a: Math.PI / 2 });
  Object.assign(g.bodies[0], { x: 14, y: 0, a: Math.PI / 2 });
}

test('名前は10文字までで、空ならゲスト', () => {
  assert.equal(cleanName('  '), 'ゲスト');
  assert.equal(cleanName('<b>あいうえおかきくけこさ'), 'bあいうえおかきくけ');
});

test('モードは部屋を作るときに決まり、定員を超えては入れない', () => {
  const { r, ms } = room(2, 'standard');
  assert.equal(r.s.hostId, ms[0].id);
  assert.match(r.join('X').error, /満員.*2人まで/);
  const melee = room(4, 'melee');
  assert.match(melee.r.join('X').error, /4人まで/);
  assert.equal(new RoomCore('Z', 'ないモード').s.mode, 'standard');
});

test('全員が準備OKを押すと始まる。1人でも準備中なら始まらない', () => {
  const { r, ms } = room(2);
  r.handle(ms[0].id, { t: 'ready', on: true }, 2000);
  assert.equal(r.s.phase, 'lobby');
  r.handle(ms[0].id, { t: 'ready', on: false }, 2001);
  r.handle(ms[1].id, { t: 'ready', on: true }, 2002);
  assert.equal(r.s.phase, 'lobby');
  const st = lastState(r.handle(ms[0].id, { t: 'ready', on: true }, 2003));
  assert.equal(st.phase, 'aim');
  assert.equal(st.game.n, 2);
  assert.ok(st.members.every((m) => !m.ready));
});

test('人数がそろうと1分のカウントダウン。新しい人が入るとやり直し、時間切れで全員で始まる', () => {
  const r = new RoomCore('A', 'melee', 0);
  r.join('a', null, null, 0); r.join('b', null, null, 0);
  assert.equal(r.s.startAt, null); // 乱戦は3人から
  assert.equal(r.snapshot(0).startIn, null);
  r.join('c', null, null, 10_000);
  assert.equal(r.s.startAt, 10_000 + START_WAIT_MS);
  assert.equal(r.snapshot(40_000).startIn, START_WAIT_MS - 30_000);
  r.join('d', null, null, 50_000); // 4人目で数え直し
  assert.equal(r.s.startAt, 50_000 + START_WAIT_MS);
  assert.equal(r.tick(50_000 + START_WAIT_MS - 1), false);
  assert.equal(r.tick(50_000 + START_WAIT_MS), true);
  assert.equal(r.s.game.n, 4);
});

test('人数が足りなくなったらカウントダウンは止まる', () => {
  const { r, ms } = room(2, 'quick', 0);
  assert.notEqual(r.s.startAt, null);
  r.disconnect(ms[1].id, 5000);
  assert.equal(r.s.startAt, null);
  assert.equal(r.tick(10 * START_WAIT_MS), false);
});

test('部屋を出ると席が空き、残った人が全員準備OKなら始まる', () => {
  const { r, ms } = room(4, 'melee');
  for (const m of ms.slice(0, 3)) r.handle(m.id, { t: 'ready', on: true }, 2000);
  const out = r.handle(ms[3].id, { t: 'leave' }, 3000);
  assert.equal(out[0].msg.t, 'left');
  assert.equal(r.s.members.length, 3);
  assert.equal(r.s.phase, 'aim');
});

test('自分の番以外ははじけない。はじくと動きのコマと次の手番が届く', () => {
  const { r, ms } = started(2);
  assert.match(r.handle(ms[1].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 1 })[0].msg.text, /あなたの番ではありません/);
  const out = flickToward(r);
  const shot = out[0].msg;
  assert.equal(shot.t, 'shot');
  assert.ok(shot.frames.length > 3);
  assert.equal(shot.frames[0].length, 2 * 4);
  assert.equal(shot.state.game.turn, 1);
});

test('おかしな入力は受け付けない', () => {
  const { r, ms } = started(2);
  assert.match(r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 0, power: 1 })[0].msg.text, /向き/);
  assert.match(r.handle(ms[0].id, { t: 'flick', lx: 'a', ly: 0, dx: 1, dy: 0, power: 1 })[0].msg.text, /正しくありません/);
});

test('1周目に落ちた定規は元の席に戻り、脱落しない', () => {
  const { r, ms } = room(2, 'quick');
  r.setLoadout(ms[0].id, resolveLoadout({ ruler: 'ruler:straight15-acrylic' }));
  r.setLoadout(ms[1].id, resolveLoadout({ ruler: 'ruler:straight15-acrylic' }));
  readyAll(r, ms);
  // 試作で1手目に落とせた打ち方（端をはじいて回転させる）
  const shot = r.handle(ms[0].id, { t: 'flick', lx: -8.5, ly: 0, dx: 1, dy: 0, power: 1 })[0].msg;
  assert.equal(shot.state.phase, 'aim');
  assert.ok(shot.state.game.players.every((p) => p.alive));
  assert.ok(shot.state.game.bodies.every((b) => b.state === 'desk'));
});

test('2周目以降に落ちたら決着し、勝ち数が増える。結果を残したまま部屋に戻り、1分数え直す', () => {
  const { r } = started(2, 'quick');
  pushToEdge(r);
  const before = Date.now();
  const st = flickToward(r, 1)[0].msg.state;
  assert.equal(st.phase, 'lobby');
  assert.ok(st.startIn > START_WAIT_MS - 5000);
  assert.ok(st.members.every((m) => !m.ready));
  assert.ok(r.s.startAt >= before + START_WAIT_MS);
  assert.ok(st.game.result.title.endsWith('の勝ち！'));
  assert.equal(Object.values(st.wins).reduce((a, b) => a + b, 0), 1);
  assert.equal(st.game.result.winners[0], 0);
});

test('乱戦：脱落した人の番は飛ばす', () => {
  const { r } = started(3, 'melee');
  const g = r.s.game;
  g.shots = 10; // 1周目の保護を外す
  g.players[1].alive = false;
  g.bodies[1].state = 'gone';
  r.advanceTurn();
  assert.equal(g.turn, 2);
  r.advanceTurn();
  assert.equal(g.turn, 0);
});

test('チーム戦：相手チームが全員落ちたら勝ち', () => {
  const { r } = started(4, 'team');
  const g = r.s.game;
  g.shots = 10;
  g.bodies[1].state = 'gone';
  g.bodies[3].state = 'gone';
  r.finishTurn(0);
  assert.equal(r.s.phase, 'lobby');
  assert.equal(g.result.title, 'Aチームの勝ち！');
  assert.deepEqual(g.result.winners, [0, 2]);
});

test('対戦中に切れても、トークンで同じ席に戻れる', () => {
  const { r, ms } = started(2);
  r.disconnect(ms[1].id);
  assert.equal(r.member(ms[1].id).connected, false);
  const back = r.join('別名', ms[1].token);
  assert.equal(back.member.id, ms[1].id);
  assert.equal(back.member.connected, true);
  assert.match(r.join('新人').error, /対戦中|満員/);
});

test('部屋で抜けたら席が空き、部屋主は次の人に移る', () => {
  const { r, ms } = room(3, 'melee');
  r.disconnect(ms[0].id);
  assert.equal(r.s.members.length, 2);
  assert.equal(r.s.hostId, ms[1].id);
});

test('切れた人の番は部屋主が飛ばせる', () => {
  const { r, ms } = started(2);
  assert.match(r.handle(ms[0].id, { t: 'skip' })[0].msg.text, /接続している人/);
  r.disconnect(ms[0].id); // 部屋主が切れると、部屋主は残った人に移る
  assert.equal(r.s.hostId, ms[1].id);
  r.handle(ms[1].id, { t: 'skip' });
  assert.equal(r.s.game.turn, 1);
});

test('保存して復元しても続きができる', () => {
  const { r } = started(2);
  flickToward(r);
  const copy = RoomCore.restore(JSON.parse(JSON.stringify(r.toJSON())));
  assert.equal(copy.s.game.turn, 1);
  assert.equal(flickToward(copy)[0].msg.t, 'shot');
});

test('再戦は先手が交代する。対戦中に抜けた人は決着時に席が空く', () => {
  const { r, ms } = started(2, 'quick');
  pushToEdge(r);
  flickToward(r, 1);
  assert.equal(r.s.phase, 'lobby');
  readyAll(r, ms, Date.now());
  assert.equal(r.s.game.turn, 1);
  assert.equal(r.s.game.id, 2);
  r.handle(ms[1].id, { t: 'leave' });
  assert.equal(r.member(ms[1].id).connected, false);
  pushToEdge(r); r.s.game.turn = 0;
  flickToward(r, 1);
  assert.equal(r.s.phase, 'lobby');
  assert.equal(r.s.members.length, 1);
  assert.equal(r.s.startAt, null);
});

test('ログイン中の人は、トークンがなくても同じアカウントなら同じ席に戻る', () => {
  const r = new RoomCore('ABCDE');
  const a = r.join('x', null, { id: 'u1', name: 'アカウント名' }).member;
  const b = r.join('y').member;
  readyAll(r, [a, b]);
  r.disconnect(a.id);
  const back = r.join('別の端末', null, { id: 'u1', name: 'アカウント名' });
  assert.equal(back.member.id, a.id);
  assert.equal(back.member.name, 'アカウント名');
});

test('決着すると、アカウントの記録が1回だけ取り出せる（相手を落とした数つき）', () => {
  const r = new RoomCore('ABCDE');
  const a = r.join('x', null, { id: 'u1', name: 'A' }).member;
  const b = r.join('ゲスト').member;
  readyAll(r, [a, b]);
  pushToEdge(r);
  flickToward(r, 1);
  const rec = r.takeRecord();
  assert.ok(rec);
  assert.equal(r.takeRecord(), null);
  assert.equal(rec.players[0].userId, 'u1');
  assert.equal(rec.players[1].userId, null);
  assert.equal(rec.players[0].kos, 1);
  assert.equal(rec.players[0].ruler, 'ruler:straight30-acrylic');
});

test('アクセサリの効果は対戦の定規に引き継がれる', () => {
  const { r, ms } = room(2);
  r.setLoadout(ms[0].id, resolveLoadout({ ruler: 'ruler:straight30-metal', acc: 'acc:goldclip', pattern: 'pattern:stars' }));
  readyAll(r, ms);
  const b = r.s.game.bodies[0];
  assert.equal(b.specKey, 'straight30-metal');
  assert.equal(b.mods.mass, 1.05);
  assert.equal(b.pattern, 'pattern:stars');
  assert.equal(r.buildWorld().bodies[0].m.toFixed(2), (RULERS['straight30-metal'].mass * 1.05).toFixed(2));
});

test('どの形・素材の定規でも、はじく点は定規の上に収まり、動きが壊れない', () => {
  for (const key of Object.keys(RULERS)) {
    const { r, ms } = room(2, 'quick');
    r.setLoadout(ms[0].id, resolveLoadout({ ruler: 'ruler:' + key }));
    r.setLoadout(ms[1].id, resolveLoadout({ ruler: 'ruler:' + key }, undefined, 10));
    readyAll(r, ms);
    assert.equal(r.s.game.bodies[1].level, 10);
    // 定規から遠い点を指定しても受け付け、はじいたあとも数値が正しい
    const shot = r.handle(ms[0].id, { t: 'flick', lx: 40, ly: -40, dx: 0.3, dy: -1, power: 1 })[0].msg;
    assert.ok(shot.frames.length > 1, key);
    for (const f of shot.frames) assert.ok(f.every(Number.isFinite), key);
  }
});

test('レベルが上がると、重さとはじく力が少しだけ上がる（アクセサリと合わせて最大10%）', () => {
  const lv1 = resolveLoadout({ ruler: 'ruler:straight30-acrylic' }, undefined, 1);
  const lv10 = resolveLoadout({ ruler: 'ruler:straight30-acrylic' }, undefined, 10);
  assert.deepEqual(lv1.mods, { mass: 1, mu: 1, power: 1 });
  assert.equal(lv10.mods.power, 1.036);
  assert.equal(lv10.mods.mass, 1.036);
  const both = resolveLoadout({ ruler: 'ruler:straight30-acrylic', acc: 'acc:goldcot' }, undefined, 99);
  assert.equal(both.level, 10);
  assert.ok(both.mods.power <= 1.1 && both.mods.power > 1.08);
});


test('乱戦で残りが2人になると、消える机を予告し、1周（2人が1回ずつ）ごとに1台ずつ消える（最後は1台）', () => {
  const { r, ms } = started(4, 'melee');
  const g = r.s.game;
  g.shots = 10;
  // 赤・青が落ちて、緑・黄の2人が残る
  g.bodies[0].state = 'gone'; g.bodies[1].state = 'gone';
  r.finishTurn(0);
  assert.equal(r.s.phase, 'aim');
  assert.equal(g.desks.length, 4);
  assert.notEqual(g.vanish, null, '残り2人になったら予告する');
  assert.equal(r.snapshot().game.vanish, g.vanish);
  const seen = [];
  const desk = DESKS.group;
  while (g.desks.length > 1) {
    const v = g.vanish;
    // 予告された机にいない場所へ2人を置いて、消えても落ちないようにする
    const safe = deskTiles(desk).filter((t) => g.desks.includes(t.i) && t.i !== v);
    g.bodies[2].x = (safe[0].x0 + safe[0].x1) / 2; g.bodies[2].y = (safe[0].y0 + safe[0].y1) / 2;
    g.bodies[3].x = (safe.at(-1).x0 + safe.at(-1).x1) / 2 + 3; g.bodies[3].y = (safe.at(-1).y0 + safe.at(-1).y1) / 2;
    assert.equal(g.vanishIn, 2);
    // 1人目がはじいても、まだ消えない
    const first = r.handle(g.order[g.turn], { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.05 })[0].msg;
    assert.equal(first.vanished, null);
    assert.equal(g.vanish, v);
    assert.equal(first.state.game.vanishIn, 1);
    // 2人目がはじいて1周が終わると消える
    const shot = r.handle(g.order[g.turn], { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.05 })[0].msg;
    assert.equal(shot.vanished.desk, v);
    assert.ok(!g.desks.includes(v));
    assert.ok(tilesConnected(desk, g.desks), '残った机は辺でつながっている');
    seen.push(v);
  }
  assert.equal(g.desks.length, 1);
  assert.equal(g.vanish, null, '最後の1台は消さない');
  assert.equal(new Set(seen).size, 3);
});

test('机が消える予告のあと、残った2人が必ず1回ずつ番を終えるまで消えない（連打の1打目は数えない・時間切れは1回）', () => {
  const { r, ms } = started(3, 'melee');
  const g = r.s.game;
  g.shots = 10;
  g.bodies[0].state = 'gone';
  r.finishTurn(0);
  const v = g.vanish;
  assert.notEqual(v, null);
  assert.deepEqual([...g.vanishWait].sort(), [1, 2]);
  assert.deepEqual(r.snapshot().game.vanishWait, g.vanishWait);
  // 2人とも消えない机の上に置く
  const safe = deskTiles(DESKS.group).filter((t) => t.i !== v && g.desks.includes(t.i));
  for (const [k, t] of [[1, safe[0]], [2, safe.at(-1)]]) Object.assign(g.bodies[k], { x: (t.x0 + t.x1) / 2, y: (t.y0 + t.y1) / 2 });
  const a = g.turn, b = a === 1 ? 2 : 1;
  // 1人目は連打：1打目のあとはまだ番の途中
  g.bodies[a].skill = 'double'; g.gauge[a] = GAUGE.max;
  r.handle(g.order[a], { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.05, skill: true });
  assert.equal(g.turn, a);
  assert.deepEqual([...g.vanishWait].sort(), [1, 2], '連打の1打目では数えない');
  const second = r.handle(g.order[a], { t: 'flick', lx: 0, ly: 0, dx: -1, dy: 0, power: 0.05 })[0].msg;
  assert.equal(second.vanished, null);
  assert.deepEqual(g.vanishWait, [b]);
  assert.equal(second.state.game.vanishIn, 1);
  // 2人目は切れて、時間切れ（飛ばし）でも1回と数え、ここで消える
  r.disconnect(g.order[b]);
  const host = r.s.hostId;
  const out = r.handle(host, { t: 'skip' })[0].msg;
  assert.equal(out.vanished?.desk, v);
  assert.ok(!g.desks.includes(v));
  // すぐ次の机を予告し、また2人を待つ
  if (g.desks.length > 1) assert.equal(g.vanishWait.length, 2);
});

test('消えた机に乗っていた定規は落ち、はじいた人の手柄にはならない', () => {
  const { r } = started(3, 'melee');
  const g = r.s.game;
  g.shots = 10;
  g.bodies[0].state = 'gone';
  r.finishTurn(0);
  const v = g.vanish;
  const t = deskTiles(DESKS.group)[v];
  // 予告のあとの最後の番にする（もう1人は番を終えたことにする）。はじく人ではない方の定規を、消える机の真ん中に置く
  const shooter = g.turn, other = shooter === 1 ? 2 : 1;
  g.vanishWait = [shooter]; g.vanishIn = 1;
  Object.assign(g.bodies[other], { x: (t.x0 + t.x1) / 2, y: (t.y0 + t.y1) / 2 });
  const safe = deskTiles(DESKS.group).find((x) => x.i !== v && g.desks.includes(x.i));
  Object.assign(g.bodies[shooter], { x: (safe.x0 + safe.x1) / 2, y: (safe.y0 + safe.y1) / 2 });
  const shot = r.handle(g.order[shooter], { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 })[0].msg;
  assert.deepEqual(shot.vanished.drops, [other]);
  assert.equal(r.s.phase, 'lobby');
  assert.deepEqual(g.result.winners, [shooter]);
  assert.match(g.result.reason, /机が消えて/);
  assert.equal(g.kos[shooter], 0);
  assert.equal(g.players[other].selfOut, false);
  assert.match(g.result.outOrder.at(-1), /机が消えた/);
});

test('1対1や、残りが3人以上のときは机は消えない', () => {
  const a = started(2, 'standard');
  a.r.s.game.shots = 10;
  a.r.finishTurn(0);
  assert.equal(a.r.s.game.vanish, null);
  const b = started(4, 'melee');
  b.r.s.game.shots = 10;
  b.r.s.game.bodies[0].state = 'gone';
  b.r.finishTurn(0);
  assert.equal(b.r.s.game.vanish, null);
});

test('消える机はランダムでも、残りが角だけで接する2台にはならない', () => {
  const desk = DESKS.group;
  for (let k = 0; k < 4; k++) {
    for (let x = 0; x < 1; x += 0.05) {
      const first = pickVanish(desk, [0, 1, 2, 3], () => (k + 0.5) / 4);
      const left = [0, 1, 2, 3].filter((i) => i !== first);
      const second = pickVanish(desk, left, () => x);
      assert.ok(tilesConnected(desk, left.filter((i) => i !== second)));
    }
  }
});

test('クリティカル：当てた相手が大きく弾かれ、当たった場所が届く', () => {
  const run = (crit) => {
    const { r, ms } = started(2, 'quick');
    r.rand = () => (crit ? 0 : 0.99);
    const g = r.s.game;
    g.shots = 10; g.turn = 0;
    Object.assign(g.bodies[0], { x: -6, y: 0, a: Math.PI / 2 });
    Object.assign(g.bodies[1], { x: 2, y: 0, a: Math.PI / 2 });
    const shot = r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.5 })[0].msg;
    return { shot, moved: g.bodies[1].state === 'desk' ? g.bodies[1].x - 2 : Infinity };
  };
  const normal = run(false), crit = run(true);
  assert.equal(normal.shot.crit, null);
  assert.ok(crit.shot.crit, 'クリティカルの記録');
  assert.equal(crit.shot.crit.target, 1);
  assert.ok(crit.shot.crit.f > 0 && crit.shot.crit.f < crit.shot.frames.length);
  assert.ok(crit.moved > normal.moved * 1.5, `通常 ${normal.moved.toFixed(1)}cm → クリティカル ${crit.moved.toFixed(1)}cm`);
});

test('クリティカルに当たっても、だれにも当たらなければ何も起きない', () => {
  const { r, ms } = started(2, 'quick');
  r.rand = () => 0;
  const g = r.s.game;
  g.shots = 10; g.turn = 0;
  const shot = r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: -0.2, dy: 1, power: 0.2 })[0].msg;
  assert.equal(shot.crit, null);
  assert.equal(CRIT.mul > 1, true);
});

// ---- 必殺技 ----
function skillGame(myRuler, otherRuler = 'ruler:straight30-acrylic') {
  const { r, ms } = started(2, 'standard');
  r.s.phase = 'lobby';
  r.setLoadout(ms[0].id, resolveLoadout({ ruler: myRuler }));
  r.setLoadout(ms[1].id, resolveLoadout({ ruler: otherRuler }));
  readyAll(r, ms, 5000);
  const g = r.s.game;
  g.shots = 10; g.turn = 0;
  return { r, ms, g };
}

test('必殺技：ゲージがたまっていないと使えない。使うとゲージは0に戻る', () => {
  const { r, ms, g } = skillGame('ruler:straight30-acrylic');
  const out = r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.3, skill: true });
  assert.equal(out[0].msg.t, 'error');
  g.gauge[0] = 100;
  const ok = r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.3, skill: true })[0].msg;
  assert.equal(ok.skill, 'power');
  assert.equal(g.gauge[0], 0);
});

test('ゲージは1周ごとにたまる（はじく・当てる・当てられるでは、たまらない）。たまりやすさは定規ごと', () => {
  const { r, ms, g } = skillGame('ruler:straight30-acrylic');
  Object.assign(g.bodies[0], { x: -6, y: 0, a: Math.PI / 2 });
  Object.assign(g.bodies[1], { x: 2, y: 0, a: Math.PI / 2 });
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.5 });
  assert.deepEqual(g.gauge, [0, 0], '当てても、1周するまではたまらない');
  r.handle(ms[1].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  assert.deepEqual(g.gauge, [GAUGE.charge, GAUGE.charge], '2人とも1回ずつはじいたら1周');
  assert.equal(g.lap, 1);
  assert.equal(g.fx.at(-1).kind, 'lap');
  // 定規ごとのたまりやすさ（設定で変えた値）
  const cfg = sanitizeConfig({ brands: { 'ruler:straight15-acrylic': { charge: 50 } } });
  assert.equal(cfg.brands['ruler:straight15-acrylic'].charge, 50);
  assert.equal(resolveLoadout({ ruler: 'ruler:straight15-acrylic' }, cfg).charge, 50);
  assert.equal(resolveLoadout({ ruler: 'ruler:straight30-acrylic' }, cfg).charge, GAUGE.charge);
  assert.equal(sanitizeConfig({ brands: { 'ruler:straight15-acrylic': { charge: 999 } } }).brands['ruler:straight15-acrylic'].charge, GAUGE.chargeMax);
  assert.equal(sanitizeConfig({ brands: { 'ruler:straight15-acrylic': { charge: GAUGE.charge } } }).brands['ruler:straight15-acrylic'], undefined, '初期値と同じなら持たない');
  const g2 = skillGame('ruler:straight15-acrylic');
  g2.r.s.game.bodies[0].charge = 50;
  g2.r.handle(g2.ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: -1, power: 0.05 });
  g2.r.handle(g2.ms[1].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  assert.deepEqual(g2.g.gauge, [50, GAUGE.charge]);
});

test('1周：連打の2打目は同じ番。倒れた人は数えない（3人で1人倒れたら、残りの2人で1周）', () => {
  const { r } = started(3, 'melee');
  const g = r.s.game;
  g.shots = 10;
  const shoot = () => { const i = g.turn; r.handle(g.order[i], { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 0.01, power: 0.02 }); return i; };
  shoot(); shoot();
  assert.deepEqual(g.gauge, [0, 0, 0]);
  shoot();
  assert.deepEqual(g.gauge, [25, 25, 25]);
  // 次の番の人以外の1人を倒す
  const out = [0, 1, 2].find((i) => i !== g.turn);
  g.players[out].alive = false; g.bodies[out].state = 'gone';
  shoot(); shoot();
  assert.equal(g.gauge[out], 25, '倒れた人にはたまらない');
  assert.deepEqual([0, 1, 2].filter((i) => i !== out).map((i) => g.gauge[i]), [50, 50]);
});

test('剛腕：同じ力でも、ずっと遠くまですべる', () => {
  const dist = (skill) => {
    const { r, ms, g } = skillGame('ruler:straight30-acrylic');
    g.gauge[0] = 100;
    Object.assign(g.bodies[0], { x: -40, y: -25, a: 0 });
    Object.assign(g.bodies[1], { x: 40, y: 25, a: 0 });
    r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.5, skill });
    return g.bodies[0].y + 25;
  };
  assert.ok(dist(true) > dist(false) * 1.8);
});

test('連打：止まったあと、同じ人がもう1回はじける（2打目のあとで番が移る）', () => {
  const { r, ms, g } = skillGame('ruler:straight15-acrylic');
  g.gauge[0] = 100;
  const first = r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.2, skill: true })[0].msg;
  assert.equal(first.skill, 'double');
  assert.equal(g.turn, 0);
  assert.equal(first.state.game.extra, true);
  const again = r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: -1, power: 0.2, skill: true })[0].msg;
  assert.equal(again.t, 'error', '2打目では必殺技は使えない');
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: -1, power: 0.2 });
  assert.equal(g.turn, 1);
  assert.equal(g.extra, false);
});

test('突風：止まった場所の近くの定規が吹き飛ぶ（遠くの定規は動かない）', () => {
  const { r, ms, g } = skillGame('ruler:tri60-acrylic');
  g.gauge[0] = 100;
  Object.assign(g.bodies[0], { x: -10, y: 0, a: 0 });
  Object.assign(g.bodies[1], { x: 0, y: 0, a: Math.PI / 2 });
  const shot = r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05, skill: true })[0].msg;
  assert.equal(shot.skill, 'wind');
  assert.deepEqual(shot.blast.hit, [1]);
  assert.ok(shot.blast.f > 0 && shot.blast.f < shot.frames.length);
  assert.ok(g.bodies[1].state !== 'desk' || g.bodies[1].x > 15, `吹き飛んだ距離 ${g.bodies[1].x}`);
  // 遠くの定規は動かない
  const far = skillGame('ruler:tri60-acrylic');
  far.g.gauge[0] = 100;
  Object.assign(far.g.bodies[0], { x: -30, y: 0, a: 0 });
  Object.assign(far.g.bodies[1], { x: 25, y: 0, a: Math.PI / 2 });
  const s2 = far.r.handle(far.ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05, skill: true })[0].msg;
  assert.deepEqual(s2.blast.hit, []);
  assert.equal(far.g.bodies[1].x, 25);
});

test('不動：次の自分の番まで押されにくく、自分の番が来たら元に戻る', () => {
  const pushed = (anchor) => {
    const { r, ms, g } = skillGame('ruler:straight30-metal', 'ruler:straight30-metal');
    g.gauge[0] = 100;
    Object.assign(g.bodies[0], { x: 0, y: 0, a: Math.PI / 2 });
    Object.assign(g.bodies[1], { x: -12, y: -25, a: Math.PI / 2 });
    // 赤が（不動を使って／使わずに）ほとんど動かないはじきをする
    r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05, skill: anchor });
    assert.equal(!!g.bodies[0].anchor, anchor);
    const x0 = g.bodies[0].x;
    Object.assign(g.bodies[1], { x: x0 - 9, y: g.bodies[0].y, a: Math.PI / 2 });
    r.handle(ms[1].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.7 });
    assert.equal(g.turn, 0);
    assert.equal(!!g.bodies[0].anchor, false, '自分の番が来たら不動は終わる');
    return g.bodies[0].state === 'desk' ? g.bodies[0].x - x0 : Infinity;
  };
  const normal = pushed(false), anchored = pushed(true);
  assert.ok(anchored < normal / 2, `ふつう ${normal.toFixed(1)}cm / 不動 ${anchored.toFixed(1)}cm`);
});

test('コンピュータ：どの強さでも、はじき方を決めて実際にはじける。つよいはやさしいに勝ち越す', async () => {
  const { planShot, CPU_LEVELS } = await import('../public/shared/cpu.js');
  for (const lv of Object.keys(CPU_LEVELS)) {
    const { r, ms } = started(2, 'standard');
    const shot = await planShot(r, lv);
    for (const k of ['lx', 'ly', 'dx', 'dy', 'power']) assert.ok(Number.isFinite(shot[k]), `${lv} ${k}`);
    assert.equal(r.handle(ms[0].id, { t: 'flick', ...shot })[0].msg.t, 'shot');
  }
  // つよい（赤）とやさしい（青）を、先手を入れ替えながら6回（乱数は固定）
  let seed = 12345;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let strong = 0;
  for (let n = 0; n < 6; n++) {
    const { r } = started(2, 'standard');
    r.s.game.turn = n % 2;
    for (let k = 0; k < 60 && r.s.phase === 'aim'; k++) {
      const g = r.s.game;
      const shot = await planShot(r, g.turn === 0 ? 'hard' : 'easy', rand);
      r.handle(g.order[g.turn], { t: 'flick', ...shot });
    }
    if (r.s.game.result?.winners.includes(0)) strong++;
  }
  assert.ok(strong >= 4, `つよいの勝ち ${strong}/6`);
});

// ---- 場のイベント ----
test('場のイベント：2周目から確率で起き、こおりは1回、いすは1周で終わる', () => {
  const { r, ms } = started(2, 'standard');
  const g = r.s.game;
  r.rand = () => 0; // かならず起きる・こおりを選ぶ
  r.handle(g.order[g.turn], { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  assert.equal(g.event, null, '1周目は起きない');
  r.handle(g.order[g.turn], { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  assert.equal(g.event?.type, 'ice');
  assert.equal(r.snapshot().game.event.type, 'ice');
  r.rand = () => 0.99;
  r.handle(g.order[g.turn], { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  assert.equal(g.event, null, 'こおりは1回で終わる');
  // いす
  r.rand = () => 0.7; // 起きる確率(0.2)より大きいので起きない
  r.handle(g.order[g.turn], { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  assert.equal(g.event, null);
  r.startEvent(2, 'chair');
  assert.equal(g.event.type, 'chair');
  assert.equal(g.event.left, 2);
  r.rand = () => 0.99;
  r.handle(g.order[g.turn], { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  assert.equal(g.event?.type, 'chair');
  r.handle(g.order[g.turn], { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  assert.equal(g.event, null, 'いすは1周で終わる');
  void ms;
});

test('こおり：同じはじき方でも、ずっと遠くまですべる', () => {
  const slide = (ice) => {
    const { r, ms, g } = skillGame('ruler:straight30-metal');
    if (ice) g.event = { type: 'ice', left: 1, id: 1 };
    Object.assign(g.bodies[0], { x: -40, y: -25, a: 0 });
    Object.assign(g.bodies[1], { x: 40, y: 25, a: 0 });
    r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.3 });
    return g.bodies[0].state === 'desk' ? g.bodies[0].y + 25 : Infinity;
  };
  const normal = slide(false), ice = slide(true);
  assert.ok(ice > normal * 2.5, `ふつう ${normal.toFixed(1)}cm / こおり ${ice}cm`);
});

test('いす：椅子のある辺からは落ちない（ほかの辺からは落ちる）', () => {
  const out = (side) => {
    const { r, ms, g } = skillGame('ruler:straight30-acrylic');
    if (side) {
      const w = chairSides(DESKS.pair, g.desks).find((x) => x.side === side);
      g.event = { type: 'chair', left: 2, id: 1, side, wall: { nx: w.nx, ny: w.ny, d: w.d, lo: w.lo, hi: w.hi } };
    }
    Object.assign(g.bodies[0], { x: 30, y: 0, a: Math.PI / 2 });
    Object.assign(g.bodies[1], { x: -30, y: 20, a: 0 });
    r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 1 });
    return { state: g.bodies[0].state, x: g.bodies[0].x };
  };
  assert.notEqual(out(null).state, 'desk', '椅子がなければ右から落ちる');
  const kept = out('right');
  assert.equal(kept.state, 'desk', '右に椅子があれば落ちない');
  assert.ok(kept.x < 45);
  assert.notEqual(out('left').state, 'desk', '椅子が反対側なら落ちる');
});

// ---- 体力 ----
test('体力：当てられた側だけが、当てた勢いに応じてダメージを受ける', () => {
  const { r, ms, g } = skillGame('ruler:straight30-acrylic');
  Object.assign(g.bodies[0], { x: -14, y: 0, a: Math.PI / 2 });
  Object.assign(g.bodies[1], { x: 0, y: 0, a: Math.PI / 2 });
  const shot = r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.9 })[0].msg;
  assert.ok(g.bodies[1].hp < 92, `青の体力 ${g.bodies[1].hp}`);
  assert.equal(g.bodies[0].hp, 100, '当てた側は減らない');
  assert.ok(shot.hits.some((h) => h.target === 1 && h.from === 0 && h.f > 0));
  assert.equal(shot.state.game.bodies[1].hp, g.bodies[1].hp);
  // 弱く当てると少しだけ
  const weak = skillGame('ruler:straight30-acrylic');
  Object.assign(weak.g.bodies[0], { x: -6, y: 0, a: Math.PI / 2 });
  Object.assign(weak.g.bodies[1], { x: 0, y: 0, a: Math.PI / 2 });
  weak.r.handle(weak.ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.2 });
  assert.ok(weak.g.bodies[1].hp > g.bodies[1].hp);
});

test('体力：減っているほど、押されたときに遠くまで飛ぶ（はじいた本人のすべり方は変わらない）', () => {
  const pushed = (hp) => {
    const { r, ms, g } = skillGame('ruler:straight30-acrylic');
    Object.assign(g.bodies[0], { x: -8, y: 0, a: Math.PI / 2 });
    Object.assign(g.bodies[1], { x: 0, y: 0, a: Math.PI / 2, hp });
    r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.6 });
    return g.bodies[1].x;
  };
  const full = pushed(100), half = pushed(50), none = pushed(0);
  assert.ok(full < half && half < none, `体力100: ${full.toFixed(1)} / 50: ${half.toFixed(1)} / 0: ${none.toFixed(1)}`);
  assert.ok(none > full * 1.8);
  const own = (hp) => {
    const { r, ms, g } = skillGame('ruler:straight30-acrylic');
    Object.assign(g.bodies[0], { x: -40, y: -25, a: 0, hp });
    Object.assign(g.bodies[1], { x: 40, y: 25, a: 0 });
    r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.5 });
    return g.bodies[0].y;
  };
  assert.equal(own(100), own(10));
});

test('体力：1周目に落ちて席に戻っても、受けたダメージは残る。突風でもダメージ', () => {
  const { r, ms } = started(2, 'standard');
  const g = r.s.game;
  Object.assign(g.bodies[1], { x: 40, y: 0, a: Math.PI / 2 });
  Object.assign(g.bodies[0], { x: 28, y: 0, a: Math.PI / 2 });
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 1 });
  assert.equal(g.bodies[1].state, 'desk', '1周目なので戻る');
  assert.ok(g.bodies[1].hp < 100);
  const w = skillGame('ruler:tri60-acrylic');
  w.g.gauge[0] = 100;
  Object.assign(w.g.bodies[0], { x: -10, y: 0, a: 0 });
  Object.assign(w.g.bodies[1], { x: 0, y: 0, a: Math.PI / 2 });
  const shot = w.r.handle(w.ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05, skill: true })[0].msg;
  assert.ok(shot.hits.some((h) => h.kind === 'wind' && h.target === 1));
});

// ---- 追加の必殺技 ----
const full = (g, i = 0) => { g.gauge[i] = 100; };
const flickRight = (r, id, power = 0.7) => r.handle(id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power, skill: true })[0].msg;
const place2 = (g, gap = 8) => {
  Object.assign(g.bodies[0], { x: -gap - 2, y: 0, a: Math.PI / 2 });
  Object.assign(g.bodies[1], { x: 0, y: 0, a: Math.PI / 2 });
};

test('割り当て：定規ごとに必殺技が決まり、設定で変えられる', () => {
  assert.equal(resolveLoadout({ ruler: 'ruler:tri45-acrylic' }).skill, 'heavy');
  assert.equal(resolveLoadout({ ruler: 'ruler:protractor-metal' }).skill, 'sub');
  const cfg = sanitizeConfig({ skills: { 'tri45-acrylic': 'bomb', 'nope': 'heal', 'straight30-acrylic': 'xxx' } });
  assert.deepEqual(cfg.skills, { 'tri45-acrylic': 'bomb' });
  assert.equal(resolveLoadout({ ruler: 'ruler:tri45-acrylic' }, cfg).skill, 'bomb');
});

test('渾身：同じ当て方でもダメージが大きい', () => {
  const dmg = (skill) => {
    const { r, ms, g } = skillGame('ruler:tri45-acrylic');
    full(g); place2(g);
    r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.6, skill });
    return 100 - g.bodies[1].hp;
  };
  const a = dmg(false), b = dmg(true);
  assert.ok(b > a * 2, `ふつう ${a} / 渾身 ${b}`);
});

test('インク漏れ：当てた相手は自分の番が来るたびに体力が減る（3回）', () => {
  const { r, ms, g } = skillGame('ruler:tri45-rubber');
  full(g); place2(g);
  flickRight(r, ms[0].id, 0.4);
  assert.equal(g.turn, 1);
  assert.equal(g.bodies[1].ink, 2, '番が来た時点で1回減っている');
  assert.equal(g.fx.at(-1).kind, 'ink');
  const hp = g.bodies[1].hp;
  r.handle(ms[1].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  assert.equal(g.bodies[1].hp, hp - 5);
  assert.equal(g.bodies[1].ink, 1);
});

test('爆発：近くの定規に大きなダメージ。磁石：周りの定規が近づく', () => {
  const b = skillGame('ruler:protractor-acrylic');
  full(b.g);
  Object.assign(b.g.bodies[0], { x: -10, y: 0, a: 0 });
  Object.assign(b.g.bodies[1], { x: 0, y: 0, a: Math.PI / 2 });
  const shot = b.r.handle(b.ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05, skill: true })[0].msg;
  assert.equal(shot.blast.kind, 'bomb');
  assert.ok(100 - b.g.bodies[1].hp > 15, `爆発のダメージ ${100 - b.g.bodies[1].hp}`);
  const m = skillGame('ruler:protractor-rubber');
  full(m.g);
  Object.assign(m.g.bodies[0], { x: -10, y: 0, a: 0 });
  Object.assign(m.g.bodies[1], { x: 12, y: 0, a: Math.PI / 2 });
  const d0 = 22;
  const s2 = m.r.handle(m.ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05, skill: true })[0].msg;
  assert.equal(s2.blast.kind, 'magnet');
  assert.ok(Math.hypot(m.g.bodies[1].x - m.g.bodies[0].x, m.g.bodies[1].y - m.g.bodies[0].y) < d0 - 3);
  assert.equal(m.g.bodies[1].hp, 100, '磁石はダメージなし');
});

test('その場で使う必殺技：構えてはじくのではなくボタンで使い、そのあとふつうにはじける', () => {
  const { r, ms, g } = skillGame('ruler:straight15-metal'); // 保健室
  g.bodies[0].hp = 40;
  assert.equal(r.handle(ms[0].id, { t: 'skill' })[0].msg.t, 'error', 'ゲージがない');
  full(g);
  assert.equal(r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.3, skill: true })[0].msg.t, 'error', '構えては使えない');
  r.handle(ms[0].id, { t: 'skill' });
  assert.equal(g.bodies[0].hp, 75);
  assert.equal(g.gauge[0], 0);
  assert.equal(g.turn, 0, '番はそのまま');
  assert.equal(r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 })[0].msg.t, 'shot');
  assert.equal(r.handle(ms[1].id, { t: 'skill' })[0].msg.t, 'error');
});

test('ワープ：机の真ん中近くの空いた場所へ移る', () => {
  const { r, ms, g } = skillGame('ruler:straight15-rubber');
  full(g);
  Object.assign(g.bodies[0], { x: -40, y: 25 });
  Object.assign(g.bodies[1], { x: 30, y: 0 });
  r.handle(ms[0].id, { t: 'skill' });
  assert.ok(Math.hypot(g.bodies[0].x, g.bodies[0].y) < 6, `${g.bodies[0].x},${g.bodies[0].y}`);
  // 真ん中に相手がいれば、ぶつからない所へ
  const b = skillGame('ruler:straight15-rubber');
  full(b.g);
  Object.assign(b.g.bodies[1], { x: 0, y: 0, a: 0 });
  b.r.handle(b.ms[0].id, { t: 'skill' });
  assert.ok(Math.hypot(b.g.bodies[0].x, b.g.bodies[0].y) > 8);
});

test('身代わり：次の相手の番のあいだだけ、落ちても机の真ん中に戻る（体力は半分）', () => {
  const { r, ms, g } = skillGame('ruler:protractor-metal');
  full(g);
  r.handle(ms[0].id, { t: 'skill' });
  assert.equal(g.bodies[0].subWait, true);
  assert.ok(!g.bodies[0].sub, '使った番の残りでは、まだ効かない');
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  assert.equal(g.bodies[0].sub, true, '次の相手の番から効く');
  // 青に押し出される
  g.bodies[0].hp = 80;
  Object.assign(g.bodies[0], { x: 38, y: 0, a: Math.PI / 2 });
  Object.assign(g.bodies[1], { x: 28, y: 0, a: Math.PI / 2 });
  r.handle(ms[1].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 1 });
  assert.equal(g.bodies[0].state, 'desk');
  assert.equal(g.bodies[0].sub, false);
  assert.ok(g.bodies[0].hp <= 40 && g.bodies[0].hp > 20, `体力 ${g.bodies[0].hp}（押されたダメージのあと半分）`);
  assert.equal(r.s.phase, 'aim');
  assert.ok(g.fx.some((f) => f.kind === 'subUsed'));
});

test('身代わり：使った番の自分の打ちでは効かず、次の相手の番が終わると消える', () => {
  // 使った番に自分で落ちたら、そのまま負け
  const a = skillGame('ruler:protractor-metal');
  full(a.g);
  a.r.handle(a.ms[0].id, { t: 'skill' });
  Object.assign(a.g.bodies[0], { x: 38, y: 0, a: Math.PI / 2 });
  a.r.handle(a.ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 1 });
  assert.equal(a.g.players[0].alive, false);
  assert.deepEqual(a.g.result.winners, [1]);
  // 相手の番で落ちなければ、そこで消える（次の自分の番には効かない）
  const { r, ms, g } = skillGame('ruler:protractor-metal');
  full(g);
  r.handle(ms[0].id, { t: 'skill' });
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  r.handle(ms[1].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  assert.ok(!g.bodies[0].sub && !g.bodies[0].subWait);
  Object.assign(g.bodies[0], { x: 38, y: 0, a: Math.PI / 2 });
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 1 });
  assert.equal(g.players[0].alive, false);
});

test('反撃：構えている間に当てられると、当てた側も同じだけ減る（次の自分の番で終わる）', () => {
  const { r, ms, g } = skillGame('ruler:straight30-acrylic', 'ruler:tri45-metal');
  g.turn = 1; full(g, 1);
  r.handle(ms[1].id, { t: 'skill' });
  assert.equal(g.bodies[1].counter, true);
  r.handle(ms[1].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  place2(g);
  const shot = r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.7 })[0].msg;
  const lost = 100 - g.bodies[1].hp;
  assert.ok(lost > 3);
  assert.ok(Math.abs((100 - g.bodies[0].hp) - lost) < 0.2, `受けた ${lost} / 返した ${100 - g.bodies[0].hp}`);
  assert.ok(shot.hits.some((h) => h.kind === 'counter'));
  assert.equal(g.bodies[1].counter, false, '自分の番が来たら終わる');
});

test('いす召喚：近い辺に椅子が並んで落ちない', () => {
  const { r, ms, g } = skillGame('ruler:tri60-metal');
  full(g);
  Object.assign(g.bodies[0], { x: 30, y: 0, a: Math.PI / 2 });
  Object.assign(g.bodies[1], { x: -30, y: 20, a: 0 });
  r.handle(ms[0].id, { t: 'skill' });
  assert.equal(g.walls[0].side, 'right');
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 1 });
  assert.equal(g.bodies[0].state, 'desk', '右の椅子で止まる');
  assert.equal(g.walls.length, 1);
});

test('吹雪：机の好きな所にクリスタルを置き、触れると机が凍る（その動きの残りと、次の人の番）', () => {
  const { r, ms, g } = skillGame('ruler:tri60-rubber');
  full(g);
  Object.assign(g.bodies[0], { x: -30, y: -20, a: 0 });
  Object.assign(g.bodies[1], { x: 20, y: 0, a: Math.PI / 2 });
  // 場所を決めないと置けない・定規と重なる所・机の外には置けない
  assert.equal(r.handle(ms[0].id, { t: 'skill' })[0].msg.t, 'error');
  assert.equal(r.handle(ms[0].id, { t: 'skill', x: 20, y: 0 })[0].msg.t, 'error');
  assert.equal(r.handle(ms[0].id, { t: 'skill', x: 60, y: 0 })[0].msg.t, 'error');
  assert.equal(g.gauge[0], 100, '置けなかったらゲージは減らない');
  r.handle(ms[0].id, { t: 'skill', x: 4, y: 0 });
  assert.equal(g.gauge[0], 0);
  assert.equal(g.crystals.length, 1);
  assert.equal(r.snapshot().game.crystals[0].x, 4);
  assert.ok(g.fx.some((f) => f.kind === 'blizzard' && f.crystal));
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  assert.equal(g.crystals.length, 1, 'だれも触れなければ残る');
  assert.ok(!g.icy);
  // 青がクリスタルに触れる → 割れて凍る
  const m = r.handle(ms[1].id, { t: 'flick', lx: 0, ly: 0, dx: -1, dy: 0, power: 0.5 })[0].msg;
  assert.ok(m.marks.some((k) => k.kind === 'freeze'));
  assert.equal(g.crystals.length, 0);
  assert.equal(g.icy, 1, '次の人（赤）の番は凍っている');
  assert.equal(r.buildWorld().params.friction, 0.3);
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05 });
  assert.equal(g.icy, 0);
});

test('吹雪：クリスタルに触れたら、その動きの残りもよくすべる', () => {
  const slide = (crystal) => {
    const { r, ms, g } = skillGame('ruler:straight30-metal');
    Object.assign(g.bodies[0], { x: -40, y: -25, a: 0 });
    Object.assign(g.bodies[1], { x: 40, y: 25, a: 0 });
    if (crystal) g.crystals = [{ id: 1, owner: 1, x: -40, y: -21, r: 2.6 }];
    r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.3 });
    return g.bodies[0].state === 'desk' ? g.bodies[0].y + 25 : Infinity;
  };
  const normal = slide(false), ice = slide(true);
  assert.ok(ice > normal * 1.8, `ふつう ${normal.toFixed(1)}cm / クリスタル ${ice}cm`);
});

test('設定画面で変えた定規の性能が、対戦に使われる', () => {
  const cfg = sanitizeConfig({ rulers: { 'straight30-acrylic': { mass: 70, power: 140, mu: 'x' }, 'zzz': { mass: 1 } } });
  assert.deepEqual(cfg.rulers, { 'straight30-acrylic': { mass: 70, power: 140 } });
  const clamp = sanitizeConfig({ rulers: { 'tri45-metal': { mass: 999, e: -1 } } });
  assert.deepEqual(clamp.rulers['tri45-metal'], { mass: 80, e: 0 });
  // 重くした青は押されにくい
  const pushed = (c) => {
    const { r, ms } = started(2, 'standard');
    r.s.phase = 'lobby';
    r.setLoadout(ms[0].id, resolveLoadout({ ruler: 'ruler:straight30-acrylic' }));
    r.setLoadout(ms[1].id, resolveLoadout({ ruler: 'ruler:straight30-acrylic' }, c));
    readyAll(r, ms, 5000);
    const g = r.s.game; g.shots = 10; g.turn = 0;
    Object.assign(g.bodies[0], { x: -10, y: 0, a: Math.PI / 2 });
    Object.assign(g.bodies[1], { x: 0, y: 0, a: Math.PI / 2 });
    r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.6 });
    return g.bodies[1].x;
  };
  assert.ok(pushed(cfg) < pushed(undefined) * 0.7);
});
