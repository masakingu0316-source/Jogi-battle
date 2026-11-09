// アイテムの一覧（サーバーと画面で共有）
// kind: ruler 定規 / pattern 柄 / sticker シール / acc アクセサリ（性能に効く）
import Physics from './physics.js';

export const RARITIES = {
  N: { name: 'ノーマル', weight: 60, refund: 2, color: '#c9d3cd' },
  R: { name: 'レア', weight: 28, refund: 5, color: '#76c6ff' },
  SR: { name: 'Sレア', weight: 10, refund: 15, color: '#d69cff' },
  SSR: { name: 'SSレア', weight: 2, refund: 40, color: '#f4d35e' },
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
};

// stat: mass 重さ / mu 机とのすべりにくさ / power はじく力（エネルギー）
export const STATS = {
  mass: { name: '重さ', up: '重くなり、押されにくい', down: '軽くなる' },
  mu: { name: 'すべりにくさ', up: 'すべりにくく、止まりやすい', down: 'よくすべる' },
  power: { name: 'はじく力', up: 'はじく力が強くなる', down: 'はじく力が弱くなる' },
};

const items = [
  // 定規（基本の4本は全員が持っている）
  ...Object.entries(Physics.RULERS).filter(([, r]) => r.basic).map(([key, r]) => ({ id: 'ruler:' + key, kind: 'ruler', rarity: 'basic', name: r.name, specKey: key })),
  { id: 'ruler:plastic20', kind: 'ruler', rarity: 'R', name: '20cm プラ定規', specKey: 'plastic20', desc: '15cmと30cmの間。軽くて扱いやすい' },
  { id: 'ruler:acrylic30', kind: 'ruler', rarity: 'SR', name: '30cm アクリル定規', specKey: 'acrylic30', desc: '幅広で重い。どっしり構えて押し返す' },
  { id: 'ruler:steel30', kind: 'ruler', rarity: 'SR', name: '30cm ステンレス定規', specKey: 'steel30', desc: 'いちばん重く、よくすべる' },
  { id: 'ruler:grid30', kind: 'ruler', rarity: 'SSR', name: '30cm 方眼定規', specKey: 'grid30', desc: '幅5cmの方眼。当たり判定が大きい' },

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
export const GACHA_POOL = items.filter((it) => it.rarity !== 'basic');
export const BASIC_RULERS = items.filter((it) => it.kind === 'ruler' && it.rarity === 'basic').map((it) => it.id);
export const DEFAULT_RULER = 'ruler:plastic30';

// レア度ごとの確率（表示用、合計100%）と、各アイテムの確率
export function odds() {
  const total = Object.values(RARITIES).reduce((a, r) => a + r.weight, 0);
  return Object.entries(RARITIES).map(([key, r]) => {
    const pool = GACHA_POOL.filter((it) => it.rarity === key);
    return { rarity: key, name: r.name, percent: (r.weight / total) * 100, each: (r.weight / total) * 100 / pool.length, items: pool.map((it) => it.id) };
  });
}

// 1回引く。rand は 0以上1未満を返す関数。minRarity を指定すると、それ未満は引き直さずに格上げする
const ORDER = ['N', 'R', 'SR', 'SSR'];
export function rollOnce(rand, minRarity) {
  const total = Object.values(RARITIES).reduce((a, r) => a + r.weight, 0);
  let x = rand() * total, rarity = 'N';
  for (const key of ORDER) { x -= RARITIES[key].weight; if (x < 0) { rarity = key; break; } }
  if (minRarity && ORDER.indexOf(rarity) < ORDER.indexOf(minRarity)) {
    // 確定枠：Rレア以上の比率で引き直す
    const keys = ORDER.slice(ORDER.indexOf(minRarity));
    const t = keys.reduce((a, k) => a + RARITIES[k].weight, 0);
    let y = rand() * t;
    rarity = keys[keys.length - 1];
    for (const k of keys) { y -= RARITIES[k].weight; if (y < 0) { rarity = k; break; } }
  }
  const pool = GACHA_POOL.filter((it) => it.rarity === rarity);
  return pool[Math.floor(rand() * pool.length)];
}

// 定規1本ぶんの装備から、対戦で使う情報を作る（所持の確認は呼ぶ側で行う）
export function resolveLoadout(setup) {
  const ruler = ITEMS[setup?.ruler] && ITEMS[setup.ruler].kind === 'ruler' ? ITEMS[setup.ruler] : ITEMS[DEFAULT_RULER];
  const pattern = ITEMS[setup?.pattern]?.kind === 'pattern' ? setup.pattern : null;
  const sticker = ITEMS[setup?.sticker]?.kind === 'sticker' ? setup.sticker : null;
  const acc = ITEMS[setup?.acc]?.kind === 'acc' ? setup.acc : null;
  const mods = { mass: 1, mu: 1, power: 1 };
  if (acc) {
    const a = ITEMS[acc];
    mods[a.stat] = 1 + Math.max(-Physics.MOD_LIMIT, Math.min(Physics.MOD_LIMIT, a.pct / 100));
  }
  return { ruler: ruler.id, specKey: ruler.specKey, pattern, sticker, acc, mods };
}

export function accText(id) {
  const a = ITEMS[id];
  if (!a || a.kind !== 'acc') return '';
  return `${STATS[a.stat].name} ${a.pct > 0 ? '+' : ''}${a.pct}%`;
}
