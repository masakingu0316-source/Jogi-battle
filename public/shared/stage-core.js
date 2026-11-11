// ステージモードの進行（サーバーで動かす）。部屋の進行（RoomCore）を土台に、
// 「自分1人 対 敵（文房具）」の盤面を、自分 → 敵1体ずつ の順に回す。
// 敵は体力0か机から落ちると倒れる。自分は机から落ちたらそのマップは失敗（体力0では負けない）。
import Physics from './physics.js';
import { RoomCore, encodeFrame, round2, round4, FPS, STEP, MAX_SIM_SECONDS } from './core.js';
import { DESKS, deskTiles, onTile, GAUGE, SKILLS, skillFor, PLAYERS } from './rules.js';
import { ENEMIES, scaleOf, aiOf, BOARD_HEAL, enemyLook, mapOf, STAGES, stageMaxHp } from './stage.js';

export const ME = 'P';
const STAGE_MOD_LIMIT = 0.3; // ステージでは Lv.50 まで効くので、倍率の上限を広げる
const ENEMY_GAUGE = 0.5;     // 敵の必殺ゲージのたまる速さ（自分を1として）

export class StageCore extends RoomCore {
  // player: { name, userId, loadout }
  constructor(stageId, map, player, now = Date.now()) {
    super('STAGE', 'standard', now);
    const def = mapOf(stageId, map);
    if (!def) throw new Error('そのマップはありません');
    this.s.mode = 'stage';
    this.s.phase = 'aim';
    this.s.stage = { id: stageId, map, board: 0, boards: def.boards.length, result: null, shots: 0, startedAt: now };
    this.s.members = [{ id: ME, token: '', userId: player.userId || null, name: player.name || 'あなた', loadout: player.loadout, ready: true, connected: true }];
    this.s.hostId = ME;
    this.loadBoard(0, null);
  }

  static restore(saved) {
    const r = Object.create(StageCore.prototype);
    r.s = saved;
    r.rand = Math.random;
    r.record = null;
    return r;
  }

  deskDef() { return DESKS[this.s.game?.desk] || DESKS.single; }

  // 盤面を並べる。carry：前の盤面から持ち越す自分の体力・ゲージ
  loadBoard(index, carry) {
    const s = this.s, st = s.stage;
    const def = mapOf(st.id, st.map).boards[index];
    const sc = scaleOf(st.map);
    const me = s.members[0];
    const lo = me.loadout;
    const desk = DESKS[def.desk];
    const maxHp = stageMaxHp(lo.level || 1);
    const bodies = [{
      owner: 0, hp: carry ? Math.min(maxHp, carry.hp + BOARD_HEAL) : maxHp, maxHp,
      tune: lo.tune || null, skill: SKILLS[lo.skill] ? lo.skill : skillFor(lo.specKey), ruler: lo.ruler, specKey: lo.specKey,
      level: lo.level || 1, mods: lo.mods, pattern: lo.pattern, sticker: lo.sticker,
      x: def.me.x, y: def.me.y, a: def.me.a ?? 0, state: 'desk', sub: !!carry?.sub,
    }];
    const members = [me];
    const looks = [{ name: me.name, color: null }];
    def.foes.forEach((f, k) => {
      const d = ENEMIES[f.t];
      const spec = f.spec || d.spec;
      const hp = Math.round(d.hp * sc.hp);
      const skill = d.skill === true ? skillFor(spec) : d.skill || 'none';
      bodies.push({
        owner: k + 1, enemy: f.t, hp, maxHp: hp, specKey: spec, level: 1, tune: null, skill,
        mods: { mass: round4(sc.body), mu: 1, power: round4(sc.power * (d.power ?? 1)) }, dmgMul: round4(sc.atk),
        x: f.x, y: f.y, a: f.a ?? 0, state: 'desk',
      });
      const look = enemyLook({ ...f, spec });
      members.push({ id: `E${k + 1}`, token: '', userId: null, name: look.name, loadout: { ruler: null, level: 1 }, ready: true, connected: true, enemy: true });
      looks.push(look);
    });
    s.members = members;
    s.game = {
      id: (s.game?.id || 0) + 1, mode: 'stage', n: bodies.length, order: members.map((m) => m.id), starter: 0, turn: 0, shots: 0,
      outOrder: [], result: null, bodies, kos: bodies.map(() => 0), players: bodies.map(() => ({ alive: true, selfOut: false })),
      desk: def.desk, desks: def.tiles ? [...def.tiles] : deskTiles(desk).map((t) => t.i),
      vanish: null, vanishIn: null, vanishWait: null,
      gauge: bodies.map((_, i) => (i === 0 ? carry?.gauge ?? 0 : 0)), extra: false, event: null, eventId: 0,
      walls: [], icy: 0, icyNext: false, looks, board: index, boardClear: false, boss: !!def.boss,
      fx: s.game?.fx || [], fxId: s.game?.fxId || 0,
    };
    s.phase = 'aim';
  }

  bodyExtra(b) {
    if (!b.enemy) return { maxHp: b.maxHp || Physics.HP.max, modLimit: STAGE_MOD_LIMIT };
    const d = ENEMIES[b.enemy];
    const sc = scaleOf(this.s.stage.map);
    return {
      maxHp: b.maxHp, modLimit: 0.6, pinned: !!d.pinned,
      thorns: d.thorns ? Math.round(d.thorns * sc.atk * 10) / 10 : 0, zone: d.zone || null,
    };
  }

  // 敵の必殺ゲージは、自分の半分の速さでたまる
  shoot(input, now) {
    const before = [...(this.s.game.gauge || [])];
    const r = super.shoot(input, now);
    const g = this.s.game;
    if (!r.error && g.gauge) g.gauge = g.gauge.map((v, i) => (i === 0 || v <= before[i] ? v : Math.round(before[i] + (v - before[i]) * ENEMY_GAUGE)));
    return r;
  }

  skillOf(i) {
    const b = this.s.game.bodies[i];
    if (!b) return 'power';
    if (b.enemy) return SKILLS[b.skill] ? b.skill : null;
    return SKILLS[b.skill] ? b.skill : skillFor(b.specKey);
  }

  look(i) {
    const g = this.s.game;
    return g.looks?.[i] || { name: PLAYERS[0].name };
  }

  snapshot() {
    const s = this.s, g = s.game, st = s.stage;
    const def = STAGES[st.id];
    return {
      code: 'STAGE', hostId: ME, mode: 'stage', phase: s.phase, capacity: 1, minPlayers: 1, startIn: null,
      members: s.members.map((x) => ({ id: x.id, name: x.name, account: !!x.userId, loadout: x.loadout, ready: true, connected: true, enemy: !!x.enemy })),
      wins: {},
      stage: { id: st.id, name: def.name, map: st.map, mapsTotal: def.maps.length, mapName: def.maps[st.map - 1].name, board: st.board, boards: st.boards, result: st.result, shots: st.shots },
      game: g && {
        n: g.n, order: g.order, turn: g.turn, shots: g.shots, id: g.id,
        desk: g.desk, desks: g.desks, vanish: null, vanishIn: null, vanishWait: null,
        gauge: g.gauge, extra: !!g.extra, event: null, eventId: 0,
        walls: g.walls || [], icy: g.icy || 0, icyNext: !!g.icyNext, fx: g.fx || [],
        bodies: g.bodies, players: g.players, result: g.result, looks: g.looks, board: g.board, boardClear: !!g.boardClear, boss: !!g.boss,
      },
    };
  }

  // 番の終わり：倒れた敵・落ちた自分・盤面クリアを決めて、次の番へ
  finishTurn(shooter, now = Date.now(), opt = {}) {
    const s = this.s, g = s.game;
    if (!opt.keepTurn) s.stage.shots += shooter === 0 ? 1 : 0;
    // 身代わり：落ちた定規が1回だけ机の真ん中に戻る（体力は半分）
    g.bodies.forEach((b, i) => {
      if (!b.sub || b.state === 'desk' || !g.players[i].alive) return;
      b.state = 'desk'; b.sub = false;
      Object.assign(b, this.freeSpot(i));
      b.hp = Math.round((b.hp ?? 100) / 2 * 10) / 10;
      this.pushFx({ kind: 'subUsed', owner: i, x: b.x, y: b.y });
    });
    // 敵：机から落ちたか、体力が0になったら倒れる
    g.bodies.forEach((b, i) => {
      if (i === 0 || !g.players[i].alive) return;
      if (b.state !== 'desk') {
        g.players[i].alive = false; g.players[i].how = 'fall';
        if (shooter === 0) g.kos[0]++;
        this.pushFx({ kind: 'down', owner: i, how: 'fall', x: b.x, y: b.y });
      } else if ((b.hp ?? 1) <= 0) {
        b.state = 'gone';
        g.players[i].alive = false; g.players[i].how = 'ko';
        if (shooter === 0) g.kos[0]++;
        this.pushFx({ kind: 'down', owner: i, how: 'ko', x: b.x, y: b.y });
      }
    });
    // 自分が落ちたら、このマップは失敗
    if (g.bodies[0].state !== 'desk') {
      g.players[0].alive = false;
      g.players[0].selfOut = shooter === 0;
      const reason = shooter === 0 ? '自分の定規が机から落ちた（自滅）' : `${this.look(shooter).name}に机から落とされた`;
      g.result = { winners: [], title: 'マップ失敗', reason, outOrder: [] };
      s.stage.result = { cleared: false, reason };
      s.phase = 'over';
      return { saved: false, vanished: null };
    }
    // 敵が全部倒れたら盤面クリア（次の盤面へは nextBoard で進む）
    if (g.players.every((p, i) => i === 0 || !p.alive)) {
      g.boardClear = true;
      g.extra = false;
      return { saved: false, vanished: null };
    }
    if (opt.keepTurn && g.players[shooter].alive) {
      g.extra = true; // 連打：同じ番のまま
      return { saved: false, vanished: null };
    }
    g.extra = false;
    if (g.walls?.length) g.walls = g.walls.map((w) => ({ ...w, left: w.left - 1 })).filter((w) => w.left > 0);
    if (g.icy > 0) g.icy--;
    if (g.icyNext) { g.icy = 1; g.icyNext = false; }
    this.advanceTurn();
    return { saved: false, vanished: null };
  }

  // 盤面クリアのあと：次の盤面へ。最後の盤面ならマップクリア
  nextBoard() {
    const s = this.s, g = s.game, st = s.stage;
    if (st.board + 1 >= st.boards) {
      st.result = { cleared: true };
      g.result = { winners: [0], title: 'マップクリア！', reason: '', outOrder: [] };
      s.phase = 'over';
      const me = s.members[0];
      this.record = { stage: st.id, map: st.map, ruler: me.loadout?.ruler, userId: me.userId, shots: st.shots };
      return { t: 'state', state: this.snapshot(), stage: 'clear' };
    }
    const me = g.bodies[0];
    st.board++;
    this.loadBoard(st.board, { hp: me.hp ?? me.maxHp, gauge: g.gauge?.[0] ?? 0, sub: !!me.sub });
    return { t: 'state', state: this.snapshot(), stage: 'board', board: st.board };
  }

  // ---- 敵の番 ----
  // 戻り値：画面へ送るメッセージの配列（動く敵は shot、置物は state）
  enemyTurn(now = Date.now(), rand = Math.random) {
    const g = this.s.game;
    const i = g.turn;
    const b = g.bodies[i];
    const d = ENEMIES[b?.enemy];
    if (!d) { this.advanceTurn(); return []; }
    if (d.move) {
      const shot = planEnemy(this, i, rand);
      const out = this.handle(g.order[i], { t: 'flick', ...shot }, now);
      return out.map((o) => o.msg);
    }
    if (d.act === 'swing') return this.swing(i, d, now);
    const before = g.fxId || 0;
    if (d.act === 'nibble') this.nibble(i, d);
    else if (d.act === 'heal') this.mend(i, d);
    const acted = (g.fxId || 0) > before;
    this.finishTurn(i, now);
    // 効果がなかった置物は、画面に何も送らない（番だけ進める）
    return acted ? [{ t: 'state', state: this.snapshot(), act: i }] : [];
  }

  // 自分の定規の外形から、点 (x, y) までのいちばん近い距離
  distToMe(x, y) {
    const g = this.s.game;
    const me = g.bodies[0];
    if (me.state !== 'desk') return Infinity;
    const body = this.makeBody(me);
    let best = Math.hypot(me.x - x, me.y - y);
    for (const v of Physics.worldVerts(body)) best = Math.min(best, Math.hypot(v.x - x, v.y - y));
    return best;
  }

  // 消しゴム：すぐそばにいる自分の体力を少し削る
  nibble(i, d) {
    const g = this.s.game, b = g.bodies[i], me = g.bodies[0];
    if (this.distToMe(b.x, b.y) > d.range) return;
    const amount = Math.round(d.amount * scaleOf(this.s.stage.map).act * 10) / 10;
    me.hp = Math.max(0, Math.round(((me.hp ?? 100) - amount) * 10) / 10);
    this.pushFx({ kind: 'nibble', owner: i, x: me.x, y: me.y, amount, from: { x: b.x, y: b.y } });
  }

  // 修正テープ：近くの敵（自分以外）の体力を直す
  mend(i, d) {
    const g = this.s.game, b = g.bodies[i];
    const amount = Math.round(d.amount * scaleOf(this.s.stage.map).act);
    const healed = [];
    g.bodies.forEach((o, j) => {
      if (j === 0 || j === i || !g.players[j].alive || o.state !== 'desk') return;
      if (Math.hypot(o.x - b.x, o.y - b.y) > d.range || o.hp >= o.maxHp) return;
      const add = Math.min(amount, o.maxHp - o.hp);
      o.hp = Math.round((o.hp + add) * 10) / 10;
      healed.push({ owner: j, x: o.x, y: o.y, amount: Math.round(add) });
    });
    if (healed.length) this.pushFx({ kind: 'mend', owner: i, x: b.x, y: b.y, healed, r: d.range });
  }

  // コンパス：近くにいる定規を弾き飛ばす（近くにだれもいなければ何もしない）
  swing(i, d, now) {
    const g = this.s.game, b = g.bodies[i];
    const near = g.bodies.some((o, j) => j !== i && o.state === 'desk' && g.players[j].alive && Math.hypot(o.x - b.x, o.y - b.y) < d.range + 8);
    if (!near || this.distToMe(b.x, b.y) > d.range + 4) {
      this.finishTurn(i, now);
      return [];
    }
    const world = this.buildWorld();
    const src = world.bodies[i];
    const sc = scaleOf(this.s.stage.map);
    const frames = [encodeFrame(world)];
    for (let k = 0; k < 8; k++) frames.push(encodeFrame(world));
    const hit = Physics.blast(world, src, d.range, d.speed * sc.body, d.amount * sc.act, 'compass');
    const blast = { kind: 'compass', f: frames.length - 1, x: round2(src.x), y: round2(src.y), r: d.range, hit };
    const { falls, hits } = runWorld(world, frames);
    this.applyWorld(world);
    this.finishTurn(i, now);
    return [{ t: 'shot', by: i, frames, falls, saved: false, crit: null, vanished: null, skill: null, blast, hits, state: this.snapshot() }];
  }

  // 物理の結果を盤面に書き戻す
  applyWorld(world) {
    const g = this.s.game;
    g.bodies = g.bodies.map((prev, i) => {
      const b = world.bodies[i];
      return { ...prev, x: round2(b.x), y: round2(b.y), a: round4(b.a), hp: Math.round(b.hp * 10) / 10, state: b.state === 'desk' ? 'desk' : 'gone' };
    });
  }
}

// 止まるまで動かす（コンパスの弾き飛ばし用）
function runWorld(world, frames) {
  const dt = STEP, perFrame = Math.round(1 / FPS / dt);
  const falls = [], hits = [];
  let steps = 0, seen = 0;
  while (!Physics.atRest(world) && steps < MAX_SIM_SECONDS / dt) {
    for (let k = 0; k < perFrame; k++) {
      for (const b of Physics.step(world, dt)) falls.push({ owner: b.owner, f: frames.length, x: round2(b.x), y: round2(b.y) });
      steps++;
    }
    frames.push(encodeFrame(world));
    drain();
  }
  drain(); // 動かなかったとき（刺さっている相手だけ）も、ダメージは記録する
  for (const b of world.bodies) if (b.state === 'falling') b.state = 'gone';
  return { falls, hits };
  function drain() {
    while (world.events && seen < world.events.length) {
      const e = world.events[seen++];
      if (e.type === 'hit') hits.push({ f: frames.length - 1, target: e.target, from: e.from, dmg: e.dmg, x: round2(e.x), y: round2(e.y), kind: e.kind });
    }
  }
}

// ---- 敵のはじき方 ----
const gauss = (rand) => (rand() + rand() + rand() - 1.5) / 0.75;

// 机の端までの近さ
function margin(tiles, x, y) {
  let best = 16;
  for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let d = 0;
    while (d < best && tiles.some((t) => onTile(t, x + ux * d, y + uy * d))) d += 1;
    best = Math.min(best, d);
  }
  return best;
}

// はじいたあとの局面の良さ（敵 i から見て）
function evaluate(before, after, i) {
  const g0 = before.game, g = after.game;
  let score = 0;
  const p0 = g0.bodies[0], p = g.bodies[0];
  if (after.phase === 'over' && after.stage.result && !after.stage.result.cleared) score += 1000;
  score += ((p0.hp ?? 100) - (p.hp ?? 100)) * 2;
  const tiles = deskTiles(DESKS[g.desk]).filter((t) => g.desks.includes(t.i));
  if (p.state === 'desk') score += (16 - margin(tiles, p.x, p.y)) * 3;
  g.bodies.forEach((b, j) => {
    if (j === 0 || !g0.players[j]?.alive) return;
    const lost = (g0.bodies[j].hp ?? 0) - (b.hp ?? 0);
    if (!g.players[j].alive) score -= j === i ? 400 : 150;
    else {
      score -= lost * (j === i ? 0.6 : 0.4);
      if (j === i && b.state === 'desk') score += margin(tiles, b.x, b.y) * 2;
    }
  });
  return score;
}

function trial(core, i, input) {
  const sim = StageCore.restore(structuredClone(core.s));
  sim.rand = () => 0.99; // クリティカルは当てにしない
  const r = sim.shoot(input, Date.now());
  if (r.error) return -Infinity;
  return evaluate(core.s, sim.s, i);
}

export function planEnemy(core, i, rand = Math.random) {
  const g = core.s.game;
  const ai = aiOf(core.s.stage.map);
  const mine = g.bodies[i];
  const me = g.bodies[0];
  const shapeKey = Physics.shapeOf(mine.specKey, mine.hp, mine.maxHp);
  const sh = Physics.SHAPES[shapeKey];
  const sk = core.skillOf(i);
  const canSkill = !!sk && SKILLS[sk]?.mode === 'shot' && !g.extra && (g.gauge?.[i] ?? 0) >= GAUGE.max;
  const useSkill = canSkill && rand() < ai.skillRate;
  const meSpec = Physics.RULERS[me.specKey] || Physics.RULERS['straight30-acrylic'];
  const meHalf = Physics.SHAPES[Physics.shapeOf(me.specKey, me.hp, me.maxHp)]?.radius ?? Physics.SHAPES[meSpec.shape].radius;
  let best = null, bestScore = -Infinity;
  for (let k = 0; k < ai.samples; k++) {
    // 自分の定規のどこかを狙う
    const along = (rand() - 0.5) * 2 * meHalf * 0.6;
    const tx = me.x + Math.cos(me.a) * along, ty = me.y + Math.sin(me.a) * along;
    const len = Math.hypot(tx - mine.x, ty - mine.y) || 1;
    const off = (rand() - 0.5) * sh.radius * 0.5;
    const near = Physics.nearestOnShape(shapeKey, off, 0);
    const c = { lx: near.x, ly: near.y, dx: (tx - mine.x) / len, dy: (ty - mine.y) / len, power: 0.35 + rand() * 0.65, skill: useSkill };
    const score = trial(core, i, c) + rand() * 2;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  // 試したはじき方がどれも使えなかったとき（念のため）は、自分の定規へまっすぐ
  if (!best) {
    const len = Math.hypot(me.x - mine.x, me.y - mine.y) || 1;
    best = { lx: 0, ly: 0, dx: (me.x - mine.x) / len, dy: (me.y - mine.y) / len, power: 0.6, skill: false };
  }
  const ang = gauss(rand) * ai.aimNoise;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  return {
    ...best,
    dx: best.dx * cs - best.dy * sn, dy: best.dx * sn + best.dy * cs,
    power: Math.max(0.1, Math.min(1, best.power * (1 + gauss(rand) * ai.powerNoise))),
  };
}

// 画面へ送るメッセージの最後が、いまの状態（だれの番か）と合うようにする。
// 何もしなかった置物（のり・画びょう・遠くの消しゴムなど）の番は、メッセージを出さずに進むので、
// 最後のメッセージの状態が「敵の番」のままになり、画面で自分の番が来ないことがあった
export function syncMessages(core, messages) {
  const last = [...messages].reverse().find((m) => m.state);
  const s = core.s, g = s.game;
  const lg = last?.state?.game;
  if (!last || last.state.phase !== s.phase || lg?.id !== g?.id || lg?.turn !== g?.turn || !!lg?.extra !== !!g?.extra) {
    messages.push({ t: 'state', state: core.snapshot() });
  }
  return messages;
}

// 自分の番になるまで（または盤面クリア・失敗まで）敵を動かす。戻り値はメッセージの配列
export function runEnemies(core, now = Date.now(), rand = Math.random) {
  const out = [];
  for (let guard = 0; guard < 24; guard++) {
    const s = core.s, g = s.game;
    if (s.phase !== 'aim') break;
    if (g.boardClear) { out.push(core.nextBoard()); continue; }
    if (g.turn === 0) break;
    out.push(...core.enemyTurn(now, rand));
  }
  return out;
}
