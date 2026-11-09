import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore, cleanName } from '../src/core.js';
import { resolveLoadout } from '../public/shared/catalog.js';

const lastState = (out) => out.find((o) => o.msg.t === 'state' || o.msg.t === 'shot')?.msg.state;

function room(n, mode = 'standard') {
  const r = new RoomCore('ABCDE');
  const ms = [];
  for (let i = 0; i < n; i++) ms.push(r.join('P' + i).member);
  if (mode !== 'standard') r.handle(ms[0].id, { t: 'mode', mode });
  return { r, ms };
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

test('最初に入った人が部屋主。5人目は満員で入れない', () => {
  const { r, ms } = room(4);
  assert.equal(r.s.hostId, ms[0].id);
  assert.match(r.join('X').error, /満員/);
});

test('人数がモードに合わないと開始できない', () => {
  const { r, ms } = room(3);
  assert.match(r.handle(ms[0].id, { t: 'start' })[0].msg.text, /2人まで/);
  assert.match(r.handle(ms[1].id, { t: 'mode', mode: 'melee' })[0].msg.text, /部屋を作った人/);
  r.handle(ms[0].id, { t: 'mode', mode: 'melee' });
  const st = lastState(r.handle(ms[0].id, { t: 'start' }));
  assert.equal(st.phase, 'aim');
  assert.equal(st.game.n, 3);
});

test('自分の番以外ははじけない。はじくと動きのコマと次の手番が届く', () => {
  const { r, ms } = room(2);
  r.handle(ms[0].id, { t: 'start' });
  assert.match(r.handle(ms[1].id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 1 })[0].msg.text, /あなたの番ではありません/);
  const out = flickToward(r);
  const shot = out[0].msg;
  assert.equal(shot.t, 'shot');
  assert.ok(shot.frames.length > 3);
  assert.equal(shot.frames[0].length, 2 * 4);
  assert.equal(shot.state.game.turn, 1);
});

test('おかしな入力は受け付けない', () => {
  const { r, ms } = room(2);
  r.handle(ms[0].id, { t: 'start' });
  assert.match(r.handle(ms[0].id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: 0, power: 1 })[0].msg.text, /向き/);
  assert.match(r.handle(ms[0].id, { t: 'flick', lx: 'a', ly: 0, dx: 1, dy: 0, power: 1 })[0].msg.text, /正しくありません/);
});

test('1周目に落ちた定規は元の席に戻り、脱落しない', () => {
  const { r, ms } = room(2, 'quick');
  r.setLoadout(ms[0].id, resolveLoadout({ ruler: 'ruler:plastic15' }));
  r.setLoadout(ms[1].id, resolveLoadout({ ruler: 'ruler:plastic15' }));
  r.handle(ms[0].id, { t: 'start' });
  // 試作で1手目に落とせた打ち方（端をはじいて回転させる）
  const shot = r.handle(ms[0].id, { t: 'flick', lx: -8.5, ly: 0, dx: 1, dy: 0, power: 1 })[0].msg;
  assert.equal(shot.state.phase, 'aim');
  assert.ok(shot.state.game.players.every((p) => p.alive));
  assert.ok(shot.state.game.bodies.every((b) => b.state === 'desk'));
});

test('2周目以降に落ちたら決着し、勝ち数が増える', () => {
  const { r, ms } = room(2, 'quick');
  r.handle(ms[0].id, { t: 'start' });
  pushToEdge(r);
  const st = flickToward(r, 1)[0].msg.state;
  assert.equal(st.phase, 'over');
  assert.ok(st.game.result.title.endsWith('の勝ち！'));
  assert.equal(Object.values(st.wins).reduce((a, b) => a + b, 0), 1);
  assert.equal(st.game.result.winners[0], 0);
});

test('乱戦：脱落した人の番は飛ばす', () => {
  const { r, ms } = room(3, 'melee');
  r.handle(ms[0].id, { t: 'start' });
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
  const { r, ms } = room(4, 'team');
  r.handle(ms[0].id, { t: 'start' });
  const g = r.s.game;
  g.shots = 10;
  g.bodies[1].state = 'gone';
  g.bodies[3].state = 'gone';
  r.finishTurn(0);
  assert.equal(r.s.phase, 'over');
  assert.equal(g.result.title, 'Aチームの勝ち！');
  assert.deepEqual(g.result.winners, [0, 2]);
});

test('対戦中に切れても、トークンで同じ席に戻れる', () => {
  const { r, ms } = room(2);
  r.handle(ms[0].id, { t: 'start' });
  r.disconnect(ms[1].id);
  assert.equal(r.member(ms[1].id).connected, false);
  const back = r.join('別名', ms[1].token);
  assert.equal(back.member.id, ms[1].id);
  assert.equal(back.member.connected, true);
  assert.match(r.join('新人').error, /対戦中/);
});

test('待合室で抜けたら席が空き、部屋主は次の人に移る', () => {
  const { r, ms } = room(3);
  r.disconnect(ms[0].id);
  assert.equal(r.s.members.length, 2);
  assert.equal(r.s.hostId, ms[1].id);
});

test('切れた人の番は部屋主が飛ばせる', () => {
  const { r, ms } = room(2);
  r.handle(ms[0].id, { t: 'start' });
  assert.match(r.handle(ms[0].id, { t: 'skip' })[0].msg.text, /接続している人/);
  r.disconnect(ms[0].id); // 部屋主が切れると、部屋主は残った人に移る
  assert.equal(r.s.hostId, ms[1].id);
  r.handle(ms[1].id, { t: 'skip' });
  assert.equal(r.s.game.turn, 1);
});

test('保存して復元しても続きができる', () => {
  const { r, ms } = room(2);
  r.handle(ms[0].id, { t: 'start' });
  flickToward(r);
  const copy = RoomCore.restore(JSON.parse(JSON.stringify(r.toJSON())));
  assert.equal(copy.s.game.turn, 1);
  assert.equal(flickToward(copy)[0].msg.t, 'shot');
});

test('再戦は先手が交代する', () => {
  const { r, ms } = room(2, 'quick');
  r.handle(ms[0].id, { t: 'start' });
  pushToEdge(r);
  flickToward(r, 1);
  assert.equal(r.s.phase, 'over');
  r.handle(ms[0].id, { t: 'start' });
  assert.equal(r.s.game.turn, 1);
});

test('ログイン中の人は、トークンがなくても同じアカウントなら同じ席に戻る', () => {
  const r = new RoomCore('ABCDE');
  const a = r.join('x', null, { id: 'u1', name: 'アカウント名' }).member;
  r.join('y');
  r.handle(a.id, { t: 'start' });
  r.disconnect(a.id);
  const back = r.join('別の端末', null, { id: 'u1', name: 'アカウント名' });
  assert.equal(back.member.id, a.id);
  assert.equal(back.member.name, 'アカウント名');
});

test('決着すると、アカウントの記録が1回だけ取り出せる（相手を落とした数つき）', () => {
  const r = new RoomCore('ABCDE');
  const a = r.join('x', null, { id: 'u1', name: 'A' }).member;
  r.join('ゲスト');
  r.handle(a.id, { t: 'start' });
  pushToEdge(r);
  flickToward(r, 1);
  const rec = r.takeRecord();
  assert.ok(rec);
  assert.equal(r.takeRecord(), null);
  assert.equal(rec.players[0].userId, 'u1');
  assert.equal(rec.players[1].userId, null);
  assert.equal(rec.players[0].kos, 1);
  assert.equal(rec.players[0].ruler, 'ruler:plastic30');
});

test('アクセサリの効果は対戦の定規に引き継がれる', () => {
  const { r, ms } = room(2);
  r.setLoadout(ms[0].id, resolveLoadout({ ruler: 'ruler:steel30', acc: 'acc:goldclip', pattern: 'pattern:stars' }));
  r.handle(ms[0].id, { t: 'start' });
  const b = r.s.game.bodies[0];
  assert.equal(b.specKey, 'steel30');
  assert.equal(b.mods.mass, 1.05);
  assert.equal(b.pattern, 'pattern:stars');
  assert.equal(r.buildWorld().bodies[0].m.toFixed(2), (36 * 1.05).toFixed(2));
});
