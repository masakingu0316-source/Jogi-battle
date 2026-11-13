// バトル道場の1試合（サーバーで動かす）。部屋の進行（RoomCore）の1対1を土台に、
// 「自分 対 クラスメイト（コンピュータ）」を対人戦と同じルール（体力・必殺技・クリティカル・三すくみ・特性・場のイベント）で回す。
// 決着すると phase が 'over' になり、record に結果が入る（サーバーが道場の記録と報酬に使う）。
import Physics from './physics.js';
import { RoomCore } from './core.js';
import { deskTiles, onTile, GAUGE, SKILLS } from './rules.js';
import { STYLES, RANKS, TEACHER_NO, DOJO_SIZE } from './dojo.js';

export const ME = 'P', CPU = 'C';

export class DojoCore extends RoomCore {
  // player：{ name, userId, loadout, avatar, title }
  // mate：クラスメイト（設定の classmates の1人）、cpuLoadout：その子の定規
  constructor(player, mate, cpuLoadout, now = Date.now()) {
    super('DOJO', 'standard', now);
    const s = this.s;
    s.dojo = {
      no: mate.no, id: mate.id, name: mate.name, role: mate.role, rank: mate.rank || '', teacher: !!mate.teacher,
      lines: { enter: mate.lines?.enter || '', win: mate.lines?.win || '', lose: mate.lines?.lose || '' },
      // コンピュータの打ち方（試合のあいだは変えない）
      cpu: { style: mate.style, skillUse: mate.skillUse, aim: mate.aim, powerErr: mate.powerErr, samples: mate.samples },
      noSkill: mate.skill === 'none',
      result: null, startedAt: now,
    };
    s.members = [
      { id: ME, token: '', userId: player.userId || null, name: player.name || 'あなた', loadout: player.loadout, avatar: player.avatar || null, title: player.title || null, ready: true, connected: true },
      { id: CPU, token: '', userId: null, name: mate.name, loadout: cpuLoadout, avatar: mate.avatar || null, ready: true, connected: true, cpu: true },
    ];
    s.hostId = ME;
    this.startGame(now);
    // 必殺技を使わない子は、技なし（ゲージはたまるが使わない）
    if (s.dojo.noSkill) s.game.bodies[1].skill = 'none';
    // くせ「ゲージをためる」：必殺ゲージがたまりやすい
    const mul = STYLES[mate.style]?.chargeMul;
    if (mul) { const b = s.game.bodies[1]; b.charge = Math.round((b.charge ?? 25) * mul * 10) / 10; }
  }

  static restore(saved) {
    const r = Object.create(DojoCore.prototype);
    r.s = saved;
    r.rand = Math.random;
    r.record = null;
    return r;
  }

  skillOf(i) {
    const b = this.s.game?.bodies?.[i];
    if (b?.skill === 'none') return null;
    return super.skillOf(i);
  }

  // 決着したら、部屋に戻らずに「試合終わり」にする
  finishTurn(shooter, now = Date.now(), opt = {}) {
    const r = super.finishTurn(shooter, now, opt);
    const s = this.s, g = s.game;
    if (g.result && s.phase !== 'aim') {
      s.phase = 'over';
      s.startAt = null;
      const won = g.result.winners.includes(0);
      s.dojo.result = { won };
      g.result.title = won ? '勝ち！' : '負け…';
      this.record = { won, no: s.dojo.no, ruler: g.bodies[0].ruler, kos: g.kos[0], shots: g.shots };
    }
    return r;
  }

  snapshot(now = Date.now()) {
    const o = super.snapshot(now);
    const d = this.s.dojo;
    o.dojo = {
      no: d.no, id: d.id, name: d.name, role: d.role, rank: d.rank, rankName: RANKS[d.rank]?.name || '', teacher: d.teacher,
      lines: d.lines, result: d.result, total: DOJO_SIZE,
    };
    o.startIn = null;
    return o;
  }
}

// ---------------- クラスメイトの打ち方 ----------------
const tri = (rand) => rand() + rand() - 1; // -1〜1（真ん中ほど出やすい）

// 机の端までの近さ（4方向に進んで、残っている机から出るまでの距離のいちばん短いもの）
function margin(tiles, x, y, cap = 20) {
  let best = cap;
  for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let d = 0;
    while (d < best && tiles.some((t) => onTile(t, x + ux * d, y + uy * d))) d += 1;
    best = Math.min(best, d);
  }
  return best;
}
function tilesOf(core) {
  const g = core.s.game;
  return deskTiles(core.deskDef()).filter((t) => !g.desks || g.desks.includes(t.i));
}

// いまの局面で効く「くせ」（体力や位置で変わるもの）
function styleNow(core, me, cpu) {
  const base = { ...(STYLES[cpu.style] || STYLES.normal) };
  const g = core.s.game, b = g.bodies[me], f = g.bodies[1 - me];
  const hpPct = ((b.hp ?? 100) / (b.maxHp || 100)) * 100;
  if (base.retreat && hpPct < 50) Object.assign(base, { wSelf: 2.6, wCenter: 2.5, power: [0.2, 0.6], home: 0.6 });
  if (base.escape && margin(tilesOf(core), b.x, b.y) < 10) Object.assign(base, { wSelf: 2.4, wCenter: 3, home: 0.7 });
  if (base.wait) {
    const far = f.state === 'desk' && Math.hypot(f.x - b.x, f.y - b.y) > 18;
    Object.assign(base, far ? { power: [0.12, 0.42], wSelf: 2 } : { power: [0.6, 1], wFoe: 1.6 });
  }
  return base;
}

// はじいたあとの局面の良さ（me から見て）
function evaluate(before, after, me, st, tiles) {
  const g0 = before.game, g = after.game, foe = 1 - me;
  let score = 0;
  if (g.result) score += g.result.winners.includes(me) ? 1000 : -1000;
  const b = g.bodies[me], f = g.bodies[foe];
  const lostMe = (g0.bodies[me].hp ?? 100) - (b.hp ?? 100);
  const lostFoe = (g0.bodies[foe].hp ?? 100) - (f.hp ?? 100);
  score += lostFoe * 1.2 * (st.wHit ?? 1) - lostMe * 0.6;
  const meUp = g.players[me].alive && b.state === 'desk';
  if (!meUp) score -= 300;
  else {
    const m = margin(tiles, b.x, b.y);
    score += Math.min(m, 12) * 4 * (st.wSelf ?? 1) - (m <= 0 ? 150 : 0);
    if (st.wCenter) score -= Math.hypot(b.x, b.y) * 0.5 * st.wCenter;
  }
  const foeUp = g.players[foe].alive && f.state === 'desk';
  if (!foeUp) score += 160;
  else {
    const m = margin(tiles, f.x, f.y);
    score += (12 - Math.min(m, 12)) * 3 * (st.wFoe ?? 1) + (m <= 0 ? 60 : 0);
    if (st.wFar && meUp) score += Math.min(Math.hypot(b.x - f.x, b.y - f.y), 40) * 0.3 * st.wFar;
  }
  return score;
}

// 候補のはじき方を1つ作る
function candidate(core, me, rand, st, useSkill) {
  const g = core.s.game;
  const mine = g.bodies[me], foe = g.bodies[1 - me];
  let tx, ty;
  const home = st.home && rand() < st.home;
  if (foe.state === 'desk' && !home) {
    const fspec = Physics.RULERS[foe.specKey] || Physics.RULERS['straight30-acrylic'];
    const half = Physics.SHAPES[Physics.shapeOf(foe.specKey, foe.hp, foe.maxHp)]?.radius ?? Physics.SHAPES[fspec.shape].radius;
    let along;
    if (st.target === 'center') along = (rand() - 0.5) * half * 0.15;
    else if (st.target === 'near') {
      // 相手の定規の、自分にいちばん近いはし寄り
      const ax = Math.cos(foe.a), ay = Math.sin(foe.a);
      const side = Math.sign((mine.x - foe.x) * ax + (mine.y - foe.y) * ay) || 1;
      along = side * half * (0.25 + rand() * 0.35);
    } else along = (rand() - 0.5) * 2 * half * 0.6;
    tx = foe.x + Math.cos(foe.a) * along; ty = foe.y + Math.sin(foe.a) * along;
  } else {
    // 机の真ん中のほうへ（守り・逃げ）
    tx = (rand() - 0.5) * 10; ty = (rand() - 0.5) * 10;
  }
  let ang = Math.atan2(ty - mine.y, tx - mine.x);
  if (st.wide && rand() < 0.6) ang += (rand() - 0.5) * 2 * 1.0; // 跳ね返りも試す（±57°）
  const [lo, hi] = st.power || [0.25, 1];
  const shapeKey = Physics.shapeOf(mine.specKey, mine.hp, mine.maxHp);
  const sh = Physics.SHAPES[shapeKey];
  // はじく点：ふつうは真ん中あたり。角で狙う子は、はしのほうを押して角から当てる
  const offK = st.corner ? 1.0 : st.target === 'center' ? 0.2 : 0.8;
  const near = Physics.nearestOnShape(shapeKey, (rand() - 0.5) * sh.radius * offK, (rand() - 0.5) * (st.corner ? 3 : 1.5));
  const curve = useSkill && core.skillOf(me) === 'hyaku' ? Math.round((rand() - 0.5) * 2 * (mine.st?.hyakuMax ?? 90)) : undefined;
  return { lx: near.x, ly: near.y, dx: Math.cos(ang), dy: Math.sin(ang), power: lo + rand() * (hi - lo), skill: useSkill, curve };
}

function trial(core, input, me, st, tiles) {
  const sim = DojoCore.restore(structuredClone(core.s));
  sim.rand = () => 0.99; // クリティカル・場のイベントは当てにしない
  const before = core.s;
  const r = sim.shoot(input, Date.now());
  if (r.error) return -Infinity;
  return evaluate(before, sim.s, me, st, tiles);
}

// 次のはじき方を決める（cpu：{ style, skillUse, aim（±度）, powerErr（±%）, samples }）
export function planDojoShot(core, me, cpu, rand = Math.random) {
  const g = core.s.game;
  const st = styleNow(core, me, cpu);
  const sk = core.skillOf(me);
  const canSkill = !!sk && cpu.skillUse !== 'none' && !g.extra && (g.gauge?.[me] ?? 0) >= GAUGE.max && SKILLS[sk]?.mode === 'shot';
  const tiles = tilesOf(core);
  let best = null;
  if (st.plain) {
    // 考えずに、相手の真ん中へまっすぐ
    best = candidate(core, me, rand, st, canSkill && cpu.skillUse === 'asap');
  } else {
    let bestScore = -Infinity;
    const n = Math.max(1, Math.round(cpu.samples || 1));
    for (let k = 0; k < n; k++) {
      // タイミングを選ぶ子は、使う／使わないの両方を比べる。すぐ使う子は、たまったら使う
      const useSkill = canSkill && (cpu.skillUse === 'pick' ? k % 2 === 0 : true);
      const c = candidate(core, me, rand, st, useSkill);
      const score = trial(core, c, me, st, tiles) + rand() * 2;
      if (score > bestScore) { bestScore = score; best = c; }
    }
  }
  if (!best) best = candidate(core, me, rand, st, false);
  // 手元のぶれ：狙いの向き（±aim°）と力加減（±powerErr%）
  const ang = tri(rand) * ((cpu.aim || 0) * Math.PI / 180);
  const c = Math.cos(ang), s = Math.sin(ang);
  return {
    ...best,
    dx: best.dx * c - best.dy * s, dy: best.dx * s + best.dy * c,
    power: Math.max(0.08, Math.min(1, best.power * (1 + tri(rand) * (cpu.powerErr || 0) / 100))),
  };
}

// その場で使う必殺技を、いま使うか。false / true / { x, y }（吹雪のクリスタルを置く所）
export function decideDojoNow(core, me, cpu, rand = Math.random) {
  const g = core.s.game;
  if (cpu.skillUse === 'none' || g.extra || (g.gauge?.[me] ?? 0) < GAUGE.max) return false;
  const k = core.skillOf(me);
  if (!k || SKILLS[k]?.mode !== 'now') return false;
  const asap = cpu.skillUse === 'asap';
  const b = g.bodies[me], f = g.bodies[1 - me];
  const tiles = tilesOf(core);
  const m = margin(tiles, b.x, b.y);
  const hpPct = ((b.hp ?? 100) / (b.maxHp || 100)) * 100;
  switch (k) {
    case 'heal': return asap ? hpPct < 90 : hpPct < 60;
    case 'shizuka': return asap || (g.gauge?.[1 - me] ?? 0) >= 60;
    case 'warp': return asap ? m < 16 : m < 11;
    case 'chair': return asap || m < 12;
    case 'sub': return asap || hpPct < 60 || m < 10;
    case 'counter': return asap || (f.state === 'desk' && Math.hypot(f.x - b.x, f.y - b.y) < 22);
    case 'blizzard': {
      if (!asap && f.state === 'desk' && margin(tiles, f.x, f.y) > 14) return false;
      // 相手の定規のそばにクリスタルを置く
      if (f.state !== 'desk') return false;
      for (let t = 0; t < 16; t++) {
        const a = rand() * Math.PI * 2, d = 4 + rand() * 6;
        const at = { x: Math.round((f.x + Math.cos(a) * d) * 10) / 10, y: Math.round((f.y + Math.sin(a) * d) * 10) / 10 };
        if (!core.crystalSpotProblem(at.x, at.y)) return at;
      }
      return false;
    }
    default: return asap;
  }
}

// 自分の番になるまで（または決着まで）クラスメイトを動かす。戻り値は画面へ送るメッセージの配列
export function runCpu(core, now = Date.now(), rand = Math.random) {
  const out = [];
  for (let guard = 0; guard < 12; guard++) {
    const s = core.s, g = s.game;
    if (s.phase !== 'aim' || g.order[g.turn] !== CPU) break;
    const cpu = s.dojo.cpu;
    const me = g.turn;
    const use = decideDojoNow(core, me, cpu, rand);
    if (use) {
      const r = core.handle(CPU, { t: 'skill', ...(typeof use === 'object' ? use : {}) }, now);
      for (const o of r) if (o.msg.t !== 'error') out.push({ ...o.msg, act: true });
    }
    const shot = planDojoShot(core, me, cpu, rand);
    const r = core.handle(CPU, { t: 'flick', ...shot }, now);
    const msgs = r.map((o) => o.msg);
    if (msgs.some((m) => m.t === 'error')) {
      // 念のため：はじけなかったときは番を進める
      core.finishTurn(me, now, { skipped: true });
      out.push({ t: 'state', state: core.snapshot(now) });
      continue;
    }
    out.push(...msgs);
  }
  return out;
}

// 先生か、何番の子か（画面の見出し）
export const dojoLabel = (d) => (d.teacher || d.no === TEACHER_NO ? `担任 ${d.name}` : `${d.no}番 ${d.name}`);
