// 部屋の中身（メンバー・モード・対戦の進行）を扱う純粋なロジック。
// Cloudflare の機能には依存しないので、Node でもそのままテストできる。
import Physics from './physics.js';
import { DESKS, MODES, PLAYERS, TEAMS, teamOf, seats, playableReason, deskTiles, onTile, pickVanish, SHRINK_FROM_PLAYERS, CRIT, SKILLS, skillFor, SKILL_TUNE, GAUGE, EVENTS, chairSides, FIELD_ITEM } from './rules.js';
import { resolveLoadout, DEFAULT_RULER } from './catalog.js';

export const FPS = 30;
export const STEP = 1 / 600;
export const MAX_SIM_SECONDS = 12;
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
  // opt.fair：レア度・レベル・アクセサリの上乗せをなくす（特性と必殺技は残す）
  constructor(code, mode = 'standard', now = Date.now(), opt = {}) {
    this.s = {
      code, createdAt: now, lastActive: now,
      mode: MODES[mode] ? mode : 'standard', // 部屋を作るときに決め、あとから変えない
      fair: !!opt.fair,
      members: [],         // 入室順＝席順。{ id, token, userId, name, loadout, ready, connected }
      hostId: null,        // いちばん古くからいる人（切れた人の番を飛ばせる）
      phase: 'lobby',      // lobby（部屋で準備中）| aim（対戦中）
      startAt: null,       // この時刻になったら対戦を始める（人数がそろっていないときは null）
      game: null,          // 対戦中の状態。決着後も結果を見せるために残す
      wins: {},            // memberId -> 勝ち数
    };
    this.rand = Math.random; // 机が消える順番・クリティカルの抽選（テストでは差し替える）
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
      fair: !!s.fair,
      startIn: s.phase === 'lobby' && s.startAt !== null ? Math.max(0, s.startAt - now) : null,
      members: s.members.map((x) => ({ id: x.id, name: x.name, account: !!x.userId, loadout: x.loadout, ready: !!x.ready, connected: x.connected })),
      wins: s.wins,
      game: s.game && {
        n: s.game.n, order: s.game.order, turn: s.game.turn, shots: s.game.shots, id: s.game.id,
        desks: s.game.desks || null, vanish: s.game.vanish ?? null, vanishIn: s.game.vanishIn ?? null, vanishWait: s.game.vanishWait ?? null,
        gauge: s.game.gauge || null, extra: !!s.game.extra, event: s.game.event || null, eventId: s.game.eventId || 0,
        walls: s.game.walls || [], icy: s.game.icy || 0, icyNext: !!s.game.icyNext, fx: s.game.fx || [], items: s.game.items || [],
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
        s.game.extra = false; // 連打の2打目も飛ばす
        // 飛ばした番も1回と数える（机が消える予告・場のイベントが進む）
        const vanished = this.finishTurn(s.game.turn, now, { skipped: true }).vanished;
        return [{ to: 'all', msg: { t: 'state', state: this.snapshot(now), vanished } }];
      }
      case 'skill': {
        // その場で効く必殺技（保健室・身代わり・反撃・ワープ・いす召喚・吹雪）
        if (s.phase !== 'aim') return err('対戦中ではありません');
        const g = s.game;
        if (g.order[g.turn] !== id) return err('あなたの番ではありません');
        if (g.extra) return err('連打の2打目では必殺技は使えません');
        if ((g.gauge?.[g.turn] ?? 0) < GAUGE.max) return err('必殺技のゲージがまだたまっていません');
        const k = this.skillOf(g.turn);
        if (SKILLS[k].mode !== 'now') return err(`「${SKILLS[k].name}」は、構えてからはじくと使える必殺技です`);
        g.gauge[g.turn] = 0;
        this.useNow(g.turn, k);
        return state();
      }
      case 'flick': {
        if (s.phase !== 'aim') return err('今ははじけません');
        const g = s.game;
        if (g.order[g.turn] !== id) return err('あなたの番ではありません');
        const shot = this.shoot(msg, now);
        if (shot.error) return err(shot.error);
        return [{ to: 'all', msg: { t: 'shot', by: shot.by, frames: shot.frames, falls: shot.falls, saved: shot.saved, crit: shot.crit, vanished: shot.vanished, skill: shot.skill, blast: shot.blast, hits: shot.hits, marks: shot.marks, pickups: shot.pickups, state: this.snapshot(now) } }];
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
        return {
          owner: i, hp: Physics.HP.max, tune: lo.tune || null, skill: SKILLS[lo.skill] ? lo.skill : skillFor(lo.specKey), ruler: lo.ruler, specKey: lo.specKey,
          level: lo.level || 1, mods: s.fair ? { mass: 1, mu: 1, power: 1 } : lo.mods, pattern: lo.pattern, sticker: lo.sticker,
          rarity: lo.rarity || 'N', art: lo.art || 'plain', trait: lo.trait || null, traitPct: lo.traitPct || 0, st: lo.skillTune || null,
          x: st[i].x, y: st[i].y, a: st[i].a, state: 'desk',
        };
      }),
      kos: order.map(() => 0),
      players: order.map(() => ({ alive: true, selfOut: false })),
      desks: deskTiles(desk).map((t) => t.i), // 残っている机
      vanish: null,                           // 消える予告が出ている机
      vanishIn: null,                         // あと何人の番が終わると消えるか
      vanishWait: null,                       // 予告のあと、まだ番を終えていない人（全員が1回ずつ終えたら消える）
      gauge: order.map(() => 0),              // 必殺技のゲージ
      extra: false,                           // 連打の2打目が残っている
      event: null,                            // 場のイベント { type: 'ice' | 'chair', left（あと何回の番）, side ... }
      eventId: 0,
    };
    for (const mid of order) if (!(mid in s.wins)) s.wins[mid] = 0;
    for (const m of s.members) m.ready = false;
    s.startAt = null;
    s.phase = 'aim';
  }

  // 対戦で使う机の並べ方（ステージでは盤面ごとに変わる）
  deskDef() {
    return DESKS[MODES[this.s.game?.mode]?.desk] || DESKS.pair;
  }

  // 盤面の定規1本を、物理エンジンの体にする（ステージでは敵の性質を足す）
  makeBody(b, opt = {}) {
    const body = Physics.createBody('p' + b.owner, b.owner, b.specKey, b.x, b.y, b.a, b.mods, b.tune, {
      shape: Physics.shapeOf(b.specKey, b.hp ?? Physics.HP.max, b.maxHp, opt.form), ...this.bodyExtra(b),
    });
    body.state = b.state === 'desk' ? 'desk' : 'gone';
    if (b.anchor) {
      // 不動：重くして押されにくくする（机との摩擦も重さに比例するので、すべり方は変わらない）
      const k = SKILL_TUNE.anchorMass;
      body.m *= k; body.invM /= k; body.I *= k; body.invI /= k;
    }
    if (b.dmgMul) body.dmgMul = b.dmgMul;
    // 特性：鋭い縁（当てたときのダメージ）・ふんばり（すべりにくさ）・重心（当てられたときの飛び方）
    const tp = (b.traitPct || 0) / 100;
    if (b.trait === 'edge') body.dmgMul = (body.dmgMul ?? 1) * (1 + tp);
    if (b.trait === 'grip') body.mu *= 1 + tp;
    if (b.trait === 'center') body.kbMul = 1 - tp;
    Physics.setHp(body, b.hp ?? body.maxHp);
    return body;
  }
  bodyExtra() { return {}; }

  buildWorld() {
    const g = this.s.game;
    const desk = this.deskDef();
    const all = deskTiles(desk);
    const left = g.desks || all.map((t) => t.i);
    const ev = g.event;
    const icy = ev?.type === 'ice' || g.icy > 0; // 場のイベント「こおり」か、必殺技「吹雪」
    const walls = [...(ev?.type === 'chair' ? [ev.wall] : []), ...(g.walls || []).map((w) => w.wall)]; // 「いす」と「いす召喚」
    const world = Physics.createWorld(
      { friction: icy ? EVENTS.ice.friction : 1 },
      { w: desk.w, h: desk.h, tiles: left.length < all.length ? all.filter((t) => left.includes(t.i)) : null, walls: walls.length ? walls : null },
    );
    for (const b of g.bodies) world.bodies.push(this.makeBody(b));
    world.items = (g.items || []).map((it) => ({ ...it, taken: false }));
    return world;
  }

  shoot(input, now = Date.now()) {
    const dt = STEP;
    const perFrame = Math.round(1 / FPS / dt);
    const g = this.s.game;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    let lx = num(input.lx), ly = num(input.ly), dx = num(input.dx), dy = num(input.dy), power = num(input.power);
    if ([lx, ly, dx, dy, power].some(Number.isNaN)) return { error: 'はじき方のデータが正しくありません' };
    const world = this.buildWorld();
    let body = world.bodies[g.turn];
    if (input.skill && !g.extra && (g.gauge?.[g.turn] ?? 0) >= GAUGE.max && this.skillOf(g.turn) === 'fullopen' && Physics.RULERS[body.specKey]?.forms) {
      // 全開：この1打だけ、いちばん長い形で動く
      body = world.bodies[g.turn] = this.makeBody(g.bodies[g.turn], { form: 2 });
    }
    // はじいた本人は、自分の体力に関係なくふつうにすべる
    body.shooter = true;
    Physics.setHp(body, body.hp);
    // はじく点は定規の上に収める（形の変わる定規は、はじく前の形で押さえた点を合わせる）
    ({ x: lx, y: ly } = Physics.nearestOnShape(body.shapeKey, lx, ly));
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { error: 'はじく向きが正しくありません' };
    dx /= len; dy /= len;
    power = Math.max(0.05, Math.min(1, power));
    // 必殺技（定規の形で決まる。ゲージが満タンのときだけ）
    const by = g.turn;
    let skill = null;
    if (input.skill) {
      if (g.extra) return { error: '連打の2打目では必殺技は使えません' };
      if ((g.gauge?.[by] ?? 0) < GAUGE.max) return { error: '必殺技のゲージがまだたまっていません' };
      skill = this.skillOf(by);
      if (SKILLS[skill].mode !== 'shot') return { error: `「${SKILLS[skill].name}」は、ボタンを押した時点で使う必殺技です` };
      g.gauge[by] = 0;
    }
    const tune = { ...SKILL_TUNE, ...(g.bodies[by].st || {}) };
    if (skill === 'power') power *= SKILL_TUNE.powerMul;
    // SSR の専用技
    if (skill === 'niji') power *= tune.nijiPower / 100;
    if (skill === 'ichimonji') { body.noSpin = true; body.crit = CRIT.mul; }
    if (skill === 'gomu') body.edgeBounce = { left: 1, speed: tune.gomuSpeed / 100 };
    if (skill === 'ikkaku') {
      const c = Physics.sharpestCorner(body.shapeKey);
      body.tip = { x: c.x, y: c.y, r: c.span * tune.ikkakuTip / 100, push: tune.ikkakuPush / 100, dmg: tune.ikkakuDmg / 100 };
    }
    if (skill === 'hyaku') {
      const deg = Math.max(-tune.hyakuMax, Math.min(tune.hyakuMax, Number.isFinite(input.curve) ? input.curve : 0));
      body.curve = { at: tune.hyakuDelay / 1000, ang: (deg * Math.PI) / 180 };
    }
    if (skill === 'heavy') body.dmgMul = (body.dmgMul ?? 1) * SKILL_TUNE.heavyDmg;
    if (skill === 'fullopen') body.dmgMul = (body.dmgMul ?? 1) * SKILL_TUNE.fullopenDmg;
    // クリティカルの抽選（当たっても、相手に当たらなければ何も起きない）
    if (this.rand() < CRIT.rate) body.crit = CRIT.mul;
    const marks = []; // 技の印（一角・ゴム跳び・百八十度）
    Physics.flick(world, body, lx, ly, dx, dy, power);
    let crit = null;

    // 1/30秒ごとに位置を記録して、全員に動きをそのまま配る
    const frames = [encodeFrame(world)];
    const falls = [];
    const hits = [];
    const pickups = [];
    let seen = 0;
    let steps = 0;
    const drain = () => {
      while (world.events && seen < world.events.length) {
        const e = world.events[seen++];
        if (e.type === 'hit') hits.push({ f: frames.length - 1, target: e.target, from: e.from, dmg: e.dmg, x: round2(e.x), y: round2(e.y), kind: e.kind });
        if (e.type === 'pickup') pickups.push({ f: frames.length - 1, item: e.item, owner: e.owner, amount: e.amount, x: round2(e.x), y: round2(e.y) });
      }
    };
    const run = () => {
      while (!Physics.atRest(world) && steps < MAX_SIM_SECONDS / dt) {
        for (let k = 0; k < perFrame; k++) {
          for (const b of Physics.step(world, dt)) {
            falls.push({ owner: b.owner, f: frames.length, x: round2(b.x), y: round2(b.y) });
          }
          steps++;
        }
        frames.push(encodeFrame(world));
        // ぶつかったときのダメージ・回復アイテム（画面に数字を出すため、何コマ目かを記録）
        drain();
        if (!crit && world.events?.length) {
          const e = world.events.find((ev) => ev.type === 'crit');
          if (e) crit = { f: frames.length - 1, x: round2(e.x), y: round2(e.y), target: e.target };
        }
        for (const e of world.events || []) {
          if (['tip', 'bounce', 'curve'].includes(e.type) && !e.marked) { e.marked = true; marks.push({ kind: e.type, f: frames.length - 1, x: round2(e.x), y: round2(e.y) }); }
        }
      }
    };
    run();
    // 突風・爆発・磁石：止まった場所から周りを吹き飛ばす（引き寄せる）。そのあと、また止まるまで動かす
    let blast = null;
    if (['wind', 'bomb', 'magnet'].includes(skill) && body.state === 'desk') {
      const T = SKILL_TUNE;
      const [radius, speed, dmg] = skill === 'wind' ? [body.spec.shape === 'protractor' ? T.windRadiusProtractor : T.windRadius, T.windSpeed, Physics.HP.windDmg]
        : skill === 'bomb' ? [T.bombRadius, T.bombSpeed, T.bombDmg] : [T.magnetRadius, T.magnetSpeed, 0];
      for (let k = 0; k < 8; k++) frames.push(encodeFrame(world)); // ひと呼吸おいてから
      const hit = Physics.blast(world, body, radius, speed, dmg, skill);
      blast = { kind: skill, f: frames.length - 1, x: round2(body.x), y: round2(body.y), r: radius, hit };
      drain();
      run();
    }
    for (const b of world.bodies) if (b.state === 'falling') b.state = 'gone';
    // 拾われた回復アイテムは消える
    if (g.items?.length) g.items = g.items.filter((it) => !world.items.find((w) => w.id === it.id)?.taken);

    // ゲージ：はじいた人、当てた相手の数、動かされた人にたまる（必殺技を使った1打では、使った人にはたまらない）
    const before = g.bodies.map((b) => ({ x: b.x, y: b.y, state: b.state }));
    g.bodies = g.bodies.map((prev, i) => {
      const b = world.bodies[i];
      return { ...prev, x: round2(b.x), y: round2(b.y), a: round4(b.a), hp: Math.round(b.hp * 10) / 10, state: b.state === 'desk' ? 'desk' : 'gone' };
    });
    if (g.gauge) {
      const add = (i, v) => { g.gauge[i] = Math.min(GAUGE.max, g.gauge[i] + v); };
      let moved = 0;
      g.bodies.forEach((b, i) => {
        if (i === by || before[i].state !== 'desk') return;
        if (b.state !== 'desk' || Math.hypot(b.x - before[i].x, b.y - before[i].y) > 1) { moved++; add(i, GAUGE.beHit); }
      });
      // 特性「方眼」：はじいたときのたまりが増える
      const grid = g.bodies[by].trait === 'grid' ? 1 + (g.bodies[by].traitPct || 0) / 100 : 1;
      if (!skill) add(by, Math.round((GAUGE.shot + moved * GAUGE.hit) * grid * 10) / 10);
    }
    if (skill === 'anchor') g.bodies[by].anchor = true;
    // インク漏れ：この1打で当てた相手に、毎番のダメージ
    if (skill === 'ink') {
      for (const t of new Set(hits.filter((h) => h.from === by && h.target !== by).map((h) => h.target))) {
        if (g.bodies[t]) g.bodies[t].ink = SKILL_TUNE.inkRounds;
      }
    }
    // 反撃：構えている定規が当てられたら、同じダメージを当てた側にも返す
    for (const h of [...hits]) {
      const t = g.bodies[h.target], f = g.bodies[h.from];
      if (!t?.counter || !f || h.from === h.target || h.kind === 'counter') continue;
      f.hp = Math.max(0, Math.round((f.hp - h.dmg) * 10) / 10);
      hits.push({ f: h.f, target: h.from, from: h.target, dmg: h.dmg, x: round2(f.x), y: round2(f.y), kind: 'counter' });
    }
    // 連打の1打目なら、同じ人がもう1回はじく（机が消えるのは2打目のあと）
    const keepTurn = skill === 'double' && world.bodies[by].state === 'desk';
    if (!keepTurn) { g.shots++; g.extra = false; }
    const { saved, vanished } = this.finishTurn(by, now, { keepTurn });
    return { by, frames, falls, saved, crit, vanished, skill, blast, wind: blast?.kind === 'wind' ? blast : null, hits, marks, pickups };
  }

  // はじいた後の判定。{ saved: 1周目に落ちた定規を戻したか, vanished: 消えた机 { desk, drops } }
  finishTurn(shooter, now = Date.now(), opt = {}) {
    const s = this.s, g = s.game;
    const teams = MODES[g.mode].teams;
    let saved = false;
    if (g.shots <= g.n) {
      const st = seats(g.n, this.deskDef());
      for (const b of g.bodies) {
        if (b.state === 'desk') continue;
        Object.assign(b, { x: round2(st[b.owner].x), y: round2(st[b.owner].y), a: round4(st[b.owner].a), state: 'desk' });
        saved = true;
      }
    }
    // 予告していた机が消える。重心がその机の上にあった定規は落ちる
    let vanished = null;
    // 予告が出てから、残っている全員が必ず1回ずつ番を終える（はじく・時間切れのどちらでも1回）。全員が終えたら消す。
    // 連打の1打目は番の途中なので数えない
    const pending = g.vanish !== null && g.vanish !== undefined;
    if (!opt.keepTurn && pending) {
      const wait = g.vanishWait ?? g.players.map((p, i) => (p.alive ? i : -1)).filter((i) => i >= 0);
      g.vanishWait = wait.filter((i) => i !== shooter && g.players[i].alive);
      g.vanishIn = g.vanishWait.length;
    }
    if (!opt.keepTurn && pending && g.desks && g.vanishWait.length === 0) {
      const desk = this.deskDef();
      const tiles = deskTiles(desk);
      const gone = tiles[g.vanish];
      g.desks = g.desks.filter((i) => i !== g.vanish);
      const rest = tiles.filter((t) => g.desks.includes(t.i));
      const drops = [];
      g.bodies.forEach((b, i) => {
        if (b.state === 'desk' && onTile(gone, b.x, b.y) && !rest.some((t) => onTile(t, b.x, b.y))) { b.state = 'gone'; drops.push(i); }
      });
      vanished = { desk: g.vanish, drops };
      g.vanish = null;
      g.vanishIn = null;
      g.vanishWait = null;
    }
    // 体力が0になった定規は倒れる（机の上に残っていても）
    g.bodies.forEach((b, i) => {
      if (b.state !== 'desk' || !g.players[i].alive || (b.hp ?? 1) > 0) return;
      b.state = 'gone'; b.ko = true;
    });
    // 身代わり：落ちた（倒れた）定規が1回だけ机の真ん中に戻る（体力は半分。倒れたときは最大の半分）
    g.bodies.forEach((b, i) => {
      if (!b.sub || b.state === 'desk' || !g.players[i].alive) return;
      b.state = 'desk'; b.sub = false;
      Object.assign(b, this.freeSpot(i));
      b.hp = b.ko ? Math.round((b.maxHp || Physics.HP.max) / 2) : Math.round((b.hp ?? 100) / 2 * 10) / 10;
      b.ko = false;
      if (vanished) vanished.drops = vanished.drops.filter((d) => d !== i);
      this.pushFx({ kind: 'subUsed', owner: i, x: b.x, y: b.y });
    });
    const newly = [];
    g.players.forEach((p, i) => {
      if (p.alive && g.bodies[i].state !== 'desk') {
        const byDesk = !!vanished?.drops.includes(i);
        const ko = !!g.bodies[i].ko && !byDesk;
        p.alive = false; p.selfOut = !byDesk && !ko && !opt.skipped && i === shooter; p.byDesk = byDesk; p.ko = ko; newly.push(i);
        if (ko) this.pushFx({ kind: 'down', owner: i, how: 'ko', x: g.bodies[i].x, y: g.bodies[i].y });
      }
    });
    if (newly.length) g.outOrder.push(newly);
    for (const i of newly) if (i !== shooter && !g.players[i].byDesk && !opt.skipped) g.kos[shooter]++;
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
          ? `両チームとも全員倒れたので、はじいた${TEAMS[teamOf(shooter)].name}の負け`
          : `${TEAMS[1 - wt].name}が全員倒れた`;
      }
    } else if (alive.length <= 1) {
      winners = alive.length === 1 ? alive : newly.filter((i) => i !== shooter);
      title = `${winners.map((i) => this.member(g.order[i])?.name ?? '?').join('・')}の勝ち！`;
      if (g.n === 2) {
        const opp = 1 - shooter;
        const selfOut = newly.includes(shooter), oppOut = newly.includes(opp);
        if (selfOut && oppOut) reason = `両方倒れたので、はじいた${label(shooter)}の負け`;
        else if (selfOut) reason = g.players[shooter].ko ? `${label(shooter)}の体力が0になった` : `${label(shooter)}の定規が自分で落ちた`;
        else reason = g.players[opp].ko ? `${label(opp)}の体力が0になった` : `${label(opp)}の定規が机から落ちた`;
      } else if (alive.length === 1) {
        const last = newly.filter((i) => g.players[i].byDesk);
        reason = last.length ? `机が消えて、${last.map(label).join('・')}の定規が落ちた` : '最後まで机に残った';
      } else {
        reason = `最後の${newly.length}人が同時に倒れ、はじいた${label(shooter)}以外が勝ち`;
      }
    }

    if (winners) {
      for (const i of winners) s.wins[g.order[i]] = (s.wins[g.order[i]] || 0) + 1;
      const order = g.outOrder.map((grp) => grp.map((i) => label(i) + (g.players[i].selfOut ? '・自滅' : g.players[i].byDesk ? '・机が消えた' : g.players[i].ko ? '・体力0' : '')).join('、'));
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
    } else if (opt.keepTurn && g.players[shooter].alive) {
      g.extra = true; // 連打：同じ人の番のまま
    } else {
      g.extra = false;
      // 場のイベント：続いているものを1回ぶん進め、なければ2周目から確率で起こす（終わった直後の番は起こさない）
      const had = !!g.event;
      if (g.event && --g.event.left <= 0) g.event = null;
      // いす召喚・吹雪の残りを進める
      if (g.walls?.length) g.walls = g.walls.map((w) => ({ ...w, left: w.left - 1 })).filter((w) => w.left > 0);
      if (g.icy > 0) g.icy--;
      if (g.icyNext) { g.icy = 1; g.icyNext = false; }
      if (!had && g.shots >= g.n && this.rand() < EVENTS.rate) this.startEvent(alive.length);
      // 3人以上で始めて残りが2人になったら、机を1台ずつ消していく（予告のあと、2人とも1回ずつ番を終えたら消える）
      if (g.n >= SHRINK_FROM_PLAYERS && g.desks && alive.length === 2 && g.desks.length > 1 && (g.vanish === null || g.vanish === undefined)) {
        g.vanish = pickVanish(this.deskDef(), g.desks, this.rand);
        g.vanishWait = alive.slice();
        g.vanishIn = alive.length;
      }
      this.advanceTurn();
    }
    return { saved, vanished };
  }

  skillOf(i) {
    const b = this.s.game.bodies[i];
    return SKILLS[b?.skill] ? b.skill : skillFor(b?.specKey);
  }

  // 画面に知らせる出来事（回復・ワープ・インクのダメージなど）。番号が増えたものを画面が表示する
  pushFx(e) {
    const g = this.s.game;
    g.fxId = (g.fxId || 0) + 1;
    g.fx = [...(g.fx || []), { id: g.fxId, ...e }].slice(-8);
  }

  // 机の真ん中に近く、ほかの定規とぶつからない場所
  freeSpot(i) {
    const g = this.s.game;
    const desk = this.deskDef();
    const tiles = deskTiles(desk).filter((t) => !g.desks || g.desks.includes(t.i));
    const rOf = (b) => Physics.SHAPES[(Physics.RULERS[b.specKey] || Physics.RULERS['straight30-acrylic']).shape].radius;
    const me = g.bodies[i];
    let best = null, bestD = Infinity;
    for (const t of tiles) {
      for (let x = t.x0 + 4; x <= t.x1 - 4; x += 3) for (let y = t.y0 + 4; y <= t.y1 - 4; y += 3) {
        const clear = g.bodies.every((b, j) => j === i || b.state !== 'desk' || Math.hypot(b.x - x, b.y - y) > (rOf(b) + rOf(me)) * 0.8);
        if (!clear) continue;
        const d = Math.hypot(x, y);
        if (d < bestD) { bestD = d; best = { x, y }; }
      }
    }
    if (!best) { const t = tiles[0]; best = { x: (t.x0 + t.x1) / 2, y: (t.y0 + t.y1) / 2 }; }
    return { x: round2(best.x), y: round2(best.y) };
  }

  useNow(i, k) {
    const g = this.s.game, b = g.bodies[i];
    const alive = g.players.filter((p) => p.alive).length;
    if (k === 'heal') {
      const before = b.hp ?? 100;
      b.hp = Math.min(b.maxHp || Physics.HP.max, before + SKILL_TUNE.heal);
      this.pushFx({ kind: 'heal', owner: i, x: b.x, y: b.y, amount: Math.round(b.hp - before) });
    } else if (k === 'sub') {
      b.sub = true;
      this.pushFx({ kind: 'sub', owner: i, x: b.x, y: b.y });
    } else if (k === 'counter') {
      b.counter = true;
      this.pushFx({ kind: 'counter', owner: i, x: b.x, y: b.y });
    } else if (k === 'warp') {
      const from = { x: b.x, y: b.y };
      Object.assign(b, this.freeSpot(i));
      this.pushFx({ kind: 'warp', owner: i, x: b.x, y: b.y, from });
    } else if (k === 'chair') {
      const sides = chairSides(this.deskDef(), g.desks);
      const w = sides.reduce((a, c) => ((c.d - (c.nx * b.x + c.ny * b.y)) < (a.d - (a.nx * b.x + a.ny * b.y)) ? c : a));
      g.walls = [...(g.walls || []), { left: alive, side: w.side, wall: { nx: w.nx, ny: w.ny, d: w.d, lo: w.lo, hi: w.hi } }];
      this.pushFx({ kind: 'chair', owner: i, x: b.x, y: b.y, side: w.side });
    } else if (k === 'blizzard') {
      g.icyNext = true;
      this.pushFx({ kind: 'blizzard', owner: i, x: b.x, y: b.y });
    }
  }

  startEvent(aliveCount) {
    const g = this.s.game;
    g.eventId = (g.eventId || 0) + 1;
    if (this.rand() < 0.5) {
      g.event = { type: 'ice', left: 1, id: g.eventId };
    } else {
      const sides = chairSides(this.deskDef(), g.desks);
      const w = sides[Math.floor(this.rand() * sides.length) % sides.length];
      g.event = { type: 'chair', left: aliveCount, id: g.eventId, side: w.side, wall: { nx: w.nx, ny: w.ny, d: w.d, lo: w.lo, hi: w.hi } };
    }
  }

  // 時計回りで、まだ残っている次の人へ
  advanceTurn() {
    const g = this.s.game;
    let t = g.turn;
    do { t = (t + 1) % g.n; } while (!g.players[t].alive);
    g.turn = t;
    const b = g.bodies[t];
    if (!b) return;
    // 不動・反撃は、使った人の次の番が来たら終わる
    b.anchor = false;
    b.counter = false;
    // インク漏れ：自分の番が来るたびに体力が減る。0になったら、その番は来ずに倒れる
    if (b.ink > 0) {
      b.hp = Math.max(0, Math.round(((b.hp ?? 100) - SKILL_TUNE.inkDmg) * 10) / 10);
      b.ink--;
      this.pushFx({ kind: 'ink', owner: t, x: b.x, y: b.y, amount: SKILL_TUNE.inkDmg });
      if (b.hp <= 0 && this.s.phase === 'aim') { this.finishTurn(t, Date.now(), { skipped: true }); return; }
    }
    this.maybeSpawnItem();
  }

  // 回復アイテム：2周目から、番が変わるたびに確率で、机の上の空いている所に出す
  maybeSpawnItem() {
    const g = this.s.game;
    if (!g || g.result || (this.s.phase !== 'aim') || g.shots < g.n) return;
    g.items ||= [];
    if (g.items.length >= FIELD_ITEM.max || this.rand() >= FIELD_ITEM.rate) return;
    const tiles = deskTiles(this.deskDef()).filter((t) => !g.desks || g.desks.includes(t.i));
    const r = FIELD_ITEM.r;
    for (let k = 0; k < 40; k++) {
      const t = tiles[Math.floor(this.rand() * tiles.length) % tiles.length];
      const m = Math.min(5, (t.x1 - t.x0) / 4, (t.y1 - t.y0) / 4);
      const x = round2(t.x0 + m + this.rand() * (t.x1 - t.x0 - 2 * m));
      const y = round2(t.y0 + m + this.rand() * (t.y1 - t.y0 - 2 * m));
      const clear = g.bodies.every((b) => b.state !== 'desk' || Physics.distToBody(this.makeBody(b), x, y) > r + 2.5)
        && g.items.every((o) => Math.hypot(o.x - x, o.y - y) > r * 4);
      if (!clear) continue;
      g.itemId = (g.itemId || 0) + 1;
      const it = { id: g.itemId, x, y, r, heal: FIELD_ITEM.heal, a: round2((this.rand() - 0.5) * 1.2) };
      g.items.push(it);
      this.pushFx({ kind: 'item', x, y, item: it.id });
      return;
    }
  }
}

export function round2(v) { return Math.round(v * 100) / 100; }
export function round4(v) { return Math.round(v * 10000) / 10000; }

// 1コマ＝定規ごとに [x, y, 角度, 状態]。x,y は 1/100cm、角度は 1/1000rad の整数。状態 0机上 1落下中 2消えた
export function encodeFrame(world) {
  const out = [];
  for (const b of world.bodies) {
    out.push(Math.round(b.x * 100), Math.round(b.y * 100), Math.round(b.a * 1000),
      b.state === 'desk' ? 0 : b.state === 'falling' ? 1 : 2);
  }
  return out;
}
