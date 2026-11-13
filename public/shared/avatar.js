// アバター（3頭身のデフォルメ）：部位とパーツ、最初から選べる基本パーツ、クラスメイト31人。
// 見た目の描き方は public/avatar-paint.js。ここは画面とサーバーの両方で使う「データ」だけ。
//
// パーツ1つ = { slot（部位）, key, name, base（描き方の種類）, c1, c2（色）, rarity, basic（最初から選べる） }
// 持ち物としてのID は `avatar:部位:key`（受け取り箱で配れる・ガチャやイベントで増やせる）。
// 設定画面で、パーツの名前・色・レア度・基本かどうかを変えたり、描き方と色を選んで新しいパーツを足したりできる。

export const AVATAR_SLOTS = [
  { key: 'skin', name: '肌の色', color: true },
  { key: 'hair', name: '髪型' },
  { key: 'hairColor', name: '髪の色', color: true },
  { key: 'eyes', name: '目' },
  { key: 'outfit', name: '服' },
  { key: 'jacket', name: '上着', none: true },
  { key: 'head', name: '頭', none: true },
  { key: 'face', name: '顔', none: true },
  { key: 'item', name: '持ち物', none: true },
  { key: 'bg', name: '背景', none: true },
];
export const SLOT_KEYS = AVATAR_SLOTS.map((s) => s.key);
export const SLOT_INFO = Object.fromEntries(AVATAR_SLOTS.map((s) => [s.key, s]));

// 部位ごとの描き方の種類（設定画面で新しいパーツを足すときに選ぶ）。c1・c2 は色の意味
export const AVATAR_BASES = {
  skin: { color: { name: '色', c1: '肌' } },
  hairColor: { color: { name: '色', c1: '髪' } },
  hair: {
    short: { name: 'ショート' }, bob: { name: 'ボブ' }, long: { name: 'ロング' }, pony: { name: 'ポニーテール', c2: '結び目' },
    spiky: { name: 'つんつん' }, bun: { name: 'おだんご', c2: '髪ひも' }, twin: { name: 'ツインテール', c2: '髪ひも' }, mage: { name: 'ちょんまげ' },
  },
  eyes: {
    maru: { name: '丸い目' }, nikko: { name: 'にっこり' }, kiri: { name: 'きりっ' }, tare: { name: 'たれ目' },
    jito: { name: 'じと目' }, kira: { name: 'きらきら' }, wink: { name: 'ウインク' },
  },
  outfit: {
    gakuran: { name: '学ラン', c1: '上着とズボン', c2: 'ボタン' }, sailor: { name: 'セーラー服', c1: 'えりとスカート', c2: 'スカーフ' },
    blazer: { name: 'ブレザー', c1: 'ブレザー', c2: 'ネクタイ' }, gym: { name: '体操服', c1: 'ふちどり', c2: 'ズボン' },
    hakama: { name: '袴', c1: '袴', c2: '上の着物' }, jinbei: { name: '甚平', c1: '生地', c2: 'ひも' },
    jersey: { name: 'ジャージ', c1: '生地', c2: 'ライン' },
  },
  jacket: {
    cardigan: { name: 'カーディガン', c1: '生地' }, parka: { name: 'パーカー', c1: '生地', c2: 'ひも' }, haori: { name: '羽織', c1: '生地', c2: '紋' }, hanten: { name: '半纏', c1: '生地', c2: 'えり' },
    chalkcoat: { name: '粉の付いた上着', c1: '生地', c2: 'チョークの粉' }, muffler: { name: 'マフラー', c1: '毛糸', c2: 'しま' },
    zekken: { name: 'ゼッケン', c1: '布', c2: '数字' }, hakui: { name: '白衣', c1: '生地', c2: 'ポケット' },
    wanshou: { name: '腕章', c1: '腕章', c2: '字' }, tasuki: { name: 'たすき', c1: 'たすき', c2: '字' },
  },
  head: {
    hachimaki: { name: 'ハチマキ', c1: '布', c2: '日の丸' }, gakubou: { name: '学生帽', c1: '帽子', c2: '記章' }, kitsune: { name: '狐面', c1: '面', c2: '隈取り' }, mugiwara: { name: '麦わら帽子', c1: '麦わら', c2: 'リボン' },
    kyushoku: { name: '給食帽', c1: '布' }, gabyo: { name: '画びょうの髪留め', c1: '画びょう', c2: '針' }, akashiro: { name: '赤白帽', c1: '表', c2: 'ふち' },
    headphone: { name: 'ヘッドホン', c1: 'ヘッドホン', c2: 'クッション' }, sankakukin: { name: '三角巾', c1: '布', c2: 'しま' }, enpitsu: { name: '耳の鉛筆', c1: '鉛筆', c2: '消しゴム' },
    hoshipin: { name: '星のヘアピン', c1: '星' }, oendan: { name: '長いはちまき', c1: '布', c2: '字' }, beret: { name: 'ベレー帽', c1: '帽子' }, kanzashi: { name: '髪かざり', c1: '花', c2: '金具' },
  },
  face: {
    glasses: { name: 'メガネ', c1: 'ふち' }, bandage: { name: 'ばんそうこう', c1: 'ばんそうこう' }, sumi: { name: 'ほっぺの墨', c1: '墨' }, mask: { name: 'マスク', c1: 'マスク' },
    bandagex: { name: 'ばってんのばんそうこう', c1: 'ばんそうこう' }, marumegane: { name: '丸メガネ', c1: 'ふち' },
  },
  item: {
    fudebako: { name: '筆箱', c1: '筆箱', c2: 'ファスナー' }, randoseru: { name: 'ランドセル', c1: 'ランドセル', c2: '金具' }, shinai: { name: '竹刀', c1: '竹', c2: 'つば' }, sankaku: { name: '大きな三角定規', c1: '定規' },
    kingyo: { name: '金魚の袋', c1: '金魚', c2: '水' }, whistle: { name: 'ホイッスル', c1: '笛', c2: 'ひも' }, recorder: { name: 'リコーダー', c1: '本体', c2: '穴とつぎめ' },
    stopwatch: { name: 'ストップウォッチ', c1: '本体', c2: 'ひも' }, racket: { name: 'ラケット', c1: 'ラバー', c2: '柄' }, bunko: { name: '文庫本', c1: 'カバー', c2: 'しおり' },
    compass: { name: 'コンパス', c1: '金属', c2: '持ち手' }, sensu: { name: '扇子', c1: '紙', c2: '骨' }, camera: { name: 'カメラ', c1: '本体', c2: 'ストラップ' },
    ball: { name: 'ボール', c1: '白', c2: '黒' }, shinaibukuro: { name: '竹刀袋', c1: '袋', c2: 'ひも' }, shusseki: { name: '出席簿', c1: '表紙', c2: '字' },
  },
  bg: { classroom: { name: '教室の席', c1: '壁', c2: '窓の空' }, kokuban: { name: '黒板', c1: '黒板', c2: 'チョーク' }, dojo: { name: '道場', c1: '板の壁', c2: '掛け軸' }, kotei: { name: '桜の校庭', c1: '空', c2: '桜' } },
};

// 最初から入っているパーツ。basic: 最初から選べる（ほかは道場の報酬などで手に入れる）
const P = (slot, key, name, base, c1, c2, rarity = 'N', basic = true) => ({ slot, key, name, base, c1, c2: c2 || null, rarity, basic });
export const DEFAULT_PARTS = [
  // 肌の色（5色。だれでも自由に選べる）
  P('skin', 's1', 'うすだいだい', 'color', '#f6dcc6'), P('skin', 's2', 'はだ', 'color', '#eecaa8'), P('skin', 's3', 'こむぎ', 'color', '#ddac84'),
  P('skin', 's4', 'くりいろ', 'color', '#c08a62'), P('skin', 's5', 'こげちゃ', 'color', '#8e5f45'),
  // 髪型（基本6・報酬2）
  P('hair', 'short', 'ショート', 'short'), P('hair', 'bob', 'ボブ', 'bob'), P('hair', 'long', 'ロング', 'long'),
  P('hair', 'pony', 'ポニーテール', 'pony', null, '#9c3b30'), P('hair', 'spiky', 'つんつん', 'spiky'), P('hair', 'bun', 'おだんご', 'bun', null, '#c7a14a'),
  P('hair', 'twin', 'ツインテール', 'twin', null, '#9c3b30', 'R', false), P('hair', 'mage', 'ちょんまげ', 'mage', null, null, 'SR', false),
  // 髪の色（基本8・報酬2）
  P('hairColor', 'sumi', '墨', 'color', '#26252b'), P('hairColor', 'kogecha', '焦茶', 'color', '#4a3329'), P('hairColor', 'kuri', '栗', 'color', '#74482f'),
  P('hairColor', 'kurumi', '胡桃', 'color', '#9a6b45'), P('hairColor', 'ama', '亜麻', 'color', '#c4a26c'), P('hairColor', 'ginnezu', '銀鼠', 'color', '#9a9ca3'),
  P('hairColor', 'ai', '藍', 'color', '#2e4468'), P('hairColor', 'enji', '臙脂', 'color', '#7c2f33'),
  P('hairColor', 'sakura', '桜', 'color', '#d7a3a6', null, 'R', false), P('hairColor', 'wakatake', '若竹', 'color', '#6f9a7b', null, 'R', false),
  // 目（基本6・報酬1）
  P('eyes', 'maru', '丸い目', 'maru'), P('eyes', 'nikko', 'にっこり', 'nikko'), P('eyes', 'kiri', 'きりっ', 'kiri'),
  P('eyes', 'tare', 'たれ目', 'tare'), P('eyes', 'jito', 'じと目', 'jito'), P('eyes', 'kira', 'きらきら', 'kira'),
  P('eyes', 'wink', 'ウインク', 'wink', null, null, 'R', false),
  // 服（基本4・報酬2）
  P('outfit', 'gakuran', '学ラン', 'gakuran', '#262a3c', '#c9a64a'), P('outfit', 'sailor', 'セーラー服', 'sailor', '#27375a', '#a8433a'),
  P('outfit', 'blazer', 'ブレザー', 'blazer', '#3a4a5e', '#8e3a34'), P('outfit', 'gym', '体操服', 'gym', '#2f5f8f', '#2a3452'),
  P('outfit', 'hakama', '袴', 'hakama', '#2b3c63', '#f2efe7', 'SR', false), P('outfit', 'jinbei', '甚平', 'jinbei', '#5b7a8c', '#e9e2d0', 'R', false),
  // 上着（なし＋基本2・報酬2）
  P('jacket', 'cardigan', 'カーディガン', 'cardigan', '#c8b48e'), P('jacket', 'parka', 'パーカー', 'parka', '#7d8c7a', '#efe9da'),
  P('jacket', 'haori', '羽織', 'haori', '#2a2a30', '#efe9da', 'SR', false), P('jacket', 'hanten', '半纏', 'hanten', '#3d4f74', '#9a3b33', 'R', false),
  // 頭（なし＋基本2・報酬2）
  P('head', 'hachimaki', 'ハチマキ', 'hachimaki', '#f3efe6', '#b8392d'), P('head', 'gakubou', '学生帽', 'gakubou', '#25283a', '#c9a64a'),
  P('head', 'kitsune', '狐面', 'kitsune', '#f4f0e8', '#b8392d', 'SR', false), P('head', 'mugiwara', '麦わら帽子', 'mugiwara', '#d9bd7a', '#9c3b30', 'R', false),
  // 顔（なし＋基本2・報酬2）
  P('face', 'glasses', 'メガネ', 'glasses', '#3a3430'), P('face', 'bandage', 'ばんそうこう', 'bandage', '#e9c9a0'),
  P('face', 'sumi', 'ほっぺの墨', 'sumi', '#26252b', null, 'R', false), P('face', 'mask', 'マスク', 'mask', '#f4f2ec', null, 'R', false),
  // 持ち物（なし＋基本2・報酬2）
  P('item', 'fudebako', '筆箱', 'fudebako', '#3f6c8f', '#d8d2c2'), P('item', 'randoseru', 'ランドセル', 'randoseru', '#7a2e2a', '#c9a64a'),
  P('item', 'shinai', '竹刀', 'shinai', '#d6c08a', '#3a2f28', 'SR', false), P('item', 'sankaku', '大きな三角定規', 'sankaku', '#8fc1d9', null, 'R', false),
  // 背景（なし＋基本2・報酬2）
  P('bg', 'classroom', '教室の席', 'classroom', '#efe6d2', '#bcd6e6'), P('bg', 'kokuban', '黒板', 'kokuban', '#2f4a3c', '#f2efe6'),
  P('bg', 'dojo', '道場', 'dojo', '#c49a68', '#f1ead8', 'SR', false), P('bg', 'kotei', '桜の校庭', 'kotei', '#cfe0ea', '#e8b9c0', 'R', false),

  // ---- バトル道場の報酬（クラスメイトに初めて勝つと、その子のパーツ。dojo: 道場で手に入る） ----
  ...[
    P('jacket', 'chalk', 'チョークの粉が付いた上着', 'chalkcoat', '#3d4a5c', '#f4f1e8', 'N', false),
    P('item', 'kingyo', '金魚の袋', 'kingyo', '#e2553f', '#a9d8ef', 'N', false),
    P('head', 'kyushoku', '給食帽', 'kyushoku', '#f7f5ef', null, 'N', false),
    P('head', 'gabyo', '画びょうの髪留め', 'gabyo', '#d9443a', '#c9ccd2', 'N', false),
    P('item', 'whistle', 'ホイッスル', 'whistle', '#c9ccd2', '#d0452f', 'N', false),
    P('face', 'hokenban', '保健係のばんそうこう', 'bandagex', '#efcfa8', null, 'N', false),
    P('head', 'akashiro', '赤白帽', 'akashiro', '#c8372d', '#f7f5ef', 'N', false),
    P('item', 'recorder', 'リコーダー', 'recorder', '#efe6cf', '#8a6a4a', 'N', false),
    P('face', 'marumegane', '丸メガネ', 'marumegane', '#a8834a', null, 'R', false),
    P('head', 'headphone', 'ヘッドホン', 'headphone', '#2f3240', '#c94f3d', 'R', false),
    P('jacket', 'muffler', '毛糸のマフラー', 'muffler', '#b8463c', '#efe2c8', 'R', false),
    P('item', 'stopwatch', 'ストップウォッチ', 'stopwatch', '#d8dadf', '#3a5f8a', 'R', false),
    P('head', 'sankakukin', '三角巾', 'sankakukin', '#f4f2ec', '#7da7c4', 'R', false),
    P('item', 'racket', '卓球のラケット', 'racket', '#c8372d', '#b98a55', 'R', false),
    P('item', 'bunko', '文庫本', 'bunko', '#e7dcc0', '#7a3a5a', 'R', false),
    P('jacket', 'zekken', 'ゼッケン', 'zekken', '#f4f2ec', '#2f5f8f', 'R', false),
    P('head', 'enpitsu', '耳にはさんだ鉛筆', 'enpitsu', '#e2b53b', '#f0a99a', 'R', false),
    P('jacket', 'hakui', '白衣', 'hakui', '#f7f6f2', '#9fb4c8', 'SR', false),
    P('item', 'compass', 'コンパス', 'compass', '#b9bec6', '#2f5f8f', 'SR', false),
    P('item', 'sensu', '扇子', 'sensu', '#efe6cf', '#5a6f8f', 'SR', false),
    P('item', 'camera', '首から下げたカメラ', 'camera', '#2f3038', '#b8392d', 'SR', false),
    P('head', 'hoshipin', '星のヘアピン', 'hoshipin', '#f0c84a', null, 'SR', false),
    P('head', 'oendan', '応援団のはちまき', 'oendan', '#f4f2ec', '#b8392d', 'SR', false),
    P('item', 'ball', 'サッカーボール', 'ball', '#f7f6f2', '#2a2a30', 'SR', false),
    P('head', 'beret', 'ベレー帽', 'beret', '#3b3550', null, 'SR', false),
    P('item', 'shinaibukuro', '竹刀袋', 'shinaibukuro', '#2c3a5c', '#c9a64a', 'SR', false),
    P('head', 'kanzashi', '和柄の髪かざり', 'kanzashi', '#c4485a', '#e9c46a', 'SR', false),
    P('jacket', 'wanshou', '委員長の腕章', 'wanshou', '#a8322b', '#f2e6c8', 'SSR', false),
    // 担任の先生に初めて勝つ
    P('outfit', 'jersey', 'ジャージ', 'jersey', '#2e4a7a', '#f2efe6', 'SSR', false),
    P('item', 'shusseki', '出席簿', 'shusseki', '#34406a', '#f2efe6', 'SSR', false),
    // 30人破り（初めて達成したとき）
    P('jacket', 'tasuki', '学年最強のたすき', 'tasuki', '#c9a13a', '#7c2420', 'SSR', false),
  ].map((p) => ({ ...p, dojo: true })),
];
const RAR = ['N', 'R', 'SR', 'SSR'];

// いま使えるパーツ（設定で変えたもの・足したものを含む）。{ slot: { key: part } }
export const PARTS = {};
export const partId = (slot, key) => `avatar:${slot}:${key}`;
export function parsePartId(id) {
  const m = /^avatar:([a-zA-Z]+):([a-z0-9-]+)$/.exec(String(id || ''));
  return m && SLOT_INFO[m[1]] ? { slot: m[1], key: m[2] } : null;
}
export const partOf = (slot, key) => (key ? PARTS[slot]?.[key] || null : null);
export const partsOf = (slot) => Object.values(PARTS[slot] || {});

const HEX = /^#[0-9a-f]{6}$/i;
const CUSTOM_KEY = /^x-[a-z0-9]{3,12}$/;
const cleanText = (v, max) => Array.from(String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim()).slice(0, max).join('');

// 設定（avatarParts）を、決まった値の中に収める。元のパーツは変えた所だけ、足したパーツは全部を持つ
export function sanitizeAvatarParts(src) {
  const out = {};
  const defaults = Object.fromEntries(DEFAULT_PARTS.map((p) => [partId(p.slot, p.key), p]));
  for (const [id, v] of Object.entries(src && typeof src === 'object' ? src : {})) {
    if (!v || typeof v !== 'object') continue;
    const d = defaults[id];
    const at = parsePartId(id);
    if (!at) continue;
    const o = {};
    const name = cleanText(v.name, 16);
    if (name) o.name = name;
    if (RAR.includes(v.rarity)) o.rarity = v.rarity;
    if (typeof v.basic === 'boolean') o.basic = v.basic;
    if (HEX.test(v.c1 || '')) o.c1 = v.c1.toLowerCase();
    if (HEX.test(v.c2 || '')) o.c2 = v.c2.toLowerCase();
    if (d) {
      // 元のパーツ：初期値と違う所だけ
      for (const k of Object.keys(o)) if (o[k] === d[k]) delete o[k];
      if (Object.keys(o).length) out[id] = o;
    } else if (v.custom && CUSTOM_KEY.test(at.key) && AVATAR_BASES[at.slot]?.[v.base]) {
      out[id] = { custom: true, base: v.base, name: o.name || '新しいパーツ', rarity: o.rarity || 'N', basic: o.basic ?? false, c1: o.c1 || '#888888', c2: o.c2 || null };
    }
  }
  return out;
}

// 設定を反映して PARTS を作り直す。持ち物の一覧（ITEMS）に入れるための項目も返す
export function applyAvatarParts(cfgParts) {
  for (const k of Object.keys(PARTS)) delete PARTS[k];
  for (const s of SLOT_KEYS) PARTS[s] = {};
  const src = cfgParts || {};
  for (const p of DEFAULT_PARTS) PARTS[p.slot][p.key] = { ...p, ...(src[partId(p.slot, p.key)] || {}), slot: p.slot, key: p.key, base: p.base };
  for (const [id, o] of Object.entries(src)) {
    const at = parsePartId(id);
    if (!at || !o?.custom || PARTS[at.slot][at.key]) continue;
    PARTS[at.slot][at.key] = { slot: at.slot, key: at.key, name: o.name, base: o.base, c1: o.c1, c2: o.c2 || null, rarity: o.rarity || 'N', basic: !!o.basic, custom: true };
  }
  return Object.values(PARTS).flatMap((m) => Object.values(m)).map((p) => ({
    id: partId(p.slot, p.key), kind: 'avatar', slot: p.slot, rarity: p.rarity, name: `${p.name}（${SLOT_INFO[p.slot].name}）`, partName: p.name, basic: p.basic, custom: !!p.custom,
  }));
}
applyAvatarParts(null);

// 最初から持っている（だれでも選べる）パーツのID
export const basicPartIds = () => Object.values(PARTS).flatMap((m) => Object.values(m)).filter((p) => p.basic).map((p) => partId(p.slot, p.key));

// ---- アバター（部位 → パーツの key。なしは null） ----
function hashOf(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let s = hashOf(seed) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
const pickFrom = (r, list) => list[Math.floor(r() * list.length) % list.length];

// おまかせのアバター：seed（アカウントID・名前など）から毎回同じものを作る。allow(slot, part) で使えるパーツを絞れる
export function randomAvatar(seed, { allow = (s, p) => p.basic, noneRate = 0.5 } = {}) {
  const r = rng(seed);
  const av = {};
  for (const s of AVATAR_SLOTS) {
    const list = partsOf(s.key).filter((p) => allow(s.key, p));
    const useNone = s.none && (r() < (s.key === 'bg' ? 0.15 : noneRate) || !list.length);
    av[s.key] = useNone ? null : (pickFrom(r, list)?.key ?? null);
  }
  return av;
}
// いちばん最初のアバター（ログインした人ごとに違う顔ぶれ。背景は教室の席）
export function defaultAvatar(seed = '') {
  const av = randomAvatar(seed || 'guest', { noneRate: 0.75, allow: (s, p) => p.basic && !p.custom });
  if (partOf('bg', 'classroom')) av.bg = 'classroom';
  return av;
}

// 形を整える：ない部位・ないパーツは、おまかせ（seed から）か「なし」に
export function sanitizeAvatar(input, seed = '') {
  const src = input && typeof input === 'object' ? input : {};
  const fallback = defaultAvatar(seed);
  const out = {};
  for (const s of AVATAR_SLOTS) {
    const v = src[s.key];
    if ((v === null || v === '') && s.none) out[s.key] = null;
    else if (typeof v === 'string' && partOf(s.key, v)) out[s.key] = v;
    else out[s.key] = fallback[s.key];
  }
  return out;
}
// 持っていないパーツが使われていたら、その部位の理由を返す（owned は持ち物のIDの Set）
export function avatarProblem(av, owned) {
  for (const s of AVATAR_SLOTS) {
    const key = av[s.key];
    if (!key) { if (!s.none) return `${s.name}を選んでください`; continue; }
    const p = partOf(s.key, key);
    if (!p) return `${s.name}のパーツが見つかりません`;
    if (!p.basic && !owned.has(partId(s.key, key))) return `${s.name}の「${p.name}」はまだ持っていません`;
  }
  return null;
}
export const avatarKey = (av) => SLOT_KEYS.map((k) => av?.[k] || '-').join('.');

// クラスメイト31人（バトル道場の相手）は shared/dojo.js
