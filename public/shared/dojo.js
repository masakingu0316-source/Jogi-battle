// バトル道場：クラス30人に出席番号順に1人ずつ挑み、全員に勝つ「30人破り」を目指す1人用モード。
// 30人破りのあとは、担任の先生（31人目）に挑める。ここはクラスメイトのデータと、強さ・くせの決まりだけ（画面とサーバーで共有）。
//
// クラスメイト1人 = {
//   id, no（出席番号。先生は31）, name, role（係・委員会）, rank（'' | 'leader' 班長 | 'president' 学級委員長 | 'teacher' 担任）,
//   ruler（使う定規の銘柄ID。先生は TEACHER_RULER）, skill（道場での必殺技。'' は定規の技、'none' は使わない）, level（定規のLv）,
//   style（くせ）, skillUse（必殺技の使い方）, aim（狙いのずれ ±度）, powerErr（力加減の誤差 ±%）, samples（試すはじき方の数）,
//   lines: { enter（登場）, win（勝ったとき）, lose（負けたとき） }, reward（初めて勝ったときにもらえる持ち物のID）, avatar（見た目）
// }
// 設定画面で、全員の項目を変えられる（設定の classmates）。
import { SKILLS } from './rules.js';
import { sanitizeAvatar, partOf, parsePartId } from './avatar.js';

export const DOJO_SIZE = 30;          // 生徒の数（30人破り）
export const TEACHER_NO = 31;
export const TEACHER_RULER = 'teacher-board'; // 先生の「黒板用の大きな定規」（銘柄ではない。先生だけが使う）
export const TEACHER_SPEC = 'board50-wood';

export const RANKS = {
  '': { name: '' },
  leader: { name: '班長' },
  president: { name: '学級委員長' },
  teacher: { name: '担任' },
};

// ---- くせ（コンピュータの狙い方・力加減の好み） ----
// power：はじく強さの範囲（0〜1）、wSelf：自分が机の端から離れていることの重み、wFoe：相手を端へ寄せる重み、
// wHit：当てて削る重み、wCenter：自分が机の真ん中にいる重み、wFar：相手から離れている重み、chargeMul：必殺ゲージのたまりやすさの倍率、
// target：狙う所（'center' 相手の真ん中・'near' 相手のいちばん近い所・'spread' 相手のどこか）、wide：狙いの向きを大きく散らして試す（跳ね返り）、
// plain：試さずに、まっすぐ1回だけ（考えない）
export const STYLES = {
  normal: { name: '普通', desc: 'ふつうに狙う' },
  precise: { name: '普通（いちばん正確）', desc: 'ふつうに狙う（狙いのずれが小さい人向け）' },
  straight: { name: 'まっすぐ押すだけ', desc: '相手の真ん中へまっすぐ。考えずにはじく', plain: true, power: [0.5, 0.8], target: 'center' },
  soft: { name: '弱めにそっと', desc: '力を入れずに、そっとはじく', power: [0.15, 0.5] },
  near: { name: 'いちばん近い所を狙う', desc: '相手のいちばん近い所へ、短めに当てる', power: [0.3, 0.7], target: 'near' },
  center: { name: '机の真ん中に陣取る', desc: '自分が机の真ん中にいるのを好む', wCenter: 3 },
  strong: { name: '力強め', desc: 'いつも強めにはじく', power: [0.6, 1] },
  allout: { name: 'いつも全力', desc: 'ほぼ全力ではじく', power: [0.88, 1] },
  tap: { name: '弱めに何度も当てる', desc: '弱めに当てて、少しずつ体力を削る', power: [0.2, 0.55], wHit: 2 },
  guard: { name: '守りが固い', desc: '机の端から離れて、落ちないように守る', wSelf: 2.6, power: [0.2, 0.75] },
  retreat: { name: '減ったら下がる', desc: '体力が減ると、机の真ん中へ下がって守る', retreat: true },
  escape: { name: '危なくなると逃げる', desc: '机の端に追いつめられると、真ん中へ逃げる', escape: true },
  push: { name: '端へ押し出す', desc: '相手を机の端へ押し出すのを好む', wFoe: 2.2 },
  wait: { name: '待って打ち返す', desc: '相手が近づくまでは小さく動き、近くに来たら強く返す', wait: true },
  charge: { name: 'ゲージをためる', desc: '必殺ゲージが1.5倍たまりやすい（1周ごと）。当てて削るのも好む', chargeMul: 1.5, wHit: 1.4 },
  bank: { name: '跳ね返りを使う', desc: '向きを大きく散らして、跳ね返りで当てる手も試す', wide: true },
  far: { name: '遠くから強く当てる', desc: '相手から離れた所から、強く当てる', wFar: 1.5, power: [0.6, 1] },
  front: { name: '正面から一直線', desc: '相手の真ん中へ、正面から', target: 'center' },
  corner: { name: '角で狙う', desc: '定規の角が先に当たるはじき方を多く試す', corner: true },
};
// 必殺技の使い方
export const SKILL_USES = {
  none: { name: '使わない' },
  asap: { name: 'たまったらすぐ使う' },
  pick: { name: 'タイミングを選ぶ' },
};

// ---- 道場だけの持ち物 ----
// 班長に勝つともらえる定規の柄（ガチャには出ない）
export const DOJO_PATTERNS = [
  { id: 'pattern:sakura', kind: 'pattern', rarity: 'R', name: '桜', dojo: true },
  { id: 'pattern:asanoha', kind: 'pattern', rarity: 'R', name: '麻の葉', dojo: true },
  { id: 'pattern:ichimatsu', kind: 'pattern', rarity: 'R', name: '市松', dojo: true },
  { id: 'pattern:yagasuri', kind: 'pattern', rarity: 'SR', name: '矢絣', dojo: true },
  { id: 'pattern:shippo', kind: 'pattern', rarity: 'SR', name: '七宝', dojo: true },
];
// 称号（名札・ホームのアバターの下に出す。着せ替え画面で選ぶ）
export const TITLES = [
  { id: 'title:gakunen', kind: 'title', rarity: 'SSR', name: '学年最強', color: '#c9a13a', dojo: true },
  { id: 'title:sotsugyo', kind: 'title', rarity: 'SSR', name: '卒業', color: '#8e2a24', dojo: true },
];
export const titleOf = (id) => TITLES.find((t) => t.id === id) || null;
// 30人破りを初めて達成したときの報酬（称号と、限定の着せ替え）
export const CLEAR_REWARD = ['title:gakunen', 'avatar:jacket:tasuki', 'avatar:bg:dojo'];

// ---- 強さの段階（初期値）----
// 番号 → { aim（±度）, powerErr（±%）, samples, skillUse, level }。班長は少し強く（ずれ−1°・誤差−2%・試す数+2）
const TIERS = [
  { to: 5, aim: 15, powerErr: 30, samples: 3, skillUse: 'none', level: 1 },
  { to: 10, aim: 12, powerErr: 24, samples: 4, skillUse: 'asap', level: 2 },
  { to: 15, aim: 9, powerErr: 18, samples: 6, skillUse: 'asap', level: 4 },
  { to: 20, aim: 7, powerErr: 14, samples: 8, skillUse: 'pick', level: 6 },
  { to: 25, aim: 5, powerErr: 10, samples: 10, skillUse: 'pick', level: 8 },
  { to: 29, aim: 3, powerErr: 7, samples: 12, skillUse: 'pick', level: 9 },
  { to: 30, aim: 2, powerErr: 5, samples: 14, skillUse: 'pick', level: 10 },
  { to: 31, aim: 1.5, powerErr: 4, samples: 16, skillUse: 'pick', level: 10 },
];
export const tierOf = (no) => TIERS.find((t) => no <= t.to) || TIERS[TIERS.length - 1];
// 班（1〜6班。先生は0）
export const hanOf = (no) => (no > DOJO_SIZE ? 0 : Math.ceil(no / 5));

// 見た目：[肌, 髪型, 髪の色, 目, 服, { ほかの部位 }]
// 番号, 名前, 係, 定規, 必殺技（'' は定規の技）, くせ, もらえる物, 登場のせりふ, 見た目
const N = (no, name, role, ruler, skill, style, reward, enter, look) => ({ no, name, role, ruler, skill, style, reward, enter, look });
const RAW = [
  // 1班（N定規・必殺技なし）
  N(1, '相川 そうた', '黒板係', 'ruler:straight30-acrylic', 'none', 'straight', ['avatar:jacket:chalk'], 'よーし、1番いくぞ！', ['s2', 'short', 'sumi', 'maru', 'gakuran']),
  N(2, '石田 ゆい', '生き物係', 'ruler:straight15-rubber', 'none', 'soft', ['avatar:item:kingyo'], 'そーっとね、そーっと', ['s1', 'bob', 'kuri', 'nikko', 'sailor']),
  N(3, '上野 はると', '給食係', 'ruler:tri45-metal', 'none', 'near', ['avatar:head:kyushoku'], 'おなかすいた…早く終わらせよ', ['s3', 'short', 'kogecha', 'tare', 'gym']),
  N(4, '江口 みお', '掲示係', 'ruler:protractor-acrylic', 'none', 'center', ['avatar:head:gabyo'], 'ここ、わたしの場所ね', ['s2', 'long', 'sumi', 'kiri', 'blazer']),
  N(5, '大森 りく', '号令係', 'ruler:straight30-metal', 'none', 'strong', ['avatar:item:whistle', 'pattern:sakura'], '起立！礼！勝負！', ['s4', 'spiky', 'sumi', 'kiri', 'gakuran']),
  // 2班（N定規・必殺技はたまったらすぐ使う。技は道場だけの割り当て）
  N(6, '加藤 あおい', '保健係', 'ruler:tri60-rubber', 'heal', 'retreat', ['avatar:face:hokenban'], 'けがしないでね？', ['s1', 'pony', 'kurumi', 'tare', 'sailor']),
  N(7, '木村 けんた', '体育係', 'ruler:straight30-rubber', 'heavy', 'allout', ['avatar:head:akashiro'], '全力でいくぜ！', ['s3', 'spiky', 'kogecha', 'maru', 'gym']),
  N(8, '久保 ひなた', '音楽係', 'ruler:straight15-acrylic', 'double', 'tap', ['avatar:item:recorder'], 'トン・トン・トンのリズムでね', ['s2', 'bun', 'ama', 'nikko', 'blazer']),
  N(9, '小池 こはる', '図書委員', 'ruler:tri45-acrylic', 'anchor', 'guard', ['avatar:face:marumegane'], '静かにしてくれる？', ['s1', 'long', 'ai', 'jito', 'sailor']),
  N(10, '佐々木 だいち', '放送委員', 'ruler:protractor-metal', 'bomb', 'normal', ['avatar:head:headphone', 'pattern:asanoha'], 'お昼の放送の時間です。…勝負！', ['s3', 'short', 'kuri', 'kiri', 'gakuran']),
  // 3班（R定規）
  N(11, '清水 つむぎ', '手芸部', 'ruler:r-chara60', '', 'guard', ['avatar:jacket:muffler'], 'ちくちく縫うみたいに、じわじわね', ['s2', 'bun', 'kuri', 'nikko', 'blazer']),
  N(12, '杉本 れん', '時間係', 'ruler:r-pencase15', '', 'escape', ['avatar:item:stopwatch'], 'あと3分で決める', ['s1', 'short', 'ai', 'jito', 'blazer']),
  N(13, '関 さくら', '美化委員', 'ruler:r-color-prot', '', 'push', ['avatar:head:sankakukin'], '机の上、ぴかぴかにしてあげる', ['s3', 'pony', 'enji', 'maru', 'gym']),
  N(14, '高橋 ゆうま', '卓球部', 'ruler:r-name30', '', 'wait', ['avatar:item:racket'], '打ってきなよ、返すから', ['s4', 'spiky', 'kuri', 'kiri', 'gym']),
  N(15, '千葉 かえで', '書道部', 'ruler:r-ink15', '', 'normal', ['avatar:face:sumi', 'pattern:ichimatsu'], '一筆で決める', ['s1', 'long', 'sumi', 'jito', 'sailor']),
  // 4班（R・SR定規・必殺技のタイミングを選ぶ）
  N(16, '土屋 いぶき', '園芸係', 'ruler:r-twotone45', '', 'guard', ['avatar:head:mugiwara'], '芽が出るまで、じっくり', ['s3', 'bob', 'kurumi', 'nikko', 'gym']),
  N(17, '寺田 しおり', '学級文庫係', 'ruler:sr-grip45', '', 'guard', ['avatar:item:bunko'], 'ここに、しおりをはさんでおくね', ['s2', 'long', 'kogecha', 'tare', 'blazer']),
  N(18, '中村 たける', '陸上部', 'ruler:sr-steel15', '', 'push', ['avatar:jacket:zekken'], 'よーい、ドン！', ['s5', 'short', 'sumi', 'kiri', 'gym']),
  N(19, '西川 なつみ', '新聞係', 'ruler:sr-draft60', '', 'charge', ['avatar:head:enpitsu'], '今日の一面は、わたしの勝ち', ['s2', 'bob', 'enji', 'kira', 'sailor']),
  N(20, '野口 しゅん', '理科係', 'ruler:sr-full-prot', '', 'normal', ['avatar:jacket:hakui', 'pattern:yagasuri'], '計算どおりだ', ['s1', 'short', 'ama', 'jito', 'blazer', { face: 'glasses' }]),
  // 5班（SR定規）
  N(21, '橋本 ほのか', '算数係', 'ruler:sr-grid30', '', 'bank', ['avatar:item:compass'], '角度は…このくらい', ['s2', 'pony', 'ai', 'maru', 'sailor']),
  N(22, '平野 かいと', '将棋部', 'ruler:sr-grip45', '', 'wait', ['avatar:item:sensu'], '待ったは、なしだよ', ['s3', 'short', 'kogecha', 'jito', 'gakuran']),
  N(23, '藤田 めい', '写真部', 'ruler:sr-draft60', '', 'charge', ['avatar:item:camera'], 'はい、チーズ…の間に落とすね', ['s4', 'bob', 'kuri', 'kira', 'blazer']),
  N(24, '星野 そら', '天文部', 'ruler:sr-steel15', '', 'far', ['avatar:head:hoshipin'], '流れ星みたいに飛ばしてあげる', ['s1', 'long', 'ai', 'kira', 'sailor']),
  N(25, '前田 あかり', '応援団', 'ruler:sr-full-prot', '', 'normal', ['avatar:head:oendan', 'pattern:shippo'], 'フレー！フレー！わ・た・し！', ['s3', 'pony', 'sumi', 'kiri', 'gakuran']),
  // 6班（SSR定規）
  N(26, '三浦 ゆうと', 'サッカー部', 'ruler:ssr-karakawa15', '', 'allout', ['avatar:item:ball'], '端まで飛んでも、戻ってくるぜ', ['s4', 'spiky', 'kurumi', 'maru', 'gym']),
  N(27, '村上 りん', '美術部', 'ruler:ssr-raden45', '', 'bank', ['avatar:head:beret'], '線が見えるの。あなたが落ちる線', ['s1', 'bob', 'sumi', 'jito', 'blazer']),
  N(28, '森 あさひ', '剣道部', 'ruler:ssr-makie30', '', 'front', ['avatar:item:shinaibukuro'], '面！…じゃなくて、一文字！', ['s2', 'bun', 'sumi', 'kiri', 'sailor']),
  N(29, '山口 ことね', '茶道部', 'ruler:ssr-urushi60', '', 'corner', ['avatar:head:kanzashi'], '角を立てずに、角で勝つの', ['s2', 'long', 'sumi', 'tare', 'sailor']),
  N(30, '渡辺 みなと', '学級委員長', 'ruler:ssr-kinpaku-prot', '', 'precise', ['avatar:jacket:wanshou'], '全員に勝ったなら、最後はぼくだ', ['s2', 'short', 'sumi', 'kiri', 'gakuran', { face: 'glasses' }]),
  // 担任の先生
  N(31, '墨田 先生', '担任', TEACHER_RULER, 'shizuka', 'precise', ['avatar:outfit:jersey', 'avatar:item:shusseki', 'title:sotsugyo'], '全員に勝ったか。じゃあ、先生とやろう',
    ['s3', 'short', 'ginnezu', 'kiri', 'jersey', { face: 'glasses', bg: 'kokuban' }]),
];

const rankOf = (no) => (no === TEACHER_NO ? 'teacher' : no === DOJO_SIZE ? 'president' : no % 5 === 0 ? 'leader' : '');

function lookOf(r) {
  const [skin, hair, hairColor, eyes, outfit, extra = {}] = r.look;
  const av = { skin, hair, hairColor, eyes, outfit, jacket: null, head: null, face: null, item: null, bg: 'classroom' };
  // もらえるパーツは、その子が身につけている
  for (const id of r.reward) {
    const at = parsePartId(id);
    if (at) av[at.slot] = at.key;
  }
  return { ...av, ...extra };
}

export function defaultClassmates() {
  return RAW.map((r) => {
    const t = tierOf(r.no), rank = rankOf(r.no);
    const lead = rank === 'leader' || rank === 'president';
    return {
      id: r.no === TEACHER_NO ? 'teacher' : `c${String(r.no).padStart(2, '0')}`,
      no: r.no, name: r.name, role: r.role, rank, teacher: r.no === TEACHER_NO,
      ruler: r.ruler, skill: r.skill, level: t.level, style: r.style,
      skillUse: r.skill === 'none' ? 'none' : t.skillUse,
      aim: lead && r.no < DOJO_SIZE ? t.aim - 1 : t.aim,
      powerErr: lead && r.no < DOJO_SIZE ? t.powerErr - 2 : t.powerErr,
      samples: lead && r.no < DOJO_SIZE ? t.samples + 2 : t.samples,
      lines: { enter: r.enter, win: '', lose: '' },
      reward: [...r.reward],
      avatar: lookOf(r),
    };
  });
}

const cleanText = (v, max) => Array.from(String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim()).slice(0, max).join('');
const num = (v, lo, hi, d, step = 1) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.round(Math.max(lo, Math.min(hi, n)) / step) * step;
};
// 持ち物のID として正しいか（itemOk は catalog から渡す：ITEMS にあるか）
const rewardOk = (id, itemOk) => typeof id === 'string' && (itemOk ? itemOk(id) : true);

// 設定（classmates）を整える。足りない人は初期値で埋める（31人そろう）
// opt.isRuler(id)：使える定規か、opt.itemOk(id)：持ち物として正しいか（catalog から渡す）
export function sanitizeClassmates(src, opt = {}) {
  const base = defaultClassmates();
  const map = Object.fromEntries((Array.isArray(src) ? src : []).filter((c) => c && typeof c === 'object').map((c) => [c.id, c]));
  return base.map((d) => {
    const v = map[d.id];
    if (!v) return d;
    const ruler = d.teacher ? TEACHER_RULER : (typeof v.ruler === 'string' && (opt.isRuler ? opt.isRuler(v.ruler) : true) ? v.ruler : d.ruler);
    const skill = v.skill === '' || v.skill === 'none' || (SKILLS[v.skill] && (v.skill !== 'shizuka' || d.teacher)) ? v.skill : d.skill;
    const lines = v.lines && typeof v.lines === 'object' ? v.lines : {};
    const reward = Array.isArray(v.reward) ? [...new Set(v.reward.filter((id) => rewardOk(id, opt.itemOk)))].slice(0, 4) : d.reward;
    return {
      id: d.id, no: d.no, rank: d.rank, teacher: d.teacher,
      name: cleanText(v.name, 16) || d.name,
      role: cleanText(v.role, 12) || d.role,
      ruler, skill: skill ?? d.skill,
      level: num(v.level, 1, 10, d.level),
      style: STYLES[v.style] ? v.style : d.style,
      skillUse: SKILL_USES[v.skillUse] ? v.skillUse : d.skillUse,
      aim: num(v.aim, 0, 45, d.aim, 0.5),
      powerErr: num(v.powerErr, 0, 80, d.powerErr),
      samples: num(v.samples, 1, 40, d.samples),
      lines: {
        enter: cleanText(lines.enter, 40) || d.lines.enter,
        win: cleanText(lines.win, 40),
        lose: cleanText(lines.lose, 40),
      },
      reward,
      avatar: sanitizeAvatar(v.avatar, d.id),
    };
  });
}

// 番号の相手（1〜31）
export function classmateByNo(list, no) {
  return (list || defaultClassmates()).find((c) => c.no === no) || null;
}
// 道場での必殺技（'' は定規の技 → null を返す。呼ぶ側で定規の技を使う）
export const dojoSkillOf = (c) => (c.skill === 'none' ? 'none' : SKILLS[c.skill] ? c.skill : null);

// 見た目の確認用：持ち物のIDから、アバターのパーツか
export const isPartId = (id) => !!parsePartId(id) && !!partOf(parsePartId(id).slot, parsePartId(id).key);
