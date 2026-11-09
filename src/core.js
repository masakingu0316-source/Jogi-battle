// 部屋の中身（メンバー・モード・対戦の進行）を扱う純粋なロジック。
// Cloudflare の機能には依存しないので、Node でもそのままテストできる。
import Physics from '../public/shared/physics.js';
import { DESKS, MODES, PLAYERS, TEAMS, MAX_MEMBERS, teamOf, seats, playableReason } from '../public/shared/rules.js';
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

export class RoomCore {
  constructor(code, now = Date.now()) {
    this.s = {
      code, createdAt: now, lastActive: now,
      members: [],         // 入室順＝席順。{ id, token, userId, name, loadout, connected }
      hostId: null,
      mode: 'standard',
      phase: 'lobby',      // lobby | aim | over
      game: null,
      wins: {},            // memberId -> 勝ち数
    };
  }

  static restore(saved) {
    const r = new RoomCore(saved.code);
    r.s = saved;
    return r;
  }
  toJSON() { return this.s; }

  member(id) { return this.s.members.find((m) => m.id === id) || null; }

  // ---- 入退室 ----
  // user: ログイン中なら { id, name }。ゲストは null
  join(name, token, user = null, now = Date.now()) {
    const s = this.s;
    s.lastActive = now;
    const prev = (token && s.members.find((x) => x.token === token))
      || (user && s.members.find((x) => x.userId === user.id));
    if (prev && (!prev.userId || (user && prev.userId === user.id))) {
      prev.connected = true;
      // 待合室でログインしてから入り直した場合は、アカウントにつなげる
      if (user && !prev.userId && s.phase !== 'aim') prev.userId = user.id;
      if (user) prev.name = cleanName(user.name);
      else if (name) prev.name = cleanName(name);
      return { member: prev, rejoined: true };
    }
    if (s.phase === 'aim') return { error: '対戦中のため入れません。今の対戦が終わってから入ってください。' };
    if (s.members.length >= MAX_MEMBERS) return { error: `この部屋は満員です（${MAX_MEMBERS}人まで）。` };
    const m = {
      id: randomHex(4), token: randomHex(12), userId: user ? user.id : null,
      name: cleanName(user ? user.name : name), loadout: resolveLoadout({ ruler: DEFAULT_RULER }), connected: true,
    };
    s.members.push(m);
    if (!s.hostId) s.hostId = m.id;
    return { member: m, rejoined: false };
  }

  // 待合室では席を空ける。対戦中は「接続待ち」にして戻ってこられるようにする。
  disconnect(id, now = Date.now()) {
    const s = this.s;
    const m = this.member(id);
    if (!m) return;
    s.lastActive = now;
    const inGame = s.phase !== 'lobby' && s.game && s.game.order.includes(id);
    if (inGame) {
      m.connected = false;
    } else {
      s.members = s.members.filter((x) => x.id !== id);
    }
    if (s.hostId === id || !this.member(s.hostId)) {
      const next = s.members.find((x) => x.connected) || s.members[0];
      s.hostId = next ? next.id : null;
    }
  }

  // ---- 状態のスナップショット（トークンは含めない） ----
  snapshot() {
    const s = this.s;
    return {
      code: s.code,
      hostId: s.hostId,
      mode: s.mode,
      phase: s.phase,
      members: s.members.map((m) => ({ id: m.id, name: m.name, account: !!m.userId, loadout: m.loadout, connected: m.connected })),
      wins: s.wins,
      game: s.game && {
        n: s.game.n, order: s.game.order, turn: s.game.turn, shots: s.game.shots,
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
    const state = () => [{ to: 'all', msg: { t: 'state', state: this.snapshot() } }];
    const between = s.phase === 'lobby' || s.phase === 'over';

    switch (msg.t) {
      case 'mode': {
        if (!isHost) return err('モードは部屋を作った人が選びます');
        if (!MODES[msg.mode]) return err('そのモードはありません');
        if (!between) return err('モードは対戦の合間に変更できます');
        s.mode = msg.mode;
        if (s.phase === 'over') { s.phase = 'lobby'; s.game = null; }
        return state();
      }
      case 'start': {
        if (!isHost) return err('開始は部屋を作った人が行います');
        if (!between) return err('すでに対戦中です');
        const active = s.members.filter((x) => x.connected);
        if (active.length !== s.members.length) return err('接続が切れている人がいます。戻るのを待ってください');
        const reason = playableReason(s.mode, s.members.length);
        if (reason) return err(reason);
        this.startGame();
        return state();
      }
      case 'lobby': {
        if (!isHost) return err('待合室に戻すのは部屋を作った人です');
        if (s.phase !== 'over') return err('対戦が終わってから戻れます');
        // 対戦中に抜けた人はここで席を空ける
        s.members = s.members.filter((x) => x.connected);
        s.phase = 'lobby';
        s.game = null;
        return state();
      }
      case 'skip': {
        if (!isHost) return err('番を飛ばせるのは部屋を作った人です');
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
        const shot = this.shoot(msg);
        if (shot.error) return err(shot.error);
        return [{ to: 'all', msg: { t: 'shot', by: shot.by, frames: shot.frames, falls: shot.falls, saved: shot.saved, state: this.snapshot() } }];
      }
      default:
        return [];
    }
  }

  // ---- 対戦 ----
  startGame() {
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
      mode: s.mode, n, order, starter, turn: starter, shots: 0, outOrder: [], result: null,
      bodies: order.map((mid, i) => {
        const lo = this.member(mid).loadout;
        return { owner: i, ruler: lo.ruler, specKey: lo.specKey, mods: lo.mods, pattern: lo.pattern, sticker: lo.sticker, x: st[i].x, y: st[i].y, a: st[i].a, state: 'desk' };
      }),
      kos: order.map(() => 0),
      players: order.map(() => ({ alive: true, selfOut: false })),
    };
    for (const mid of order) if (!(mid in s.wins)) s.wins[mid] = 0;
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

  shoot(input) {
    const g = this.s.game;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    let lx = num(input.lx), ly = num(input.ly), dx = num(input.dx), dy = num(input.dy), power = num(input.power);
    if ([lx, ly, dx, dy, power].some(Number.isNaN)) return { error: 'はじき方のデータが正しくありません' };
    const world = this.buildWorld();
    const body = world.bodies[g.turn];
    lx = Math.max(-body.hx, Math.min(body.hx, lx));
    ly = Math.max(-body.hy, Math.min(body.hy, ly));
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
    const saved = this.finishTurn(by);
    return { by, frames, falls, saved };
  }

  // はじいた後の判定。1周目に落ちた定規を戻したら true を返す。
  finishTurn(shooter) {
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
      s.phase = 'over';
      // アカウントに残す記録（部屋の外で保存する）
      this.record = {
        room: s.code, mode: g.mode, n: g.n, shots: g.shots,
        names: g.order.map((mid) => this.member(mid)?.name ?? '?'),
        players: g.order.map((mid, i) => ({
          memberId: mid, userId: this.member(mid)?.userId || null, seat: i, won: winners.includes(i),
          kos: g.kos[i], selfOut: g.players[i].selfOut, ruler: g.bodies[i].ruler,
        })),
      };
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
