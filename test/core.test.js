import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore, cleanName, START_WAIT_MS } from '../src/core.js';
import { resolveLoadout } from '../public/shared/catalog.js';
import Physics from '../public/shared/physics.js';
const { RULERS } = Physics;

const lastState = (out) => out.find((o) => o.msg.t === 'state' || o.msg.t === 'shot')?.msg.state;

function room(n, mode = 'standard', now = 1000) {
  const r = new RoomCore('ABCDE', mode, now);
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
