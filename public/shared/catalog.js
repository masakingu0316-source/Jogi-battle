// アイテムの一覧（サーバーと画面で共有）
// kind: ruler 定規 / pattern 柄 / sticker シール / acc アクセサリ（性能に効く）
import Physics from './physics.js';
import { SKILLS, RULER_SKILL, skillFor } from './rules.js';

export const RARITIES = {
  N: { name: 'ノーマル', weight: 60, refund: 2, color: '#c9d3cd' },
  R: { name: 'レア', weight: 28, refund: 5, color: '#76c6ff' },
  SR: { name: 'Sレア', weight: 10, refund: 15, color: '#d69cff' },
  SSR: { name: 'SSレア', weight: 2, refund: 40, color: '#f4d35e' },
  // ガチャには出ない（ステージの報酬）
  stage: { name: 'ステージ報酬', weight: 0, refund: 0, color: '#8fe0d2' },
};

// 通貨は「えんぴつ」（本）
export const ECONOMY = {
  currency: 'えんぴつ',
  unit: '本',
  pull1: 10,          // 1回
  pull10: 100,        // 10回（Rレア以上が1つ確定）
  welcome: 100,       // はじめてログインしたとき
  daily: 30,          // その日はじめてログインしたとき（日本時間で日付が変わると再び）
  play: 3,            // 対戦に参加（決着まで）
  win: 7,             // 勝ち（参加ぶんに上乗せ）
  dailyBattleCap: 150, // 対戦で1日にもらえる上限
  expPlay: 10,        // 定規の経験値：対戦に使った
  expWin: 10,         // 勝ったときの上乗せ
  expKo: 5,           // 相手を1本落とすごと
};

// ---- 定規のレベル ----
// 対戦・ステージで使うと経験値がたまる。1つ上がるごとに、重さとはじく力が0.4%ずつ上がる（Lv.10で+3.6%）
// 対人の対戦では Lv.10 まで、ステージでは Lv.50 まで効く（経験値は共通。対人で Lv.10 を超えた分もたまっていく）
export const LEVEL_MAX = 10;
export const STAGE_LEVEL_MAX = 50;
export const LEVEL_STEP = 0.004;
export const expToNext = (level) => 30 + 20 * (level - 1);
export function levelInfo(exp, cap = LEVEL_MAX) {
  const total = Math.max(0, Math.floor(Number(exp) || 0));
  let level = 1, into = total;
  while (level < cap && into >= expToNext(level)) { into -= expToNext(level); level++; }
  const max = level >= cap;
  return { level, exp: total, into: max ? 0 : into, need: max ? 0 : expToNext(level), max };
}
export const levelBonus = (level, cap = LEVEL_MAX) => Math.max(0, Math.min(cap, level | 0) - 1) * LEVEL_STEP;

// stat: mass 重さ / mu 机とのすべりにくさ / power はじく力（エネルギー）
export const STATS = {
  mass: { name: '重さ', up: '重くなり、押されにくい', down: '軽くなる' },
  mu: { name: 'すべりにくさ', up: 'すべりにくく、止まりやすい', down: 'よくすべる' },
  power: { name: 'はじく力', up: 'はじく力が強くなる', down: 'はじく力が弱くなる' },
};

// ---- 定規：形 × 素材（属性） ----
// まっすぐの30cm定規（3つの素材）は全員が持っている。ほかはガチャで出る
const SHAPE_INFO = {
  straight30: { rarity: 'basic', desc: '長くて当てやすい。押し合いに強い定番' },
  straight15: { rarity: 'R', desc: '短くて軽い。遠くまですべる' },
  tri45: { rarity: 'SR', desc: '直角二等辺の三角定規。角で当てると相手が回る' },
  tri60: { rarity: 'SR', desc: '30°・60°の三角定規。長い辺で受け止める' },
  protractor: { rarity: 'SSR', desc: '半円の分度器。丸い背で当たりを受け流す' },
};
export const MATERIAL_INFO = {
  acrylic: { name: 'アクリル', desc: 'よくすべり、よく跳ね返る', color: '#2f9fd8', aura: '#7fd8ff' },
  metal: { name: 'メタル', desc: '重くて、押されにくい', color: '#b8892a', aura: '#ffd36b' },
  rubber: { name: 'ラバー', desc: 'すぐ止まり、跳ね返らない', color: '#d0457f', aura: '#ff7ab6' },
};
export const MAT_ORDER = ['acrylic', 'metal', 'rubber'];
// 三すくみ：strong は当てたとき少し強く弾ける相手、weak はその逆
export function matInfo(mat) {
  const weak = Object.keys(Physics.BEATS).find((k) => Physics.BEATS[k] === mat);
  return { ...MATERIAL_INFO[mat], strong: Physics.BEATS[mat], weak };
}

const rulerItems = [];
for (const [shape, info] of Object.entries(SHAPE_INFO)) {
  for (const mat of MAT_ORDER) {
    const key = `${shape}-${mat}`;
    const spec = Physics.RULERS[key];
    rulerItems.push({ id: 'ruler:' + key, kind: 'ruler', rarity: info.rarity, name: spec.name, specKey: key, shape, mat, desc: `${info.desc}。${MATERIAL_INFO[mat].desc}` });
  }
}

// ステージの報酬でだけ手に入る定規
rulerItems.push({
  id: 'ruler:folding-acrylic', kind: 'ruler', rarity: 'stage', name: Physics.RULERS['folding-acrylic'].name, specKey: 'folding-acrylic', shape: 'folding', mat: 'acrylic',
  desc: `ステージ「可変定規編」をすべてクリアするともらえる50cmの折りたたみ定規。体力が減るほど伸びて長くなる。${MATERIAL_INFO.acrylic.desc}`,
});

const items = [
  ...rulerItems,

  // 柄（見た目だけ）
  { id: 'pattern:stripe', kind: 'pattern', rarity: 'N', name: 'ストライプ' },
  { id: 'pattern:dots', kind: 'pattern', rarity: 'N', name: '水玉' },
  { id: 'pattern:check', kind: 'pattern', rarity: 'R', name: 'チェック' },
  { id: 'pattern:wave', kind: 'pattern', rarity: 'R', name: 'なみなみ' },
  { id: 'pattern:stars', kind: 'pattern', rarity: 'SR', name: '星空' },
  { id: 'pattern:rainbow', kind: 'pattern', rarity: 'SSR', name: 'にじ' },

  // シール（見た目だけ）
  { id: 'sticker:star', kind: 'sticker', rarity: 'N', name: '星のシール' },
  { id: 'sticker:heart', kind: 'sticker', rarity: 'N', name: 'ハートのシール' },
  { id: 'sticker:bolt', kind: 'sticker', rarity: 'R', name: 'いなずまシール' },
  { id: 'sticker:note', kind: 'sticker', rarity: 'R', name: '音符シール' },
  { id: 'sticker:crown', kind: 'sticker', rarity: 'SR', name: '王冠シール' },
  { id: 'sticker:hanamaru', kind: 'sticker', rarity: 'SSR', name: 'はなまるスタンプ' },

  // アクセサリ（性能に効く。1本の定規に1つまで、効果は最大5%）
  { id: 'acc:eraser', kind: 'acc', rarity: 'N', name: '消しゴムのかけら', stat: 'mass', pct: 2 },
  { id: 'acc:fingercot', kind: 'acc', rarity: 'N', name: '指サック', stat: 'power', pct: 2 },
  { id: 'acc:griptape', kind: 'acc', rarity: 'R', name: 'すべり止めテープ', stat: 'mu', pct: 3 },
  { id: 'acc:wax', kind: 'acc', rarity: 'R', name: 'ろうそくワックス', stat: 'mu', pct: -3 },
  { id: 'acc:clip', kind: 'acc', rarity: 'SR', name: '目玉クリップ', stat: 'mass', pct: 4 },
  { id: 'acc:pencilcap', kind: 'acc', rarity: 'SR', name: 'えんぴつキャップ', stat: 'power', pct: 4 },
  { id: 'acc:goldclip', kind: 'acc', rarity: 'SSR', name: '金のクリップ', stat: 'mass', pct: 5 },
  { id: 'acc:goldcot', kind: 'acc', rarity: 'SSR', name: '金の指サック', stat: 'power', pct: 5 },
];

export const ITEMS = Object.fromEntries(items.map((it) => [it.id, it]));
export const GACHA_POOL = items.filter((it) => it.rarity !== 'basic' && it.rarity !== 'stage');
export const BASIC_RULERS = items.filter((it) => it.kind === 'ruler' && it.rarity === 'basic').map((it) => it.id);
export const DEFAULT_RULER = 'ruler:straight30-acrylic';

// ---- ゲームの設定 ----
// コードに書いた値が初期値。管理者が設定画面で変えた値はデータベースに保存され、こちらより優先される。
export const ORDER = ['N', 'R', 'SR', 'SSR'];
export const ECONOMY_KEYS = {
  pull1: { name: 'ガチャ1回の値段', min: 1, max: 10000 },
  pull10: { name: 'ガチャ10回の値段', min: 1, max: 100000 },
  welcome: { name: 'はじめてのログイン', min: 0, max: 100000 },
  daily: { name: '毎日のログインボーナス', min: 0, max: 10000 },
  play: { name: '対戦に参加', min: 0, max: 1000 },
  win: { name: '勝ったときの上乗せ', min: 0, max: 1000 },
  dailyBattleCap: { name: '対戦で1日にもらえる上限', min: 0, max: 100000 },
  expPlay: { name: '定規の経験値：対戦に使った', min: 0, max: 1000, unit: '点' },
  expWin: { name: '定規の経験値：勝ったときの上乗せ', min: 0, max: 1000, unit: '点' },
  expKo: { name: '定規の経験値：1本落とすごと', min: 0, max: 1000, unit: '点' },
};

export function defaultConfig() {
  return {
    economy: Object.fromEntries(Object.keys(ECONOMY_KEYS).map((k) => [k, ECONOMY[k]])),
    rarities: Object.fromEntries(ORDER.map((k) => [k, { weight: RARITIES[k].weight, refund: RARITIES[k].refund }])),
    acc: Object.fromEntries(items.filter((it) => it.kind === 'acc').map((it) => [it.id, it.pct])),
    disabled: [],
    skills: {}, // 必殺技の割り当てを変えた定規だけ { specKey: skillKey }
    rulers: {}, // 性能を変えた定規だけ { specKey: { mass, mu, e, power } }
  };
}

// 設定画面で変えられる定規の性能
export const RULER_TUNE_KEYS = {
  mass: { name: '重さ', unit: 'g', min: 5, max: 80, step: 0.5, desc: '重いほど押されにくく、押す力も強い' },
  mu: { name: 'すべりにくさ', unit: '', min: 0.1, max: 1.2, step: 0.01, desc: '大きいほどすぐ止まる' },
  e: { name: '跳ね返り', unit: '', min: 0, max: 0.9, step: 0.01, desc: '大きいほど、ぶつかったときによく跳ねる' },
  power: { name: 'はじく力', unit: '%', min: 50, max: 150, step: 1, desc: '100%がふつう' },
};
export const rulerTuneDefault = (specKey) => {
  const s = Physics.RULERS[specKey];
  return { mass: s.mass, mu: s.mu, e: s.e, power: 100 };
};
// 定規の性能（設定で変えた値を含む）
export const rulerTune = (specKey, cfg) => ({ ...rulerTuneDefault(specKey), ...(cfg?.rulers?.[specKey] || {}) });

// 設定画面やデータベースから来た値を、決まった範囲に収めて、足りない項目は初期値で埋める
export function sanitizeConfig(input) {
  const base = defaultConfig();
  const src = input && typeof input === 'object' ? input : {};
  const num = (v, min, max, fallback, step = 1) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n / step) * step));
  };
  const economy = {};
  for (const [k, r] of Object.entries(ECONOMY_KEYS)) economy[k] = num(src.economy?.[k], r.min, r.max, base.economy[k]);
  const rarities = {};
  for (const k of ORDER) {
    rarities[k] = {
      weight: num(src.rarities?.[k]?.weight, 0, 10000, base.rarities[k].weight, 0.1),
      refund: num(src.rarities?.[k]?.refund, 0, 100000, base.rarities[k].refund),
    };
  }
  const limit = Physics.MOD_LIMIT * 100;
  const acc = {};
  for (const id of Object.keys(base.acc)) acc[id] = num(src.acc?.[id], -limit, limit, base.acc[id], 0.5);
  const disabled = Array.isArray(src.disabled) ? [...new Set(src.disabled.filter((id) => GACHA_POOL.some((it) => it.id === id)))] : [];
  const skills = {};
  for (const [k, v] of Object.entries(src.skills && typeof src.skills === 'object' ? src.skills : {})) {
    if (RULER_SKILL[k] && SKILLS[v] && v !== RULER_SKILL[k]) skills[k] = v;
  }
  const rulers = {};
  for (const [k, v] of Object.entries(src.rulers && typeof src.rulers === 'object' ? src.rulers : {})) {
    if (!Physics.RULERS[k] || !v || typeof v !== 'object') continue;
    const d = rulerTuneDefault(k), out = {};
    for (const [key, r] of Object.entries(RULER_TUNE_KEYS)) {
      const n = Number(v[key]);
      if (!Number.isFinite(n)) continue;
      const c = Math.round(Math.max(r.min, Math.min(r.max, n)) / r.step) * r.step;
      const val = Math.round(c * 1000) / 1000;
      if (Math.abs(val - d[key]) > 1e-9) out[key] = val;
    }
    if (Object.keys(out).length) rulers[k] = out;
  }
  return { economy, rarities, acc, disabled, skills, rulers };
}

// 設定として成り立っているか（保存の前に確かめる）。問題があれば理由を返す
export function configProblem(cfg) {
  if (!activeRarities(cfg).length) return 'ガチャで出るものがありません。確率が0より大きいレア度に、出すアイテムを1つ以上残してください';
  return null;
}

const poolOf = (cfg, rarity) => GACHA_POOL.filter((it) => it.rarity === rarity && !cfg.disabled.includes(it.id));
// 出せるアイテムがあり、確率が0より大きいレア度だけ
const activeRarities = (cfg, from = 'N') =>
  ORDER.slice(ORDER.indexOf(from)).filter((k) => cfg.rarities[k].weight > 0 && poolOf(cfg, k).length);

// レア度ごとの確率（表示用、合計100%）と、各アイテムの確率
export function odds(cfg = defaultConfig()) {
  const act = activeRarities(cfg);
  const total = act.reduce((a, k) => a + cfg.rarities[k].weight, 0) || 1;
  return ORDER.map((key) => {
    const pool = poolOf(cfg, key);
    const p = act.includes(key) ? (cfg.rarities[key].weight / total) * 100 : 0;
    return { rarity: key, name: RARITIES[key].name, percent: p, each: pool.length ? p / pool.length : 0, items: pool.map((it) => it.id) };
  });
}

// 1回引く。rand は 0以上1未満を返す関数。minRarity を指定すると、それ以上のレア度の比率で選び直す（確定枠）
export function rollOnce(rand, minRarity, cfg = defaultConfig()) {
  const pick = (keys) => {
    const total = keys.reduce((a, k) => a + cfg.rarities[k].weight, 0);
    let x = rand() * total;
    for (const k of keys) { x -= cfg.rarities[k].weight; if (x < 0) return k; }
    return keys[keys.length - 1];
  };
  let rarity = pick(activeRarities(cfg));
  if (minRarity && ORDER.indexOf(rarity) < ORDER.indexOf(minRarity)) {
    const upper = activeRarities(cfg, minRarity);
    if (upper.length) rarity = pick(upper);
  }
  const pool = poolOf(cfg, rarity);
  return pool[Math.floor(rand() * pool.length)];
}

export const accPct = (id, cfg = defaultConfig()) => cfg.acc?.[id] ?? ITEMS[id]?.pct ?? 0;

// 定規1本ぶんの装備から、対戦で使う情報を作る（所持の確認は呼ぶ側で行う）。level は定規のレベル、cap はレベルの上限（ステージは50）
export function resolveLoadout(setup, cfg = defaultConfig(), level = 1, cap = LEVEL_MAX) {
  const ruler = ITEMS[setup?.ruler] && ITEMS[setup.ruler].kind === 'ruler' ? ITEMS[setup.ruler] : ITEMS[DEFAULT_RULER];
  const pattern = ITEMS[setup?.pattern]?.kind === 'pattern' ? setup.pattern : null;
  const sticker = ITEMS[setup?.sticker]?.kind === 'sticker' ? setup.sticker : null;
  const acc = ITEMS[setup?.acc]?.kind === 'acc' ? setup.acc : null;
  const lv = Math.max(1, Math.min(cap, Math.floor(Number(level) || 1)));
  const mods = { mass: 1, mu: 1, power: 1 };
  if (acc) {
    const a = ITEMS[acc];
    mods[a.stat] = 1 + Math.max(-Physics.MOD_LIMIT, Math.min(Physics.MOD_LIMIT, accPct(acc, cfg) / 100));
  }
  const bonus = levelBonus(lv, cap);
  mods.mass *= 1 + bonus;
  mods.power *= 1 + bonus;
  for (const k of Object.keys(mods)) mods[k] = Math.round(mods[k] * 10000) / 10000;
  return { ruler: ruler.id, specKey: ruler.specKey, pattern, sticker, acc, level: lv, mods, skill: skillFor(ruler.specKey, cfg.skills), tune: cfg.rulers?.[ruler.specKey] || null };
}

export function accText(id, cfg = defaultConfig()) {
  const a = ITEMS[id];
  if (!a || a.kind !== 'acc') return '';
  const pct = accPct(id, cfg);
  return `${STATS[a.stat].name} ${pct > 0 ? '+' : ''}${pct}%`;
}
