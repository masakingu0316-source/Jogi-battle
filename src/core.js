// 部屋の中身（メンバー・モード・対戦の進行）を扱う純粋なロジック。
// Cloudflare の機能には依存しないので、Node でもそのままテストできる。
import Physics from '../public/shared/physics.js';
import { DESKS, MODES, PLAYERS, TEAMS, teamOf, seats, playableReason } from '../public/shared/rules.js';
import { resolveLoadout, DEFAULT_RULER } from '../public/shared/catalog.js';

const FPS = 30;
const STEP = 1 / 600;
const STEPS_PER_FRAME = Math.round(1 / FPS / STEP);
const MAX_SIM_SECONDS = 12;
const NAME_MAX = 10;

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function cleanName(raw) {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  return Array.from(s).slice(0, NAME_MAX).join('') || 'ゲスト';
}

// 最後の人が入ってから（または決着してから）この時間がたつと、準備OKでなくても対戦が始まる
export const START_WAIT_MS = 60 * 1000;

export class RoomCore {
  constructor(code, mode = 'standard', now = Date.now()) {
    this.s = {
      code, createdAt: now, lastActive: now,
      mode: MODES[mode] ? mode : 'standard', // 部屋を作るときに決め、あとから変えない
      members: [],         // 入室順＝席順。{ id, token, userId, name, loadout, ready, connected }
      hostId: null,        // いちばん古くからいる人（切れた人の番を飛ばせる）
      phase: 'lobby',      // lobby（部屋で準備中）| aim（対戦中）
      startAt: null,       // この時刻になったら対戦を始める（人数がそろっていないときは null）
      game: null,          // 対戦中の状態。決着後も結果を見せるために残す
      wins: {},            // memberId -> 勝ち数
    };
  }

  static restore(saved) {
    const r = new RoomCore(saved.code, saved.mode);
    r.s = saved;
    if (saved.phase === 'over') r.s.phase = 'lobby'; // 古い形式の保存データ
    return r;
  }
  toJSON() { return this.s; }

  member(id) { return this.s.members.find((m) => m.id === id) || null; }
  get capacity() { return MODES[this.s.mode].max; }

  // ---- 入退室 ----
  // user: ログイン中なら { id, name }
  join(name, token, user = null, now = Date.now()) {
    const s = this.s;
    s.lastActive = now;
    const prev = (token && s.members.find((x) => x.token === token))
      || (user && s.members.find((x) => x.userId === user.id));
    if (prev && (!prev.userId || (user && prev.userId === user.id))) {
      prev.connected = true;
      if (user && !prev.userId && s.phase !== 'aim') prev.userId = user.id;
      if (user) prev.name = cleanName(user.name);
      else if (name) prev.name = cleanName(name);
      return { member: prev, rejoined: true };
    }
    if (s.phase === 'aim') return { error: '対戦中のため入れません。今の対戦が終わってから入ってください。' };
    if (s.members.length >= this.capacity) return { error: `この部屋は満員です（${MODES[s.mode].name}は${this.capacity}人まで）。` };
    const m = {
      id: randomHex(4), token: randomHex(12), userId: user ? user.id : null,
      name: cleanName(user ? user.name : name), loadout: resolveLoadout({ ruler: DEFAULT_RULER }),
      ready: false, connected: true,
    };
    s.members.push(m);
    if (!s.hostId) s.hostId = m.id;
    // 新しい人が入ったら、そこから1分数え直す
    this.resetTimer(now);
    return { member: m, rejoined: false };
  }

  // 部屋では席を空ける。対戦中は「接続待ち」にして戻ってこられるようにする。
  disconnect(id, now = Date.now()) {
    const s = this.s;
    const m = this.member(id);
    if (!m) return;
    s.lastActive = now;
    if (s.phase === 'aim' && s.game && s.game.order.includes(id)) {
      m.connected = false;
      // 番を飛ばせる人がいなくならないよう、つながっている人に引き継ぐ
      if (s.hostId === id) s.hostId = (s.members.find((x) => x.connected) || m).id;
    } else this.removeMember(id);
  }

  removeMember(id) {
    const s = this.s;
    s.members = s.members.filter((x) => x.id !== id);
    if (s.hostId === id || !this.member(s.hostId)) {
      const next = s.members.find((x) => x.connected) || s.members[0];
      s.hostId = next ? next.id : null;
    }
    // 人数が足りなくなったら、カウントダウンを止める
    if (s.phase === 'lobby' && s.members.length < MODES[s.mode].min) s.startAt = null;
  }

  // 人数がそろっていれば、今から1分後に始まるようにする
  resetTimer(now = Date.now()) {
    const s = this.s;
    if (s.phase !== 'lobby') return;
    s.startAt = s.members.length >= MODES[s.mode].min ? now + START_WAIT_MS : null;
  }

  // 始められる状態か（人数・接続）
  canStart() {
    const s = this.s;
    return s.phase === 'lobby' && !playableReason(s.mode, s.members.length) && s.members.every((m) => m.connected);
  }

  // 全員が準備OK、または時間切れなら対戦を始める。始めたら true
  tick(now = Date.now()) {
    const s = this.s;
    if (!this.canStart()) return false;
    const allReady = s.members.every((m) => m.ready);
    const timeUp = s.startAt !== null && now >= s.startAt;
    if (!allReady && !timeUp) return false;
    this.startGame(now);
    return true;
  }

  // ---- 状態のスナップショット（トークンは含めない） ----
  snapshot(now = Date.now()) {
    const s = this.s;
    const m = MODES[s.mode];
    return {
      code: s.code,
      hostId: s.hostId,
      mode: s.mode,
      phase: s.phase,
      capacity: m.max,
      minPlayers: m.min,
      startIn: s.phase === 'lobby' && s.startAt !== null ? Math.max(0, s.startAt - now) : null,
      members: s.members.map((x) => ({ id: x.id, name: x.name, account: !!x.userId, loadout: x.loadout, ready: !!x.ready, connected: x.connected })),
      wins: s.wins,
      game: s.game && {
        n: s.game.n, order: s.game.order, turn: s.game.turn, shots: s.game.shots, id: s.game.id,
        bodies: s.game.bodies, players: s.game.players, result: s.game.result,
      },
    };
  }

  // 使う定規を変える（所持の確認は呼ぶ側で済ませておく）
  setLoadout(id, loadout) {
    const s = this.s;
    const m = this.member(id);
    if (!m) return [];
    if (s.phase === 'aim') return [{ to: id, msg: { t: 'error', text: '定規は対戦の合間に変更できます' } }];
    m.loadout = loadout;
    return [{ to: 'all', msg: { t: 'state', state: this.snapshot() } }];
  }

  // 決着したときの記録を1回だけ取り出す
  takeRecord() {
    const r = this.record;
    this.record = null;
    return r || null;
  }

  // ---- メッセージ処理 ----
  // 戻り値：送信する内容の配列 { to: 'all' | memberId, msg }
  handle(id, msg, now = Date.now()) {
    const s = this.s;
    const m = this.member(id);
    if (!m || !msg || typeof msg.t !== 'string') return [];
    s.lastActive = now;
    const isHost = s.hostId === id;
    const err = (text) => [{ to: id, msg: { t: 'error', text } }];
    const state = () => [{ to: 'all', msg: { t: 'state', state: this.snapshot(now) } }];

    switch (msg.t) {
      case 'ready': {
        if (s.phase !== 'lobby') return err('今は準備を変えられません');
        m.ready = !!msg.on;
        this.tick(now);
        return state();
      }
      case 'leave': {
        // 対戦中に抜けた人は「接続待ち」のまま残り、決着したときに席が空く
        this.disconnect(id, now);
        this.tick(now);
        return [{ to: id, msg: { t: 'left' } }, ...state()];
      }
      case 'skip': {
        if (!isHost) return err('番を飛ばせるのは、いちばん先に部屋にいた人です');
        if (s.phase !== 'aim') return [];
        const cur = this.member(s.game.order[s.game.turn]);
        if (cur && cur.connected) return err('接続している人の番は飛ばせません');
        this.advanceTurn();
        return state();
      }
      case 'flick': {
        if (s.phase !== 'aim') return err('今ははじけません');
        const g = s.game;
        if (g.order[g.turn] !== id) return err('あなたの番ではありません');
        const shot = this.shoot(msg, now);
        if (shot.error) return err(shot.error);
        return [{ to: 'all', msg: { t: 'shot', by: shot.by, frames: shot.frames, falls: shot.falls, saved: shot.saved, state: this.snapshot(now) } }];
      }
      default:
        return [];
    }
  }

  // ---- 対戦 ----
  startGame(now = Date.now()) {
    const s = this.s;
    const prev = s.game;
    const order = s.members.map((x) => x.id);
    const n = order.length;
    const desk = DESKS[MODES[s.mode].desk];
    const st = seats(n, desk);
    // 同じ顔ぶれでの再戦なら、先手を1つずつずらす
    const same = prev && prev.n === n && prev.order.every((x, i) => x === order[i]);
    const starter = same ? (prev.starter + 1) % n : 0;
    s.game = {
      id: (prev?.id || 0) + 1, mode: s.mode, n, order, starter, turn: starter, shots: 0, outOrder: [], result: null,
      bodies: order.map((mid, i) => {
        const lo = this.member(mid).loadout;
        return { owner: i, ruler: lo.ruler, specKey: lo.specKey, level: lo.level || 1, mods: lo.mods, pattern: lo.pattern, sticker: lo.sticker, x: st[i].x, y: st[i].y, a: st[i].a, state: 'desk' };
      }),
      kos: order.map(() => 0),
      players: order.map(() => ({ alive: true, selfOut: false })),
    };
    for (const mid of order) if (!(mid in s.wins)) s.wins[mid] = 0;
    for (const m of s.members) m.ready = false;
    s.startAt = null;
    s.phase = 'aim';
  }

  buildWorld() {
    const g = this.s.game;
    const desk = DESKS[MODES[g.mode].desk];
    const world = Physics.createWorld({}, { w: desk.w, h: desk.h });
    for (const b of g.bodies) {
      const body = Physics.createBody('p' + b.owner, b.owner, b.specKey, b.x, b.y, b.a, b.mods);
      body.state = b.state === 'desk' ? 'desk' : 'gone';
      world.bodies.push(body);
    }
    return world;
  }

  shoot(input, now = Date.now()) {
    const g = this.s.game;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    let lx = num(input.lx), ly = num(input.ly), dx = num(input.dx), dy = num(input.dy), power = num(input.power);
    if ([lx, ly, dx, dy, power].some(Number.isNaN)) return { error: 'はじき方のデータが正しくありません' };
    const world = this.buildWorld();
    const body = world.bodies[g.turn];
    // はじく点は定規の上に収める
    ({ x: lx, y: ly } = Physics.nearestOnShape(body.spec.shape, lx, ly));
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { error: 'はじく向きが正しくありません' };
    dx /= len; dy /= len;
    power = Math.max(0.05, Math.min(1, power));
    Physics.flick(world, body, lx, ly, dx, dy, power);

    // 1/30秒ごとに位置を記録して、全員に動きをそのまま配る
    const frames = [encodeFrame(world)];
    const falls = [];
    let steps = 0;
    while (!Physics.atRest(world) && steps < MAX_SIM_SECONDS / STEP) {
      for (let k = 0; k < STEPS_PER_FRAME; k++) {
        for (const b of Physics.step(world, STEP)) {
          falls.push({ owner: b.owner, f: frames.length, x: round2(b.x), y: round2(b.y) });
        }
        steps++;
      }
      frames.push(encodeFrame(world));
    }
    for (const b of world.bodies) if (b.state === 'falling') b.state = 'gone';

    g.bodies = g.bodies.map((prev, i) => {
      const b = world.bodies[i];
      return { ...prev, x: round2(b.x), y: round2(b.y), a: round4(b.a), state: b.state === 'desk' ? 'desk' : 'gone' };
    });
    const by = g.turn;
    g.shots++;
    const saved = this.finishTurn(by, now);
    return { by, frames, falls, saved };
  }

  // はじいた後の判定。1周目に落ちた定規を戻したら true を返す。
  finishTurn(shooter, now = Date.now()) {
    const s = this.s, g = s.game;
    const teams = MODES[g.mode].teams;
    let saved = false;
    if (g.shots <= g.n) {
      const st = seats(g.n, DESKS[MODES[g.mode].desk]);
      for (const b of g.bodies) {
        if (b.state === 'desk') continue;
        Object.assign(b, { x: round2(st[b.owner].x), y: round2(st[b.owner].y), a: round4(st[b.owner].a), state: 'desk' });
        saved = true;
      }
    }
    const newly = [];
    g.players.forEach((p, i) => {
      if (p.alive && g.bodies[i].state !== 'desk') { p.alive = false; p.selfOut = i === shooter; newly.push(i); }
    });
    if (newly.length) g.outOrder.push(newly);
    for (const i of newly) if (i !== shooter) g.kos[shooter]++;
    const alive = g.players.map((p, i) => (p.alive ? i : -1)).filter((i) => i >= 0);
    const label = (i) => `${this.member(g.order[i])?.name ?? '?'}（${PLAYERS[i].name}）`;

    let winners = null, title = '', reason = '';
    if (teams) {
      const up = [0, 1].map((t) => alive.some((i) => teamOf(i) === t));
      if (!up[0] || !up[1]) {
        const wt = up[0] ? 0 : up[1] ? 1 : 1 - teamOf(shooter);
        winners = g.players.map((_, i) => i).filter((i) => teamOf(i) === wt);
        title = `${TEAMS[wt].name}の勝ち！`;
        reason = !up[0] && !up[1]
          ? `両チームとも全員落ちたので、はじいた${TEAMS[teamOf(shooter)].name}の負け`
          : `${TEAMS[1 - wt].name}が全員落ちた`;
      }
    } else if (alive.length <= 1) {
      winners = alive.length === 1 ? alive : newly.filter((i) => i !== shooter);
      title = `${winners.map((i) => this.member(g.order[i])?.name ?? '?').join('・')}の勝ち！`;
      if (g.n === 2) {
        const opp = 1 - shooter;
        const selfOut = newly.includes(shooter), oppOut = newly.includes(opp);
        if (selfOut && oppOut) reason = `両方落ちたので、はじいた${label(shooter)}の負け`;
        else if (selfOut) reason = `${label(shooter)}の定規が自分で落ちた`;
        else reason = `${label(opp)}の定規が机から落ちた`;
      } else {
        reason = alive.length === 1 ? '最後まで机に残った' : `最後の${newly.length}人が同時に落ち、はじいた${label(shooter)}以外が勝ち`;
      }
    }

    if (winners) {
      for (const i of winners) s.wins[g.order[i]] = (s.wins[g.order[i]] || 0) + 1;
      const order = g.outOrder.map((grp) => grp.map((i) => label(i) + (g.players[i].selfOut ? '・自滅' : '')).join('、'));
      g.result = { winners, title, reason, outOrder: g.n > 2 ? order : [] };
      // アカウントに残す記録（部屋の外で保存する）
      this.record = {
        room: s.code, mode: g.mode, n: g.n, shots: g.shots,
        names: g.order.map((mid) => this.member(mid)?.name ?? '?'),
        players: g.order.map((mid, i) => ({
          memberId: mid, userId: this.member(mid)?.userId || null, seat: i, won: winners.includes(i),
          kos: g.kos[i], selfOut: g.players[i].selfOut, ruler: g.bodies[i].ruler,
        })),
      };
      // 部屋に戻る。対戦中に抜けた人の席を空け、全員の準備を解除して、ここから1分数える
      s.phase = 'lobby';
      for (const m of [...s.members]) if (!m.connected) this.removeMember(m.id);
      for (const m of s.members) m.ready = false;
      this.resetTimer(now);
    } else {
      this.advanceTurn();
    }
    return saved;
  }

  // 時計回りで、まだ残っている次の人へ
  advanceTurn() {
    const g = this.s.game;
    let t = g.turn;
    do { t = (t + 1) % g.n; } while (!g.players[t].alive);
    g.turn = t;
  }
}

function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

// 1コマ＝定規ごとに [x, y, 角度, 状態]。x,y は 1/100cm、角度は 1/1000rad の整数。状態 0机上 1落下中 2消えた
function encodeFrame(world) {
  const out = [];
  for (const b of world.bodies) {
    out.push(Math.round(b.x * 100), Math.round(b.y * 100), Math.round(b.a * 1000),
      b.state === 'desk' ? 0 : b.state === 'falling' ? 1 : 2);
  }
  return out;
}
