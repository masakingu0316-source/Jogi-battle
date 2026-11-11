// アイテムの一覧（サーバーと画面で共有）
// kind: ruler 定規 / pattern 柄 / sticker シール / acc アクセサリ（性能に効く）
import Physics from './physics.js';
import { SKILLS, RULER_SKILL, skillFor, SKILL_TUNE, SKILL_TUNE_KEYS, TRAITS } from './rules.js';

export const RARITIES = {
  N: { name: 'ノーマル', weight: 60, refund: 2, color: '#c9d3cd' },
  R: { name: 'レア', weight: 28, refund: 5, color: '#76c6ff' },
  SR: { name: 'Sレア', weight: 10, refund: 15, color: '#d69cff' },
  SSR: { name: 'SSレア', weight: 2, refund: 40, color: '#f4d35e' },
};
// レア度の並び（低い順）と、定規の見た目のテーマ
export const RULER_RARITY = {
  N: { name: 'ノーマル', theme: '学習定規', color: '#b9c2bd' },
  R: { name: 'レア', theme: '教室の持ち物', color: '#4ea8e8' },
  SR: { name: 'Sレア', theme: '製図用', color: '#b07ae8' },
  SSR: { name: 'SSレア', theme: '漆・蒔絵・金箔の工芸品', color: '#e2a92b' },
};
export const RARITY_ORDER = ['N', 'R', 'SR', 'SSR'];

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
// 形の説明
export const SHAPE_INFO = {
  straight30: { name: '30cm定規', desc: '長くて当てやすい。押し合いに強い定番' },
  straight15: { name: '15cm定規', desc: '短くて軽い。遠くまですべる' },
  tri45: { name: '三角定規（45°）', desc: '直角二等辺の三角定規。角で当てると相手が回る' },
  tri60: { name: '三角定規（30°・60°）', desc: '30°・60°の三角定規。長い辺で受け止める' },
  protractor: { name: '分度器', desc: '半円の分度器。丸い背で当たりを受け流す' },
  folding: { name: '折りたたみ定規', desc: '50cmの折りたたみ定規。体力が減るほど伸びて長くなる' },
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

// ---- 定規の銘柄 ----
// 1本ずつ名前と絵柄（art）を持つ。形×素材で重さ・すべり方が決まり、レア度で性能の上乗せ、SR以上は特性を持つ。
// gacha：定規ガチャに出るか。starter：はじめから全員が持っている。stage：ステージの報酬
// art：絵柄（ruler-paint.js で描く）。N は学習定規、R は教室の持ち物、SR は製図用、SSR は漆・蒔絵・金箔
const FORM_SHAPES = ['straight30', 'straight15', 'tri45', 'tri60', 'protractor'];
export const BRAND_SHAPES = [...FORM_SHAPES, 'folding'];
const DEFAULT_BRANDS = [];
for (const shape of FORM_SHAPES) {
  for (const mat of MAT_ORDER) {
    const key = `${shape}-${mat}`;
    DEFAULT_BRANDS.push({
      id: 'ruler:' + key, rarity: 'N', name: Physics.RULERS[key].name, shape, mat, art: 'plain', trait: null, skill: RULER_SKILL[key],
      gacha: true, starter: shape === 'straight30',
    });
  }
}
const B = (id, rarity, shape, mat, name, skill, art, trait = null, extra = {}) =>
  DEFAULT_BRANDS.push({ id: 'ruler:' + id, rarity, name, shape, mat, art, trait, skill, gacha: true, starter: false, ...extra });
// R（教室の持ち物）
B('r-name30', 'R', 'straight30', 'rubber', '名前シールの30cm', 'counter', 'namesticker');
B('r-pencase15', 'R', 'straight15', 'metal', '筆箱サイズの15cm', 'warp', 'pencase');
B('r-ink15', 'R', 'straight15', 'acrylic', 'インク汚れの15cm', 'ink', 'inkstain');
B('r-twotone45', 'R', 'tri45', 'metal', '2色目盛りの三角', 'sub', 'twotone');
B('r-chara60', 'R', 'tri60', 'rubber', 'キャラ柄の三角', 'chair', 'character');
B('r-color-prot', 'R', 'protractor', 'acrylic', 'カラー分度器', 'blizzard', 'colorful');
// SR（製図用）
B('sr-grid30', 'SR', 'straight30', 'acrylic', '方眼の製図尺', 'wind', 'grid', 'aim');
B('sr-steel15', 'SR', 'straight15', 'metal', 'ステンレス直尺', 'power', 'steel', 'edge');
B('sr-grip45', 'SR', 'tri45', 'rubber', 'すべり止めの製図三角', 'anchor', 'nonslip', 'grip');
B('sr-draft60', 'SR', 'tri60', 'acrylic', '目盛り付き製図三角', 'double', 'drafting', 'grid');
B('sr-full-prot', 'SR', 'protractor', 'metal', '全円分度器', 'magnet', 'fullcircle', 'center');
// SSR（工芸品）
B('ssr-makie30', 'SSR', 'straight30', 'metal', '金蒔絵の尺', 'ichimonji', 'makie', 'center');
B('ssr-karakawa15', 'SSR', 'straight15', 'rubber', '金唐革の短尺', 'gomu', 'karakawa', 'grip');
B('ssr-raden45', 'SSR', 'tri45', 'acrylic', '螺鈿の三角', 'niji', 'raden', 'aim');
B('ssr-urushi60', 'SSR', 'tri60', 'metal', '朱漆の三角', 'ikkaku', 'urushi', 'edge');
B('ssr-kinpaku-prot', 'SSR', 'protractor', 'acrylic', '金箔の分度器', 'hyaku', 'kinpaku', 'grid');
// ステージ「可変定規編」の報酬（ガチャには出ない）
DEFAULT_BRANDS.push({
  id: 'ruler:folding-acrylic', rarity: 'SSR', name: '折りたたみ定規（アクリル）', shape: 'folding', mat: 'acrylic', art: 'plain', trait: 'aim', skill: 'fullopen',
  gacha: false, starter: false, stage: true,
});
export const ARTS = {
  plain: { name: '学習定規', rarity: 'N' },
  namesticker: { name: '名前シール', rarity: 'R' }, pencase: { name: '筆箱サイズ', rarity: 'R' }, inkstain: { name: 'インク汚れ', rarity: 'R' },
  twotone: { name: '2色目盛り', rarity: 'R' }, character: { name: 'キャラ柄', rarity: 'R' }, colorful: { name: 'カラー', rarity: 'R' },
  grid: { name: '方眼', rarity: 'SR' }, steel: { name: 'ステンレス', rarity: 'SR' }, nonslip: { name: 'すべり止め', rarity: 'SR' },
  drafting: { name: '製図目盛り', rarity: 'SR' }, fullcircle: { name: '全円目盛り', rarity: 'SR' },
  makie: { name: '金蒔絵', rarity: 'SSR' }, karakawa: { name: '金唐革', rarity: 'SSR' }, raden: { name: '螺鈿', rarity: 'SSR' },
  urushi: { name: '朱漆', rarity: 'SSR' }, kinpaku: { name: '金箔', rarity: 'SSR' },
};
export const DEFAULT_BRAND_IDS = DEFAULT_BRANDS.map((b) => b.id);
export const defaultBrands = () => DEFAULT_BRANDS.map((b) => ({ ...b }));
const specKeyOf = (b) => (b.shape === 'folding' ? 'folding-acrylic' : `${b.shape}-${b.mat}`);
function brandItem(b) {
  const specKey = specKeyOf(b);
  const shape = SHAPE_INFO[b.shape];
  const how = b.stage ? 'ステージ「可変定規編」をすべてクリアするともらえる。' : '';
  return {
    id: b.id, kind: 'ruler', rarity: b.rarity, name: b.name, specKey, shape: b.shape, mat: b.mat, art: b.art || 'plain',
    trait: TRAITS[b.trait] ? b.trait : null, skill: SKILLS[b.skill] ? b.skill : RULER_SKILL[specKey] || 'power',
    gacha: !!b.gacha, starter: !!b.starter, stage: !!b.stage, custom: !!b.custom,
    desc: `${how}${shape?.desc || ''}。${MATERIAL_INFO[b.mat]?.desc || ''}`,
  };
}
const rulerItems = DEFAULT_BRANDS.map(brandItem);

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
// 飾りガチャ（柄・シール・アクセサリ）に出るもの。定規は定規ガチャから出る
export const GACHA_POOL = items.filter((it) => it.kind !== 'ruler');
export const BASIC_RULERS = items.filter((it) => it.kind === 'ruler' && it.starter).map((it) => it.id);
export const DEFAULT_RULER = 'ruler:straight30-acrylic';

// 設定画面で変えた銘柄（名前・レア度・絵柄・特性・必殺技・ガチャに出すか）と、追加した銘柄を一覧に反映する。
// サーバーでは設定を読むたび、画面では設定を受け取ったときに呼ぶ（同じ一覧を書きかえる）
export function applyConfig(cfg) {
  for (const it of Object.values(ITEMS)) if (it.kind === 'ruler' && it.custom) delete ITEMS[it.id];
  for (const b of DEFAULT_BRANDS) {
    const o = cfg?.brands?.[b.id] || {};
    // 前の版の「形×素材ごとの必殺技の割り当て」も効かせる
    const old = b.rarity === 'N' ? cfg?.skills?.[specKeyOf(b)] : null;
    ITEMS[b.id] = brandItem({ ...b, ...o, skill: o.skill || old || b.skill, id: b.id, shape: b.shape, mat: b.mat, starter: b.starter, stage: b.stage });
  }
  for (const [id, o] of Object.entries(cfg?.brands || {})) {
    if (ITEMS[id] || !o?.custom) continue;
    ITEMS[id] = brandItem({ ...o, id });
  }
  return ITEMS;
}
// 定規の一覧（並び：レア度の低い順 → 形 → 素材）
export function rulerList() {
  const sh = (s) => BRAND_SHAPES.indexOf(s), mt = (m) => MAT_ORDER.indexOf(m);
  return Object.values(ITEMS).filter((it) => it.kind === 'ruler')
    .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || sh(a.shape) - sh(b.shape) || mt(a.mat) - mt(b.mat) || a.id.localeCompare(b.id));
}
// 定規ガチャに出る定規（レア度ごと）
export function rulerPool(rarity) {
  return Object.values(ITEMS).filter((it) => it.kind === 'ruler' && it.gacha && it.rarity === rarity);
}

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
    skills: {}, // （前の版）必殺技の割り当てを変えた定規だけ { specKey: skillKey }
    rulers: {}, // 性能を変えた定規だけ { specKey: { mass, mu, e, power } }
    rarityBonus: { ...RARITY_BONUS },                  // レア度ごとの重さ・はじく力の上乗せ（％）
    traits: Object.fromEntries(Object.entries(TRAITS).map(([k, t]) => [k, t.pct])), // 特性の効き目（％）
    skillTune: Object.fromEntries(Object.keys(SKILL_TUNE_KEYS).map((k) => [k, SKILL_TUNE[k]])), // SSR の技の数値
    rulerGacha: structuredClone(RULER_GACHA),           // 定規ガチャ
    brands: {}, // 変えた銘柄と、追加した銘柄だけ { id: { name, rarity, art, trait, skill, gacha（追加は custom, shape, mat も） } }
  };
}

// ---- レア度の上乗せと、定規ガチャ ----
export const RARITY_BONUS = { N: 0, R: 2, SR: 4, SSR: 6 };
export const RULER_GACHA = {
  pull1: 30, pull10: 300,                         // 値段（えんぴつ）。10回はSR以上が1本確定
  weights: { N: 55, R: 30, SR: 12, SSR: 3 },     // 確率の重み
  refund: { N: 2, R: 5, SR: 15, SSR: 50 },        // 持っている定規が出たら、えんぴつに変えて返す
  pity: 100,                                      // この回数を引くと、受け取り箱に「SSR交換券」が届く
};
const CUSTOM_ID = /^ruler:x-[a-z0-9]{4,12}$/;
const cleanText = (v, max) => Array.from(String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim()).slice(0, max).join('');

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
  const rarityBonus = {};
  for (const k of RARITY_ORDER) rarityBonus[k] = num(src.rarityBonus?.[k], 0, 15, base.rarityBonus[k], 0.5);
  const traits = {};
  for (const k of Object.keys(TRAITS)) traits[k] = num(src.traits?.[k], 0, k === 'aim' ? 100 : 30, base.traits[k], 0.5);
  const skillTune = {};
  for (const [k, r] of Object.entries(SKILL_TUNE_KEYS)) skillTune[k] = num(src.skillTune?.[k], r.min, r.max, base.skillTune[k]);
  const rg = src.rulerGacha || {};
  const rulerGacha = {
    pull1: num(rg.pull1, 1, 10000, RULER_GACHA.pull1),
    pull10: num(rg.pull10, 1, 100000, RULER_GACHA.pull10),
    weights: Object.fromEntries(RARITY_ORDER.map((k) => [k, num(rg.weights?.[k], 0, 10000, RULER_GACHA.weights[k], 0.1)])),
    refund: Object.fromEntries(RARITY_ORDER.map((k) => [k, num(rg.refund?.[k], 0, 100000, RULER_GACHA.refund[k])])),
    pity: num(rg.pity, 0, 1000, RULER_GACHA.pity),
  };
  // 銘柄：決まった値の中から選んだものだけ残す。元の銘柄は、変えた所だけ持つ
  const brands = {};
  const defaults = Object.fromEntries(DEFAULT_BRANDS.map((b) => [b.id, b]));
  for (const [id, v] of Object.entries(src.brands && typeof src.brands === 'object' ? src.brands : {})) {
    if (!v || typeof v !== 'object') continue;
    const d = defaults[id];
    const isCustom = !d && CUSTOM_ID.test(id) && v.custom;
    if (!d && !isCustom) continue;
    const out = {};
    const name = cleanText(v.name, 20);
    if (name) out.name = name;
    if (RARITY_ORDER.includes(v.rarity)) out.rarity = v.rarity;
    if (ARTS[v.art]) out.art = v.art;
    if (v.trait === null || v.trait === '' || TRAITS[v.trait]) out.trait = TRAITS[v.trait] ? v.trait : null;
    if (SKILLS[v.skill]) out.skill = v.skill;
    if (typeof v.gacha === 'boolean') out.gacha = d?.stage ? false : v.gacha;
    if (isCustom) {
      if (!FORM_SHAPES.includes(v.shape) || !MAT_ORDER.includes(v.mat)) continue;
      brands[id] = { name: out.name || '名前のない定規', rarity: out.rarity || 'N', art: out.art || 'plain', trait: out.trait ?? null, skill: out.skill || RULER_SKILL[`${v.shape}-${v.mat}`], gacha: out.gacha ?? true, custom: true, shape: v.shape, mat: v.mat };
      continue;
    }
    for (const k of Object.keys(out)) if (out[k] === (d[k] ?? null)) delete out[k];
    if (Object.keys(out).length) brands[id] = out;
  }
  return { economy, rarities, acc, disabled, skills, rulers, rarityBonus, traits, skillTune, rulerGacha, brands };
}

// 設定として成り立っているか（保存の前に確かめる）。問題があれば理由を返す
export function configProblem(cfg) {
  if (!activeRarities(cfg).length) return 'ガチャで出るものがありません。確率が0より大きいレア度に、出すアイテムを1つ以上残してください';
  const saved = { ...ITEMS };
  applyConfig(cfg);
  const ok = RARITY_ORDER.some((k) => cfg.rulerGacha.weights[k] > 0 && rulerPool(k).length);
  const ssr = rulerPool('SSR').length;
  for (const k of Object.keys(ITEMS)) delete ITEMS[k];
  Object.assign(ITEMS, saved);
  if (!ok) return '定規ガチャで出る定規がありません。確率が0より大きいレア度に、ガチャに出す定規を1本以上残してください';
  if (cfg.rulerGacha.pity > 0 && !ssr) return '天井（SSR交換券）があるのに、ガチャに出るSSRの定規がありません';
  return null;
}

// ---- 定規ガチャ：1回引く。rand は 0以上1未満を返す関数。minRarity 以上のレア度だけで選び直す（10回の確定枠） ----
export function rollRuler(rand, minRarity, cfg = defaultConfig()) {
  const w = cfg.rulerGacha.weights;
  const act = RARITY_ORDER.filter((k) => w[k] > 0 && rulerPool(k).length && (!minRarity || RARITY_ORDER.indexOf(k) >= RARITY_ORDER.indexOf(minRarity)));
  const from = act.length ? act : RARITY_ORDER.filter((k) => w[k] > 0 && rulerPool(k).length);
  const total = from.reduce((a, k) => a + w[k], 0);
  let x = rand() * total, rarity = from[from.length - 1];
  for (const k of from) { x -= w[k]; if (x < 0) { rarity = k; break; } }
  const pool = rulerPool(rarity);
  return pool[Math.floor(rand() * pool.length) % pool.length];
}
// 定規ガチャの確率（表示用）
export function rulerOdds(cfg = defaultConfig()) {
  const w = cfg.rulerGacha.weights;
  const act = RARITY_ORDER.filter((k) => w[k] > 0 && rulerPool(k).length);
  const total = act.reduce((a, k) => a + w[k], 0) || 1;
  return RARITY_ORDER.map((k) => {
    const pool = rulerPool(k);
    const p = act.includes(k) ? (w[k] / total) * 100 : 0;
    return { rarity: k, name: RULER_RARITY[k].name, percent: p, each: pool.length ? p / pool.length : 0, items: pool.map((it) => it.id) };
  });
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
// 銘柄の必殺技（設定で変えた値 → 前の版の形×素材ごとの割り当て → 銘柄の初期値）
export function brandSkill(ruler, cfg) {
  const o = cfg?.brands?.[ruler.id]?.skill;
  if (SKILLS[o]) return o;
  const old = ruler.rarity === 'N' && !ruler.custom ? cfg?.skills?.[ruler.specKey] : null;
  if (SKILLS[old]) return old;
  return ruler.skill || skillFor(ruler.specKey);
}
// 重さ・はじく力：レア度 × レベル × アクセサリ を掛け合わせる（上限は physics.js の MOD_TOTAL_LIMIT）
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
  const rare = (cfg.rarityBonus?.[ruler.rarity] ?? RARITY_BONUS[ruler.rarity] ?? 0) / 100;
  mods.mass *= (1 + bonus) * (1 + rare);
  mods.power *= (1 + bonus) * (1 + rare);
  for (const k of Object.keys(mods)) mods[k] = Math.round(mods[k] * 10000) / 10000;
  const trait = ruler.trait || null;
  return {
    ruler: ruler.id, specKey: ruler.specKey, pattern, sticker, acc, level: lv, mods, skill: brandSkill(ruler, cfg),
    tune: cfg.rulers?.[ruler.specKey] || null, rarity: ruler.rarity, art: ruler.art, name: ruler.name,
    trait, traitPct: trait ? (cfg.traits?.[trait] ?? TRAITS[trait].pct) : 0,
    skillTune: { ...Object.fromEntries(Object.keys(SKILL_TUNE_KEYS).map((k) => [k, SKILL_TUNE[k]])), ...(cfg.skillTune || {}) },
  };
}

export function accText(id, cfg = defaultConfig()) {
  const a = ITEMS[id];
  if (!a || a.kind !== 'acc') return '';
  const pct = accPct(id, cfg);
  return `${STATS[a.stat].name} ${pct > 0 ? '+' : ''}${pct}%`;
}
