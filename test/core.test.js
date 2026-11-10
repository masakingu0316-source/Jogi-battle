import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore, cleanName, START_WAIT_MS } from '../public/shared/core.js';
import { DESKS, deskTiles, tilesConnected, pickVanish, CRIT, GAUGE } from '../public/shared/rules.js';
import { resolveLoadout } from '../public/shared/catalog.js';
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


test('乱戦で残りが2人になると、消える机を1つ前の番で予告し、番ごとに1台ずつ消える（最後は1台）', () => {
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
    const out = r.handle(g.order[g.turn], { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.05 });
    const shot = out[0].msg;
    assert.equal(shot.vanished.desk, v);
    assert.ok(!g.desks.includes(v));
    assert.ok(tilesConnected(desk, g.desks), '残った机は辺でつながっている');
    seen.push(v);
  }
  assert.equal(g.desks.length, 1);
  assert.equal(g.vanish, null, '最後の1台は消さない');
  assert.equal(new Set(seen).size, 3);
});

test('消えた机に乗っていた定規は落ち、はじいた人の手柄にはならない', () => {
  const { r } = started(3, 'melee');
  const g = r.s.game;
  g.shots = 10;
  g.bodies[0].state = 'gone';
  r.finishTurn(0);
  const v = g.vanish;
  const t = deskTiles(DESKS.group)[v];
  // 次の番の人（はじく人）ではない方の定規を、消える机の真ん中に置く
  const shooter = g.turn, other = shooter === 1 ? 2 : 1;
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

test('ゲージは、はじく・当てる・当てられるでたまる', () => {
  const { r, ms, g } = skillGame('ruler:straight30-acrylic');
  Object.assign(g.bodies[0], { x: -6, y: 0, a: Math.PI / 2 });
  Object.assign(g.bodies[1], { x: 2, y: 0, a: Math.PI / 2 });
  r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.5 });
  assert.deepEqual(g.gauge, [GAUGE.shot + GAUGE.hit, GAUGE.beHit]);
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
  const { r, ms, g } = skillGame('ruler:tri45-acrylic');
  g.gauge[0] = 100;
  Object.assign(g.bodies[0], { x: -10, y: 0, a: 0 });
  Object.assign(g.bodies[1], { x: 0, y: 0, a: Math.PI / 2 });
  const shot = r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05, skill: true })[0].msg;
  assert.equal(shot.skill, 'wind');
  assert.deepEqual(shot.wind.hit, [1]);
  assert.ok(shot.wind.f > 0 && shot.wind.f < shot.frames.length);
  assert.ok(g.bodies[1].state !== 'desk' || g.bodies[1].x > 15, `吹き飛んだ距離 ${g.bodies[1].x}`);
  // 遠くの定規は動かない
  const far = skillGame('ruler:tri45-acrylic');
  far.g.gauge[0] = 100;
  Object.assign(far.g.bodies[0], { x: -30, y: 0, a: 0 });
  Object.assign(far.g.bodies[1], { x: 25, y: 0, a: Math.PI / 2 });
  const s2 = far.r.handle(far.ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 1, power: 0.05, skill: true })[0].msg;
  assert.deepEqual(s2.wind.hit, []);
  assert.equal(far.g.bodies[1].x, 25);
});

test('不動：次の自分の番まで押されにくく、自分の番が来たら元に戻る', () => {
  const pushed = (anchor) => {
    const { r, ms, g } = skillGame('ruler:tri60-acrylic', 'ruler:straight30-metal');
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
  // つよい（赤）とやさしい（青）を、先手を入れ替えながら4回
  let strong = 0;
  for (let n = 0; n < 4; n++) {
    const { r } = started(2, 'standard');
    r.s.game.turn = n % 2;
    for (let k = 0; k < 60 && r.s.phase === 'aim'; k++) {
      const g = r.s.game;
      const shot = await planShot(r, g.turn === 0 ? 'hard' : 'easy');
      r.handle(g.order[g.turn], { t: 'flick', ...shot });
    }
    if (r.s.game.result?.winners.includes(0)) strong++;
  }
  assert.ok(strong >= 3, `つよいの勝ち ${strong}/4`);
});
