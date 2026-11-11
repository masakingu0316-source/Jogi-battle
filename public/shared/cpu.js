// コンピュータの打ち方。部屋の状態をまるごと写して、いくつものはじき方を実際に計算してみて、いちばん良いものを選ぶ。
// 強さは「試す数」と「手元のぶれ」で変える。サーバーと同じ計算（core.js）を使うので、ずるはしない。
import Physics from './physics.js';
import { RoomCore } from './core.js';
import { DESKS, MODES, teamOf, deskTiles, onTile, GAUGE, SKILLS } from './rules.js';

export const CPU_LEVELS = {
  easy: { name: 'やさしい', samples: 8, aimNoise: 0.22, powerNoise: 0.3, skillRate: 0.3, level: 1 },
  normal: { name: 'ふつう', samples: 32, aimNoise: 0.07, powerNoise: 0.12, skillRate: 0.8, level: 3 },
  hard: { name: 'つよい', samples: 90, aimNoise: 0.015, powerNoise: 0.04, skillRate: 1, level: 6 },
};

// 正規分布っぽい乱数（-1〜1あたりに集まる）
const gauss = (rand) => (rand() + rand() + rand() - 1.5) / 0.75;

// 机の端までの近さ（4方向に進んで、残っている机から出るまでの距離のいちばん短いもの）
function margin(tiles, x, y) {
  let best = 20;
  for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let d = 0;
    while (d < best && tiles.some((t) => onTile(t, x + ux * d, y + uy * d))) d += 1;
    best = Math.min(best, d);
  }
  return best;
}

// はじいたあとの局面の良さ（コンピュータから見て）
function evaluate(before, after, me, mode) {
  const g0 = before.game, g = after.game;
  const teams = MODES[mode].teams;
  const isEnemy = (i) => i !== me && (!teams || teamOf(i) !== teamOf(me));
  let score = 0;
  if (g.result) {
    score += g.result.winners.includes(me) ? 1000 : -1000;
  }
  const desk = DESKS[MODES[mode].desk];
  const all = deskTiles(desk);
  // 次に消える机は、もう無いものとして考える
  const left = (g.desks || all.map((t) => t.i)).filter((i) => i !== g.vanish);
  const tiles = all.filter((t) => left.includes(t.i));
  g.players.forEach((p, i) => {
    const wasAlive = g0.players[i].alive;
    if (!wasAlive) return;
    const b = g.bodies[i];
    const m = p.alive && b.state === 'desk' ? margin(tiles, b.x, b.y) : -1;
    // 体力：相手を削るほど良く、自分や味方が削られるほど悪い
    const lost = (g0.bodies[i].hp ?? 100) - (b.hp ?? 100);
    score += i === me ? -lost * 0.6 : isEnemy(i) ? lost * 1.2 : -lost * 0.8;
    if (i === me) {
      if (!p.alive) score -= 300;
      else score += Math.min(m, 12) * 4 - (m <= 0 ? 150 : 0);
    } else if (isEnemy(i)) {
      if (!p.alive) score += 160;
      else score += (12 - Math.min(m, 12)) * 3 + (m <= 0 ? 60 : 0);
    } else {
      // 味方
      if (!p.alive) score -= 150;
      else score += Math.min(m, 12) * 1.5;
    }
  });
  return score;
}

// 候補のはじき方を1つ作る
function candidate(core, me, rand, useSkill) {
  const g = core.s.game;
  const teams = MODES[core.s.mode].teams;
  const mine = g.bodies[me];
  const spec = Physics.RULERS[mine.specKey] || Physics.RULERS['straight30-acrylic'];
  const foes = g.bodies.map((b, i) => ({ b, i })).filter(({ b, i }) => i !== me && g.players[i].alive && b.state === 'desk' && (!teams || teamOf(i) !== teamOf(me)));
  let tx, ty;
  if (foes.length && rand() < 0.88) {
    // 近い相手ほど狙いやすい
    const w = foes.map(({ b }) => 1 / (10 + Math.hypot(b.x - mine.x, b.y - mine.y)));
    let r = rand() * w.reduce((a, c) => a + c, 0), pick = foes[0];
    for (let k = 0; k < foes.length; k++) { r -= w[k]; if (r <= 0) { pick = foes[k]; break; } }
    const t = pick.b, tspec = Physics.RULERS[t.specKey] || spec;
    const half = Physics.SHAPES[tspec.shape].radius * 0.6;
    const along = (rand() - 0.5) * 2 * half;
    tx = t.x + Math.cos(t.a) * along; ty = t.y + Math.sin(t.a) * along;
  } else {
    // 机の真ん中のほうへ戻る（守り）
    tx = (rand() - 0.5) * 10; ty = (rand() - 0.5) * 10;
  }
  const len = Math.hypot(tx - mine.x, ty - mine.y) || 1;
  const dx = (tx - mine.x) / len, dy = (ty - mine.y) / len;
  // はじく点：定規の真ん中あたりを、少しずらして押さえる
  const shapeKey = Physics.shapeOf(mine.specKey, mine.hp, mine.maxHp);
  const off = (rand() - 0.5) * Physics.SHAPES[shapeKey].radius * 0.8;
  const near = Physics.nearestOnShape(shapeKey, off, (rand() - 0.5) * 1.5);
  // 百八十度：曲がる角度も試す
  const curve = useSkill && core.skillOf(me) === 'hyaku' ? Math.round((rand() - 0.5) * 2 * (mine.st?.hyakuMax ?? 90)) : undefined;
  return { lx: near.x, ly: near.y, dx, dy, power: 0.25 + rand() * 0.75, skill: useSkill, curve };
}

// 盤面を写して1回はじいてみる
function trial(core, input) {
  const sim = new RoomCore(core.s.code, core.s.mode);
  sim.s = structuredClone(core.s);
  sim.rand = () => 0.99; // クリティカルは当てにしない
  const before = structuredClone(core.s);
  const me = sim.s.game.turn;
  const r = sim.shoot(input, Date.now());
  if (r.error) return -Infinity;
  return evaluate(before, sim.s, me, core.s.mode);
}

// その場で使う必殺技（保健室・ワープなど）を、いま使うか
export function decideNow(core, levelKey = 'normal', rand = Math.random) {
  const lv = CPU_LEVELS[levelKey] || CPU_LEVELS.normal;
  const g = core.s.game, me = g.turn;
  if (g.extra || (g.gauge?.[me] ?? 0) < GAUGE.max) return false;
  const k = core.skillOf(me);
  if (SKILLS[k].mode !== 'now') return false;
  const b = g.bodies[me];
  const tiles = deskTiles(DESKS[MODES[core.s.mode].desk]).filter((t) => !g.desks || g.desks.includes(t.i));
  const m = margin(tiles, b.x, b.y);
  if (k === 'heal') return (b.hp ?? 100) < 65;
  // 吹雪：相手の定規のそばにクリスタルを置く（戻り値は置く場所）
  if (k === 'blizzard') {
    if (rand() >= lv.skillRate) return false;
    for (const [j, o] of g.bodies.entries()) {
      if (j === me || o.state !== 'desk' || !g.players[j].alive) continue;
      for (let t = 0; t < 12; t++) {
        const ang = rand() * Math.PI * 2, d = 4 + rand() * 6;
        const at = { x: Math.round((o.x + Math.cos(ang) * d) * 10) / 10, y: Math.round((o.y + Math.sin(ang) * d) * 10) / 10 };
        if (!core.crystalSpotProblem(at.x, at.y)) return at;
      }
    }
    return false;
  }
  if (k === 'warp') return m < 14;
  if (k === 'chair') return m < 12;
  return rand() < lv.skillRate;
}

// 次のはじき方を決める。重い計算なので、少しずつ区切って画面を止めない
export async function planShot(core, levelKey = 'normal', rand = Math.random) {
  const lv = CPU_LEVELS[levelKey] || CPU_LEVELS.normal;
  const g = core.s.game;
  const me = g.turn;
  // 構えてはじく必殺技だけ、ここで使うかを考える（その場で使う技は decideNow）
  const canSkill = !g.extra && (g.gauge?.[me] ?? 0) >= GAUGE.max && SKILLS[core.skillOf(me)].mode === 'shot';
  const useSkill = canSkill && rand() < lv.skillRate;
  let best = null, bestScore = -Infinity;
  for (let k = 0; k < lv.samples; k++) {
    // つよいは、必殺技を使う／使わないの両方を比べる
    const skill = canSkill && levelKey === 'hard' ? k % 2 === 0 : useSkill;
    const c = candidate(core, me, rand, skill);
    const score = trial(core, c) + rand() * 2;
    if (score > bestScore) { bestScore = score; best = c; }
    if (k % 6 === 5) await new Promise((r) => setTimeout(r, 0));
  }
  if (!best) best = candidate(core, me, rand, false);
  // 手元のぶれ
  const ang = gauss(rand) * lv.aimNoise;
  const c = Math.cos(ang), s = Math.sin(ang);
  return {
    ...best,
    dx: best.dx * c - best.dy * s, dy: best.dx * s + best.dy * c,
    power: Math.max(0.1, Math.min(1, best.power * (1 + gauss(rand) * lv.powerNoise))),
  };
}
