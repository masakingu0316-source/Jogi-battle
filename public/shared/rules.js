// 定規バトル ルール定義（サーバーと画面で共有）

// 生徒机（天板 65×45cm）をくっつけた並べ方。cols×rows で1台ずつの区切り。
export const DESKS = {
  single: { name: '1台', w: 65, h: 45, cols: 1, rows: 1 },
  pair: { name: '2台 向かい合わせ', w: 90, h: 65, cols: 2, rows: 1 },
  group: { name: '4台 班の形', w: 130, h: 90, cols: 2, rows: 2 },
};

// min/max はそのモードで遊べる人数
export const MODES = {
  quick: { name: 'クイック', desk: 'single', min: 2, max: 2, teams: false, note: '1対1・机1台。数分で決着' },
  standard: { name: '標準', desk: 'pair', min: 2, max: 2, teams: false, note: '1対1・机2台。押し合いの駆け引き' },
  melee: { name: '乱戦', desk: 'group', min: 3, max: 4, teams: false, note: '3〜4人・机4台。最後まで残った人が勝ち' },
  team: { name: 'チーム戦', desk: 'group', min: 4, max: 4, teams: true, note: '2対2・机4台。向かいの席が味方' },
};

// 席順（時計回り）。チーム戦は向かい合う席が味方（赤・緑 / 青・黄）。
export const PLAYERS = [
  { name: '赤', color: '#ff7f6e', tint: 'rgba(226, 68, 56, 0.50)', edge: 'rgba(150, 30, 24, 0.9)', sticker: '#d9443a', ink: '#fff' },
  { name: '青', color: '#76c6ff', tint: 'rgba(38, 128, 214, 0.48)', edge: 'rgba(16, 72, 140, 0.9)', sticker: '#2a7fd4', ink: '#fff' },
  { name: '緑', color: '#86e09a', tint: 'rgba(40, 160, 80, 0.48)', edge: 'rgba(16, 90, 40, 0.9)', sticker: '#2c9a4e', ink: '#fff' },
  { name: '黄', color: '#f6d55c', tint: 'rgba(232, 182, 18, 0.52)', edge: 'rgba(130, 95, 0, 0.9)', sticker: '#f2c418', ink: '#3a2c00' },
];

export const TEAMS = [
  { name: 'Aチーム', members: '赤・緑', color: '#ff7f6e' },
  { name: 'Bチーム', members: '青・黄', color: '#76c6ff' },
];

export const MAX_MEMBERS = 4;
export const teamOf = (i) => i % 2;

// 席の配置：1対1は左右に縦向き、3〜4人は机の中央を囲むように並べる
export function seats(n, desk) {
  if (n === 2) {
    const sx = Math.round(desk.w * 0.22);
    return [{ x: -sx, y: 0, a: Math.PI / 2 }, { x: sx, y: 0, a: Math.PI / 2 }];
  }
  const angles = n === 3 ? [-90, 30, 150] : [-135, -45, 45, 135];
  const rx = desk.w * 0.26, ry = desk.h * 0.24;
  return angles.map((deg) => {
    const t = deg * Math.PI / 180;
    return { x: rx * Math.cos(t), y: ry * Math.sin(t), a: t + Math.PI / 2 };
  });
}

// 人数がそのモードに合っているか。合っていなければ理由を返す。
export function playableReason(modeKey, count) {
  const m = MODES[modeKey];
  if (!m) return 'モードが不明です';
  if (count < m.min) return `${m.name}は${m.min}人から遊べます（あと${m.min - count}人）`;
  if (count > m.max) return `${m.name}は${m.max}人までです`;
  return null;
}

// ---- 机が消えていく（3人以上で始めて、残りが2人になったら） ----
// 机を1台ずつに分けた区画。i は左上から横に数えた番号
export function deskTiles(desk) {
  const pw = desk.w / desk.cols, ph = desk.h / desk.rows;
  const out = [];
  for (let r = 0; r < desk.rows; r++) for (let c = 0; c < desk.cols; c++) {
    const x0 = -desk.w / 2 + c * pw, y0 = -desk.h / 2 + r * ph;
    out.push({ i: r * desk.cols + c, r, c, x0, y0, x1: x0 + pw, y1: y0 + ph });
  }
  return out;
}
export const SHRINK_FROM_PLAYERS = 3; // この人数以上で始めた対戦だけ
export const onTile = (t, x, y) => x >= t.x0 && x <= t.x1 && y >= t.y0 && y <= t.y1;

// 残った机どうしが辺でつながっているか（角だけで接する2台にはしない）
export function tilesConnected(desk, list) {
  if (list.length <= 1) return true;
  const tiles = deskTiles(desk).filter((t) => list.includes(t.i));
  const seen = new Set([tiles[0].i]);
  const stack = [tiles[0]];
  while (stack.length) {
    const a = stack.pop();
    for (const b of tiles) {
      if (seen.has(b.i) || Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) continue;
      seen.add(b.i); stack.push(b);
    }
  }
  return seen.size === tiles.length;
}
// 次に消す机をランダムに選ぶ（残りがつながったままになる机の中から）
export function pickVanish(desk, list, rand = Math.random) {
  if (list.length <= 1) return null;
  const ok = list.filter((i) => tilesConnected(desk, list.filter((j) => j !== i)));
  const from = ok.length ? ok : list;
  return from[Math.floor(rand() * from.length) % from.length];
}

// ---- クリティカルヒット ----
// はじいた瞬間に抽選。当たりなら、この対戦ではじいた定規が最初に当てた相手に伝わる力が mul 倍になる
export const CRIT = { rate: 0.1, mul: 1.6 };

// ---- 必殺技 ----
// 定規の形で技が決まる。ゲージ（0〜100）が満タンのとき、自分の番に1回使える
export const SKILLS = {
  power: { name: '剛腕', desc: 'その1打のはじく力が大きく上がる（自滅もしやすい）', color: '#ff6b4a' },
  double: { name: '連打', desc: '止まったあと、もう1回続けてはじける', color: '#4ab3ff' },
  wind: { name: '突風', desc: '止まった場所から風を起こし、周りの定規を吹き飛ばす', color: '#5fd68a' },
  anchor: { name: '不動', desc: '次の自分の番まで、定規が重くなって押されにくい', color: '#b48cff' },
};
export const SHAPE_SKILL = { straight30: 'power', straight15: 'double', tri45: 'wind', tri60: 'anchor', protractor: 'wind' };
export const SKILL_TUNE = {
  powerMul: 1.5,            // 剛腕：はじく強さ（速さ）の倍率。すべる距離はおよそ2.2倍
  windRadius: 20,           // 突風が届く距離（cm）
  windRadiusProtractor: 26, // 分度器は半円なので広い
  windSpeed: 260,           // 突風のいちばん近くでの速さ（cm/秒、26gの定規）
  anchorMass: 3,            // 不動：重さの倍率
};
// ゲージのたまり方
export const GAUGE = { max: 100, shot: 20, hit: 10, beHit: 30 };

// ---- 場のイベント ----
// 2周目から、番が変わるたびに rate の確率で起きる（ほかのイベントが続いている間は起きない）
//  ice：その番のあいだ机が凍って、すべりやすくなる
//  chair：机の1つの辺に椅子が並び、1周のあいだその辺からは落ちない
export const EVENTS = {
  rate: 0.2,
  ice: { name: 'こおり', friction: 0.3, desc: 'この番は机が凍って、よくすべる' },
  chair: { name: 'いす', desc: '椅子が並んだ辺からは落ちない' },
};
// 椅子を置ける辺（残っている机の外側の辺）。side: top / bottom / left / right
export function chairSides(desk, list) {
  const tiles = deskTiles(desk).filter((t) => !list || list.includes(t.i));
  if (!tiles.length) return [];
  const minX = Math.min(...tiles.map((t) => t.x0)), maxX = Math.max(...tiles.map((t) => t.x1));
  const minY = Math.min(...tiles.map((t) => t.y0)), maxY = Math.max(...tiles.map((t) => t.y1));
  const span = (arr, a, b) => ({ lo: Math.min(...arr.map((t) => t[a])), hi: Math.max(...arr.map((t) => t[b])) });
  const near = (v, w) => Math.abs(v - w) < 1e-6;
  return [
    { side: 'top', nx: 0, ny: -1, d: -minY, ...span(tiles.filter((t) => near(t.y0, minY)), 'x0', 'x1') },
    { side: 'bottom', nx: 0, ny: 1, d: maxY, ...span(tiles.filter((t) => near(t.y1, maxY)), 'x0', 'x1') },
    { side: 'left', nx: -1, ny: 0, d: -minX, ...span(tiles.filter((t) => near(t.x0, minX)), 'y0', 'y1') },
    { side: 'right', nx: 1, ny: 0, d: maxX, ...span(tiles.filter((t) => near(t.x1, maxX)), 'y0', 'y1') },
  ];
}
