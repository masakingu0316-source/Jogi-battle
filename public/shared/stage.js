// ステージモード（1人で攻略）のデータ。サーバーと画面で共有する。
// ステージ → マップ（10個、順に開放）→ 盤面（ふつう3回、最後のマップは5回）。盤面の敵を全部倒すと次の盤面へ。
import Physics from './physics.js';
import { DESKS } from './rules.js';

// ---- 敵 ----
// move：自分ではじいてくる敵／それ以外は置物（番が来ると act の効果だけ使う）
// act：nibble 近くの自分を削る / heal 近くの敵を直す / swing 近づいた定規を弾き飛ばす（ダメージなし）
// pinned：机に刺さって動かない / thorns：ぶつかった定規へのトゲのダメージ / zone：周りの机がねばる
export const ENEMIES = {
  eraser: {
    name: '消しゴム', spec: 'en-eraser', hp: 30, color: '#3f7fd6',
    act: 'nibble', range: 9, amount: 4,
    desc: 'とても滑りにくいが体力が少ない。すぐそばにいると、番が来るたびに少し削ってくる',
  },
  pencil: { name: '鉛筆', spec: 'en-pencil', hp: 45, color: '#e0a526', move: true, desc: '軽くてよくすべる。遠くからでも突っ込んでくる' },
  clip: { name: 'クリップ', spec: 'en-clip', hp: 40, color: '#8d9aab', move: true, power: 0.85, desc: '小さくて当てにくいが、見た目より重い' },
  stapler: { name: 'ホチキス', spec: 'en-stapler', hp: 110, color: '#5b6477', move: true, power: 0.6, desc: '重くて当たりが強い。押してもなかなか動かない' },
  tack: {
    name: '画びょう', spec: 'en-tack', hp: 25, color: '#d9443a', pinned: true, thorns: 6,
    desc: '机に刺さっていて動かない。当てても当てられても、ぶつかった定規はトゲでダメージを受ける',
  },
  glue: {
    name: 'スティックのり', spec: 'en-glue', hp: 50, color: '#8e5bd6', zone: { r: 12, mul: 2.6 },
    desc: '周りの机がねばって、定規が止まりやすい',
  },
  tape: {
    name: '修正テープ', spec: 'en-tape', hp: 45, color: '#2fb3a5',
    act: 'heal', range: 24, amount: 20,
    desc: '番が来るたびに、近くの敵の体力を最大の20%ずつ直す',
  },
  compass: {
    name: 'コンパス', spec: 'en-compass', hp: 70, color: '#7a8696', pinned: true,
    act: 'swing', range: 14, speed: 115,
    desc: '針で刺さっていて動かない。番が来たとき近くにいる定規を、ぐるっと弾き飛ばす（ダメージはない。机から落とされないように）',
  },
  // 敵の定規：spec で形と素材を決める。必殺技も使う
  ruler: { name: '定規', hp: 100, color: '#c0504d', move: true, skill: true, desc: '必殺技を使ってくる定規' },
  // ---- 破天荒編（図工室） ----
  // trail：動いた跡に、その筆の色（f.c）の細い水たまりを残す / splash：当てると絵の具がはねる / cut：刃の間で番を終えると、次にはじく力が半分
  // act pull：近くの定規（自分の定規・敵の定規）を引き寄せる。メタルは2倍
  brush: {
    name: '筆', spec: 'en-brush', hp: 40, color: '#a0522d', move: true, power: 0.9, trail: true, stage: 'hatenko',
    desc: '1本ごとに色が決まっていて、動いた跡にその色の細い水たまりを残す（3周たつと乾いて消える）',
  },
  palette: {
    name: 'パレット', spec: 'en-palette', hp: 60, color: '#c9a46b', splash: true, stage: 'hatenko',
    desc: '当てると、まわり3か所に4色からランダムで絵の具がはねて、水たまりになる（落雷が当たってもはねる）',
  },
  scissors: {
    name: 'はさみ', spec: 'en-scissors', hp: 70, color: '#7d8794', pinned: true, cut: true, stage: 'hatenko',
    desc: '机に置いてあって動かない。開いた刃の間で番を終えると、次にはじく力が半分になる（自分も敵も）',
  },
  magnet: {
    name: 'U字磁石', spec: 'en-magnet', hp: 80, color: '#d0453a', act: 'pull', range: 32, speed: 50, stage: 'hatenko',
    desc: '番が来るたびに、近く（30cm定規1本分）にある自分の定規と敵の定規を、少し引き寄せる。メタルの定規は2倍強く引き寄せる',
  },
  cloud: {
    name: '雷雲の雲形定規', spec: 'boss-cloud', hp: 220, color: '#5a4fcf', move: true, skill: 'raiun', boss: true, charge: 34, stage: 'hatenko',
    desc: '破天荒編のラスボス。へこんだ曲線の形のまま当たる。必殺技「落雷」：予告した場所に、ボスの次の番の直前に雷が落ちる。体力で雲の色が変わり、白い雲は3か所・灰色の雲は4か所・黒い雷雲は5か所に落とす',
  },
  boss: {
    name: '折りたたみ定規', spec: 'boss-folding', hp: 220, color: '#22c3b0', move: true, skill: 'fullopen', boss: true,
    desc: '可変定規編のラスボス。体力が減るほど開いて長くなる（たたんだ形 → 半分 → 全開）。必殺技「全開」も使う',
  },
};

// マップが進むほど、同じ敵でも強くなる（1マップごとの上がり幅）
// hp 体力 / atk 当てたときのダメージ / body 重さ / power はじく力（マップ1は弱めから） / act 置物の効果
export const SCALE = { hp: 0.1, atk: 0.07, body: 0.03, power0: 0.65, power: 0.02, act: 0.08 };
// 編ごとの難しさ：マップ番号の代わりに使う値（強さ・体力・敵のうまさ）。ないときはマップ番号のまま
export const diffOf = (stageId, map) => STAGES[stageId]?.diff?.[map - 1] ?? map;
export const scaleOf = (map) => {
  const k = Math.max(0, map - 1);
  return { hp: 1 + SCALE.hp * k, atk: 1 + SCALE.atk * k, body: 1 + SCALE.body * k, power: SCALE.power0 + SCALE.power * k, act: 1 + SCALE.act * k };
};
// 敵の体力の最大（マップ map のとき）。tune：設定画面の値 { enemyHp: { 種類: 体力 }, enemyHpGrow: ％ }
export function enemyMaxHp(type, map, tune) {
  const base = tune?.enemyHp?.[type] ?? ENEMIES[type]?.hp ?? 30;
  const grow = (tune?.enemyHpGrow ?? SCALE.hp * 100) / 100;
  return Math.max(1, Math.round(base * (1 + grow * Math.max(0, map - 1))));
}
// ステージでの自分の体力の最大：レベルが上がるほど増える（対人の対戦はいつも100）
export const STAGE_HP = { base: 100, perLevel: 3 };
export const stageMaxHp = (level) => STAGE_HP.base + STAGE_HP.perLevel * Math.max(0, (level | 0) - 1);
// 敵のはじき方のうまさ（マップごと）：試す数と、手元のぶれ
export const aiOf = (map) => ({
  samples: 2 + Math.floor(map / 3),
  aimNoise: Math.max(0.06, 0.2 - 0.012 * map),
  powerNoise: Math.max(0.08, 0.3 - 0.02 * map),
  skillRate: Math.min(1, 0.35 + 0.07 * map),
});

// 盤面と盤面の間の回復（体力の最大に対する％）
export const BOARD_HEAL = 20;
// ライフ：1マップに3つ。落ちても2回までは盤面に戻れる
// 戻ったとき、体力は最大の RESPAWN_HP ％ になる（それより多く残っていれば、そのまま）
export const LIVES = 3;
export const RESPAWN_HP = 100;

// 絵の具の水たまり（破天荒編）。r：円の水たまりの半径（直径は15cm定規の長さくらい）
// 赤：すべりにくい・青：よくすべる（上を通っている間だけ。物理は physics.js の PAINT_FRICTION）
// 緑：番を終えたときに上にいると体力+heal（回復したら消える）・黄：番を終えたときに上にいると体力−hurt（消えない）
export const PAINT = {
  r: 8.5, splashR: 6, trailW: 1.1, trailDry: 3, heal: 8, hurt: 5, maxPools: 12, maxTrails: 3,
  eventNear: 12, // 場のイベントの落雷：1か所目は、自分の定規からこの距離（cm）までの間に散らして予告する（ボスより狙いがあまい）
  colors: {
    red: { name: '赤', color: '#e0483a', desc: 'すべりにくい' },
    blue: { name: '青', color: '#2f7fd6', desc: 'よくすべる' },
    green: { name: '緑', color: '#3fae5a', desc: '番の終わりに上にいると体力+8（回復したら消える）' },
    yellow: { name: '黄', color: '#e8b818', desc: '番の終わりに上にいると体力−5' },
  },
};
export const PAINT_COLORS = Object.keys(PAINT.colors);

// 敵1体の名前と見た目の色（定規は形と素材から）
const SHORT = { straight30: '30cm定規', straight15: '15cm定規', tri45: '三角定規45°', tri60: '三角定規60°', protractor: '分度器' };
const MAT = { acrylic: 'アクリル', metal: 'メタル', rubber: 'ラバー' };
const MAT_COLOR = { acrylic: '#2f9fd8', metal: '#b8892a', rubber: '#d0457f' };
export function enemyLook(e) {
  const d = ENEMIES[e.t];
  if (e.t === 'ruler') {
    const r = Physics.RULERS[e.spec];
    return { name: r ? `${MAT[r.mat]}の${SHORT[r.shape] || '定規'}` : '定規', color: MAT_COLOR[r?.mat] || d.color };
  }
  if (e.t === 'brush' && PAINT.colors[e.c]) return { name: `${PAINT.colors[e.c].name}の筆`, color: PAINT.colors[e.c].color };
  return { name: d.name, color: d.color };
}

// ---- マップ ----
// desk：机の並べ方（rules.js の DESKS）、tiles：使う机（省くと全部）
// me：自分の定規の初めの位置、foes：敵 { t: 種類, x, y, a（向き）, spec（定規のときの形×素材） }
const V = Math.PI / 2; // 縦向き
export const STAGES = {
  kahen: {
    name: '可変定規編',
    short: '可変定規',
    place: '教室',
    lead: '教室の机で、文房具と敵の定規を相手に戦う',
    boss: '折りたたみ定規',
    reward: 'ruler:folding-acrylic',
    maps: [
      {
        name: 'はじめての消しゴム', note: '消しゴムは動かないが、そばにいると削ってくる',
        boards: [
          { desk: 'single', me: { x: -18, y: 0, a: V }, foes: [{ t: 'eraser', x: 12, y: 0, a: V }] },
          { desk: 'single', me: { x: -18, y: 0, a: V }, foes: [{ t: 'eraser', x: 10, y: -10, a: 0.4 }, { t: 'eraser', x: 15, y: 10, a: -0.3 }] },
          { desk: 'single', me: { x: -18, y: 0, a: V }, foes: [{ t: 'pencil', x: 17, y: -4, a: V }, { t: 'eraser', x: 8, y: 13, a: 0 }] },
        ],
      },
      {
        name: '鉛筆の突撃', note: '鉛筆は軽くてよくすべる。反撃に気をつけて',
        boards: [
          { desk: 'single', me: { x: -20, y: 0, a: V }, foes: [{ t: 'pencil', x: 16, y: -8, a: V }, { t: 'eraser', x: 14, y: 11, a: 0.2 }] },
          { desk: 'single', me: { x: -20, y: 0, a: V }, foes: [{ t: 'clip', x: 14, y: 0, a: 0.5 }, { t: 'clip', x: 22, y: -12, a: -0.4 }] },
          { desk: 'single', me: { x: -20, y: 0, a: V }, foes: [{ t: 'pencil', x: 14, y: -11, a: V }, { t: 'pencil', x: 17, y: 10, a: V }, { t: 'eraser', x: 25, y: 0, a: V }] },
        ],
      },
      {
        name: '画びょうに注意', note: '画びょうはぶつかるとトゲでダメージ。最後はホチキス',
        boards: [
          { desk: 'pair', me: { x: -25, y: 0, a: V }, foes: [{ t: 'tack', x: 0, y: 0 }, { t: 'clip', x: 24, y: -16, a: 0.3 }, { t: 'eraser', x: 26, y: 16, a: V }] },
          { desk: 'pair', me: { x: -25, y: 0, a: V }, foes: [{ t: 'pencil', x: 22, y: -18, a: V }, { t: 'pencil', x: 24, y: 18, a: V }, { t: 'tack', x: 4, y: -9 }, { t: 'tack', x: 4, y: 9 }] },
          { desk: 'pair', me: { x: -25, y: 0, a: V }, foes: [{ t: 'stapler', x: 22, y: 0, a: V }, { t: 'eraser', x: 30, y: 22, a: 0 }] },
        ],
      },
      {
        name: 'ねばるのり', note: 'のりの周りでは定規が止まりやすい。修正テープは仲間を直す',
        boards: [
          { desk: 'pair', me: { x: -26, y: 0, a: V }, foes: [{ t: 'glue', x: 16, y: 0, a: V }, { t: 'pencil', x: 28, y: -20, a: V }, { t: 'pencil', x: 28, y: 20, a: V }] },
          { desk: 'pair', me: { x: -26, y: 0, a: V }, foes: [{ t: 'tape', x: 30, y: 0, a: V }, { t: 'clip', x: 16, y: -14, a: 0.2 }, { t: 'clip', x: 16, y: 14, a: -0.2 }] },
          { desk: 'pair', me: { x: -26, y: 0, a: V }, foes: [{ t: 'ruler', spec: 'straight15-acrylic', x: 22, y: 0, a: V }, { t: 'glue', x: 6, y: -18, a: 0 }, { t: 'eraser', x: 30, y: 22, a: 0 }] },
        ],
      },
      {
        name: '横一列の廊下', note: '細長い机。コンパスのそばは近づくと弾き飛ばされる',
        boards: [
          { desk: 'row3', me: { x: -72, y: 0, a: 0 }, foes: [{ t: 'pencil', x: -20, y: 8, a: 0 }, { t: 'eraser', x: 15, y: -10, a: 0 }, { t: 'compass', x: 45, y: 0 }] },
          { desk: 'row3', me: { x: -72, y: 0, a: 0 }, foes: [{ t: 'stapler', x: 10, y: 0, a: V }, { t: 'tape', x: 55, y: 0, a: V }, { t: 'tack', x: -35, y: 10 }] },
          { desk: 'row3', me: { x: -72, y: 0, a: 0 }, foes: [{ t: 'ruler', spec: 'tri60-acrylic', x: 25, y: -6, a: 0 }, { t: 'ruler', spec: 'straight30-rubber', x: 62, y: 6, a: V }, { t: 'eraser', x: -30, y: -12, a: 0 }] },
        ],
      },
      {
        name: 'L字の机', note: '角のある机。曲がり角を使って当てよう',
        boards: [
          { desk: 'group', tiles: [0, 2, 3], me: { x: -34, y: -24, a: 0 }, foes: [{ t: 'clip', x: -32, y: 22, a: 0.4 }, { t: 'clip', x: 30, y: 20, a: -0.3 }, { t: 'tack', x: 0, y: 24 }] },
          { desk: 'group', tiles: [0, 2, 3], me: { x: -34, y: -24, a: 0 }, foes: [{ t: 'glue', x: -32, y: 20, a: 0 }, { t: 'stapler', x: 30, y: 22, a: 0 }, { t: 'eraser', x: 50, y: 34, a: V }] },
          { desk: 'group', tiles: [0, 2, 3], me: { x: -34, y: -24, a: 0 }, foes: [{ t: 'ruler', spec: 'tri45-acrylic', x: 28, y: 18, a: 0 }, { t: 'tape', x: 50, y: 32, a: 0 }, { t: 'pencil', x: -30, y: 26, a: 0 }] },
        ],
      },
      {
        name: '班の机', note: '4台の大きな机。重いホチキスが2つ',
        boards: [
          { desk: 'group', me: { x: -40, y: 0, a: V }, foes: [{ t: 'compass', x: 0, y: 0 }, { t: 'pencil', x: 40, y: -25, a: V }, { t: 'pencil', x: 40, y: 25, a: V }, { t: 'eraser', x: -36, y: 30, a: 0 }] },
          { desk: 'group', me: { x: -40, y: 0, a: V }, foes: [{ t: 'stapler', x: 32, y: -20, a: V }, { t: 'stapler', x: 32, y: 20, a: V }] },
          { desk: 'group', me: { x: -40, y: 0, a: V }, foes: [{ t: 'ruler', spec: 'protractor-metal', x: 26, y: 0, a: -V }, { t: 'ruler', spec: 'straight15-rubber', x: 40, y: -30, a: 0 }, { t: 'tape', x: 48, y: 30, a: 0 }] },
        ],
      },
      {
        name: '6台の教室', note: '広い机。追いかけっこになる',
        boards: [
          { desk: 'grid6', me: { x: -75, y: 0, a: V }, foes: [{ t: 'tack', x: -20, y: -15 }, { t: 'tack', x: -20, y: 15 }, { t: 'clip', x: 40, y: -20, a: 0.3 }, { t: 'clip', x: 60, y: 22, a: -0.5 }] },
          { desk: 'grid6', tiles: [0, 2, 3, 4, 5], me: { x: -75, y: 20, a: V }, foes: [{ t: 'glue', x: 0, y: 25, a: 0 }, { t: 'stapler', x: 65, y: -20, a: V }, { t: 'compass', x: 40, y: 20 }] },
          { desk: 'grid6', me: { x: -75, y: 0, a: V }, foes: [{ t: 'ruler', spec: 'tri45-rubber', x: 30, y: -18, a: 0 }, { t: 'ruler', spec: 'straight30-metal', x: 55, y: 18, a: V }, { t: 'tape', x: 80, y: 0, a: V }] },
        ],
      },
      {
        name: 'ロの字の机', note: '真ん中に穴のあいた机。落とし穴に気をつけて',
        boards: [
          { desk: 'grid9', tiles: [0, 1, 2, 3, 5, 6, 7, 8], me: { x: -70, y: -45, a: 0 }, foes: [{ t: 'pencil', x: 30, y: -48, a: 0 }, { t: 'pencil', x: 70, y: 10, a: V }, { t: 'pencil', x: -10, y: 50, a: 0 }, { t: 'compass', x: -70, y: 30 }] },
          { desk: 'grid9', tiles: [0, 1, 2, 3, 5, 6, 7, 8], me: { x: -70, y: -45, a: 0 }, foes: [{ t: 'stapler', x: 70, y: -40, a: V }, { t: 'ruler', spec: 'protractor-acrylic', x: 70, y: 40, a: 0 }, { t: 'tape', x: 0, y: 52, a: 0 }] },
          { desk: 'grid9', tiles: [0, 1, 2, 3, 5, 6, 7, 8], me: { x: -70, y: -45, a: 0 }, foes: [{ t: 'ruler', spec: 'tri60-metal', x: 20, y: -50, a: 0 }, { t: 'ruler', spec: 'straight15-acrylic', x: 72, y: 20, a: V }, { t: 'glue', x: -40, y: 50, a: 0 }, { t: 'tack', x: 30, y: 48 }] },
        ],
      },
      {
        name: '折りたたみ定規', note: '5つの盤面を勝ち抜くと、ラスボスの折りたたみ定規が待っている',
        boards: [
          { desk: 'pair', me: { x: -26, y: 0, a: V }, foes: [{ t: 'pencil', x: 20, y: -18, a: V }, { t: 'pencil', x: 20, y: 18, a: V }, { t: 'clip', x: 32, y: 0, a: 0.4 }] },
          { desk: 'row3', me: { x: -72, y: 0, a: 0 }, foes: [{ t: 'stapler', x: 0, y: 0, a: V }, { t: 'compass', x: 40, y: 0 }, { t: 'tape', x: 75, y: 0, a: V }] },
          { desk: 'group', tiles: [0, 2, 3], me: { x: -34, y: -24, a: 0 }, foes: [{ t: 'ruler', spec: 'straight30-acrylic', x: -30, y: 25, a: 0 }, { t: 'ruler', spec: 'tri60-acrylic', x: 25, y: 20, a: 0 }, { t: 'ruler', spec: 'tri45-acrylic', x: 50, y: 32, a: 0 }] },
          { desk: 'group', me: { x: -40, y: 0, a: V }, foes: [{ t: 'stapler', x: 30, y: -22, a: V }, { t: 'stapler', x: 30, y: 22, a: V }, { t: 'glue', x: 52, y: 0, a: V }, { t: 'tape', x: -20, y: 32, a: 0 }] },
          { desk: 'group', boss: true, me: { x: -42, y: 0, a: V }, foes: [{ t: 'boss', x: 20, y: 0, a: V }, { t: 'tape', x: 50, y: 30, a: 0 }] },
        ],
      },
    ],
  },
};
// 破天荒編（図工室）：絵の具の水たまり・筆・パレット・はさみ・U字磁石。マップ7からは敵の定規と落雷（場のイベント）
// pools：はじめから机にある水たまり { c: 色, x, y }。bolts（マップ）：1周ごとに予告する落雷の数（場のイベント）
// 難しさ（diff）：前半は可変定規編と同じ、後半（7〜10）はやさしめ
const H = Math.PI; // 逆向き
STAGES.hatenko = {
  name: '破天荒編',
  short: '破天荒',
  place: '図工室',
  lead: '図工室の机で、絵の具の水たまり・筆・パレット・はさみ・U字磁石、そして落雷',
  boss: '雷雲の雲形定規',
  reward: 'ruler:cloud-acrylic',
  diff: [1, 2, 3, 4, 5, 6, 5, 5.5, 6, 6.5],
  maps: [
    {
      name: '赤と青の水たまり', note: '赤い水たまりの上はすべりにくく、青い水たまりの上はよくすべる',
      boards: [
        { desk: 'single', me: { x: -18, y: 0, a: V }, pools: [{ c: 'red', x: 2, y: -9 }, { c: 'blue', x: 8, y: 11 }], foes: [{ t: 'eraser', x: 15, y: 0, a: V }] },
        { desk: 'single', me: { x: -18, y: 0, a: V }, pools: [{ c: 'blue', x: -2, y: 2 }, { c: 'red', x: 20, y: -11 }], foes: [{ t: 'pencil', x: 16, y: -6, a: V }, { t: 'eraser', x: 15, y: 12, a: 0 }] },
        { desk: 'pair', me: { x: -26, y: 0, a: V }, pools: [{ c: 'blue', x: -4, y: -16 }, { c: 'blue', x: 6, y: 16 }, { c: 'red', x: 24, y: 0 }], foes: [{ t: 'pencil', x: 18, y: -18, a: V }, { t: 'pencil', x: 20, y: 18, a: V }, { t: 'eraser', x: 31, y: 0, a: V }] },
      ],
    },
    {
      name: '緑と黄の水たまり', note: '番の終わりに緑の上にいると体力が回復し、黄の上にいると減る。敵にも同じように効く',
      boards: [
        { desk: 'single', me: { x: -18, y: 0, a: V }, pools: [{ c: 'green', x: -14, y: -12 }, { c: 'yellow', x: 5, y: 0 }], foes: [{ t: 'eraser', x: 17, y: -9, a: V }, { t: 'eraser', x: 17, y: 10, a: V }] },
        { desk: 'pair', me: { x: -26, y: 0, a: V }, pools: [{ c: 'yellow', x: 0, y: 0 }, { c: 'green', x: -28, y: -20 }, { c: 'yellow', x: 24, y: -18 }], foes: [{ t: 'clip', x: 20, y: -6, a: 0.4 }, { t: 'pencil', x: 22, y: 18, a: V }] },
        { desk: 'pair', me: { x: -26, y: 0, a: V }, pools: [{ c: 'green', x: -30, y: 22 }, { c: 'yellow', x: -2, y: -16 }, { c: 'yellow', x: 10, y: 16 }, { c: 'red', x: 26, y: 0 }], foes: [{ t: 'pencil', x: 18, y: -16, a: V }, { t: 'clip', x: 28, y: 4, a: -0.3 }, { t: 'eraser', x: 30, y: 22, a: V }] },
      ],
    },
    {
      name: '走る筆', note: '筆が動いた跡には、その筆の色の細い水たまりが残る（3周で乾く）',
      boards: [
        { desk: 'single', me: { x: -18, y: 0, a: V }, foes: [{ t: 'brush', c: 'red', x: 14, y: -8, a: V }, { t: 'eraser', x: 17, y: 12, a: 0 }] },
        { desk: 'pair', me: { x: -26, y: 0, a: V }, pools: [{ c: 'green', x: -26, y: 22 }], foes: [{ t: 'brush', c: 'blue', x: 18, y: -18, a: V }, { t: 'brush', c: 'yellow', x: 20, y: 18, a: V }] },
        { desk: 'pair', me: { x: -26, y: 0, a: V }, pools: [{ c: 'blue', x: -8, y: -18 }], foes: [{ t: 'brush', c: 'red', x: 14, y: 0, a: V }, { t: 'brush', c: 'green', x: 26, y: -20, a: V }, { t: 'clip', x: 30, y: 18, a: 0.3 }] },
      ],
    },
    {
      name: 'パレットの絵の具', note: 'パレットに当てると、まわりに絵の具がはねて水たまりになる',
      boards: [
        { desk: 'pair', me: { x: -26, y: 0, a: V }, foes: [{ t: 'palette', x: 8, y: 0 }, { t: 'pencil', x: 24, y: -18, a: V }, { t: 'pencil', x: 24, y: 18, a: V }] },
        { desk: 'group', me: { x: -40, y: 0, a: V }, foes: [{ t: 'palette', x: 0, y: -18 }, { t: 'palette', x: 2, y: 22 }, { t: 'brush', c: 'red', x: 40, y: 0, a: V }, { t: 'eraser', x: 46, y: -30, a: 0 }] },
        { desk: 'group', me: { x: -40, y: 0, a: V }, pools: [{ c: 'yellow', x: -12, y: 28 }], foes: [{ t: 'palette', x: 10, y: 0 }, { t: 'stapler', x: 40, y: -22, a: V }, { t: 'brush', c: 'blue', x: 40, y: 24, a: V }] },
      ],
    },
    {
      name: 'U字磁石', note: '細長い机。磁石の近くでは、定規が少しずつ引き寄せられる（メタルの定規は2倍）',
      boards: [
        { desk: 'row3', me: { x: -72, y: 0, a: 0 }, foes: [{ t: 'magnet', x: 0, y: 0, a: H }, { t: 'pencil', x: 35, y: -10, a: 0 }, { t: 'clip', x: 62, y: 8, a: 0 }] },
        { desk: 'row3', me: { x: -72, y: 0, a: 0 }, pools: [{ c: 'blue', x: 8, y: 0 }], foes: [{ t: 'magnet', x: -25, y: 0, a: H }, { t: 'magnet', x: 42, y: 0, a: H }, { t: 'stapler', x: 66, y: 0, a: V }] },
        { desk: 'group', me: { x: -40, y: 0, a: V }, foes: [{ t: 'magnet', x: 0, y: 0, a: H }, { t: 'stapler', x: 38, y: -22, a: V }, { t: 'brush', c: 'red', x: 40, y: 24, a: V }, { t: 'clip', x: -30, y: 32, a: 0 }] },
      ],
    },
    {
      name: 'はさみの刃', note: 'L字の机。開いたはさみの刃の間で番を終えると、次にはじく力が半分になる',
      boards: [
        { desk: 'group', tiles: [0, 2, 3], me: { x: -34, y: -24, a: 0 }, foes: [{ t: 'scissors', x: -32, y: 18, a: -V }, { t: 'pencil', x: 30, y: 20, a: 0 }, { t: 'clip', x: 50, y: 32, a: 0 }] },
        { desk: 'group', tiles: [0, 2, 3], me: { x: -34, y: -24, a: 0 }, foes: [{ t: 'scissors', x: 2, y: 24, a: H }, { t: 'scissors', x: 44, y: 18, a: 0 }, { t: 'brush', c: 'blue', x: -32, y: 26, a: 0 }, { t: 'eraser', x: 54, y: 34, a: V }] },
        { desk: 'grid6', me: { x: -75, y: 0, a: V }, foes: [{ t: 'scissors', x: -30, y: 0, a: H }, { t: 'magnet', x: 30, y: -20, a: H }, { t: 'palette', x: 30, y: 22 }, { t: 'pencil', x: 75, y: 0, a: V }] },
      ],
    },
    {
      name: '雷の前ぶれ', note: '敵の定規が初めて出てくる。1周ごとに、どこか1か所に落雷が予告され、次の周の初めに落ちる', bolts: 1,
      boards: [
        { desk: 'pair', me: { x: -26, y: 0, a: V }, pools: [{ c: 'blue', x: 0, y: 18 }], foes: [{ t: 'ruler', spec: 'straight15-acrylic', x: 20, y: 0, a: V }, { t: 'brush', c: 'red', x: 28, y: -22, a: V }] },
        { desk: 'group', me: { x: -40, y: 0, a: V }, foes: [{ t: 'ruler', spec: 'tri45-rubber', x: 30, y: -20, a: 0 }, { t: 'palette', x: 10, y: 22 }, { t: 'eraser', x: 46, y: 30, a: 0 }] },
        { desk: 'grid6', me: { x: -75, y: 0, a: V }, foes: [{ t: 'ruler', spec: 'straight30-acrylic', x: 50, y: -20, a: V }, { t: 'scissors', x: 0, y: 0, a: H }, { t: 'eraser', x: 62, y: 24, a: 0 }] },
      ],
    },
    {
      name: '雷が2つ', note: '1周ごとに2か所の落雷。これまでの敵と水たまりの組み合わせ', bolts: 2,
      boards: [
        { desk: 'group', me: { x: -40, y: 0, a: V }, pools: [{ c: 'red', x: -20, y: 26 }], foes: [{ t: 'ruler', spec: 'protractor-acrylic', x: 30, y: 0, a: -V }, { t: 'magnet', x: 2, y: -26, a: H }, { t: 'brush', c: 'yellow', x: 42, y: 30, a: V }] },
        { desk: 'grid6', tiles: [0, 2, 3, 4, 5], me: { x: -75, y: 20, a: V }, foes: [{ t: 'ruler', spec: 'straight15-rubber', x: 40, y: -20, a: V }, { t: 'palette', x: 0, y: 25 }, { t: 'scissors', x: 62, y: 22, a: H }, { t: 'brush', c: 'blue', x: 78, y: -26, a: V }] },
        { desk: 'row3', me: { x: -72, y: 0, a: 0 }, pools: [{ c: 'green', x: -50, y: 10 }, { c: 'yellow', x: 40, y: -12 }], foes: [{ t: 'ruler', spec: 'tri45-acrylic', x: 20, y: 0, a: 0 }, { t: 'ruler', spec: 'straight30-rubber', x: 64, y: 6, a: V }, { t: 'magnet', x: -22, y: 0, a: H }] },
      ],
    },
    {
      name: '図工室の総まとめ', note: '真ん中に穴のあいたロの字の机。水たまり・筆・パレット・はさみ・磁石と、敵の定規',
      boards: [
        { desk: 'grid9', tiles: [0, 1, 2, 3, 5, 6, 7, 8], me: { x: -70, y: -45, a: 0 }, foes: [{ t: 'brush', c: 'red', x: 30, y: -48, a: 0 }, { t: 'brush', c: 'blue', x: 70, y: 10, a: V }, { t: 'palette', x: -10, y: 50 }, { t: 'magnet', x: -70, y: 30, a: -V }] },
        { desk: 'grid9', tiles: [0, 1, 2, 3, 5, 6, 7, 8], me: { x: -70, y: -45, a: 0 }, pools: [{ c: 'blue', x: -38, y: -48 }, { c: 'yellow', x: 40, y: 48 }], foes: [{ t: 'ruler', spec: 'tri60-acrylic', x: 70, y: -40, a: V }, { t: 'scissors', x: 70, y: 40, a: -V }, { t: 'palette', x: 0, y: 52 }] },
        { desk: 'grid9', tiles: [0, 1, 2, 3, 5, 6, 7, 8], me: { x: -70, y: -45, a: 0 }, foes: [{ t: 'ruler', spec: 'straight30-metal', x: 20, y: -50, a: 0 }, { t: 'ruler', spec: 'protractor-rubber', x: 72, y: 20, a: V }, { t: 'magnet', x: -40, y: 50, a: 0 }, { t: 'brush', c: 'green', x: 40, y: 48, a: 0 }] },
      ],
    },
    {
      name: '雷雲の雲形定規', note: '4つの盤面を勝ち抜くと、5つ目でラスボスの雷雲の雲形定規が待っている',
      boards: [
        { desk: 'pair', me: { x: -26, y: 0, a: V }, foes: [{ t: 'brush', c: 'red', x: 20, y: -18, a: V }, { t: 'brush', c: 'blue', x: 20, y: 18, a: V }, { t: 'palette', x: 32, y: 0 }] },
        { desk: 'row3', me: { x: -72, y: 0, a: 0 }, foes: [{ t: 'magnet', x: 0, y: 0, a: H }, { t: 'scissors', x: 40, y: 0, a: H }, { t: 'ruler', spec: 'tri45-metal', x: 74, y: 0, a: V }] },
        { desk: 'group', tiles: [0, 2, 3], me: { x: -34, y: -24, a: 0 }, foes: [{ t: 'ruler', spec: 'straight30-acrylic', x: -30, y: 25, a: 0 }, { t: 'ruler', spec: 'tri60-rubber', x: 25, y: 20, a: 0 }, { t: 'brush', c: 'yellow', x: 50, y: 32, a: 0 }] },
        { desk: 'group', me: { x: -40, y: 0, a: V }, foes: [{ t: 'palette', x: 0, y: 0 }, { t: 'ruler', spec: 'straight15-acrylic', x: 32, y: -22, a: V }, { t: 'ruler', spec: 'protractor-metal', x: 32, y: 22, a: V }, { t: 'magnet', x: -22, y: 32, a: H }] },
        { desk: 'group', boss: true, me: { x: -42, y: 0, a: V }, pools: [{ c: 'blue', x: -10, y: -26 }, { c: 'red', x: -8, y: 28 }], foes: [{ t: 'cloud', x: 24, y: 0, a: 0 }, { t: 'palette', x: 48, y: 30 }] },
      ],
    },
  ],
};
export const STAGE_ORDER = ['kahen', 'hatenko'];

// クリアの報酬：経験値（クリアのたび）とえんぴつ（初クリアだけ）。マップ番号は1から
export const REWARD = {
  exp: (map) => 20 + map * 8 + (map === 10 ? 50 : 0),
  coins: (map) => map * 10 + (map === 10 ? 50 : 0),
};

export function mapOf(stageId, map) {
  return STAGES[stageId]?.maps[map - 1] || null;
}

// 机の並べ方の呼び名（tiles：使う机）
const DESK_LABEL = { single: '机1台', pair: '机2台', group: '机4台', row3: '横一列3台', grid6: '机6台', grid9: '机9台' };
export function deskText(b) {
  const d = DESKS[b.desk];
  const n = b.tiles ? b.tiles.length : d.cols * d.rows;
  if (b.desk === 'group' && n === 3) return 'L字の机';
  if (b.desk === 'grid9' && n === 8) return 'ロの字の机';
  if (n < d.cols * d.rows) return `机${n}台`;
  return DESK_LABEL[b.desk] || d.name;
}
