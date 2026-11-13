// 銘柄・レア度・特性・SSRの必殺技・定規ガチャ・受け取り箱
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../public/shared/core.js';
import {
  ITEMS, resolveLoadout, sanitizeConfig, applyConfig, rulerList, rulerPool, rollRuler, rulerOdds, configProblem,
  defaultConfig, GACHA_POOL, BASIC_RULERS, RULER_GACHA,
} from '../public/shared/catalog.js';
import { SKILLS, skillDesc } from '../public/shared/rules.js';
import Physics from '../public/shared/physics.js';
import { createFakeD1 } from './fake-d1.js';
import * as D from '../src/db.js';

const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function game(ruler, other = 'ruler:straight30-acrylic', opt = {}) {
  const r = new RoomCore('ABCDE', opt.mode || 'quick', Date.now(), { fair: !!opt.fair });
  r.rand = () => 0.99;
  const a = r.join('A').member, b = r.join('B').member;
  r.setLoadout(a.id, resolveLoadout({ ruler, acc: opt.acc }, undefined, opt.level || 1));
  r.setLoadout(b.id, resolveLoadout({ ruler: other }));
  r.handle(a.id, { t: 'ready', on: true }); r.handle(b.id, { t: 'ready', on: true });
  return { r, a, b, g: r.s.game };
}

test('銘柄：N15本・R6本・SR5本・SSR5本と折りたたみ定規・雲形定規。定規は飾りガチャに出ない', () => {
  const list = rulerList();
  const count = (k) => list.filter((it) => it.rarity === k).length;
  assert.deepEqual([count('N'), count('R'), count('SR'), count('SSR')], [15, 6, 5, 7]);
  assert.equal(rulerPool('SSR').length, 5, '折りたたみ定規・雲形定規はガチャに出ない');
  assert.ok(!GACHA_POOL.some((it) => it.kind === 'ruler'));
  assert.deepEqual(BASIC_RULERS.sort(), ['ruler:straight30-acrylic', 'ruler:straight30-metal', 'ruler:straight30-rubber']);
  for (const it of list) {
    assert.ok(SKILLS[it.skill], `${it.name} の必殺技`);
    if (it.rarity === 'SR' || it.rarity === 'SSR') assert.ok(it.trait, `${it.name} の特性`);
    if (it.rarity === 'N' || it.rarity === 'R') assert.equal(it.trait, null);
  }
  assert.equal(ITEMS['ruler:ssr-urushi60'].skill, 'ikkaku');
  assert.equal(ITEMS['ruler:sr-steel15'].trait, 'edge');
  assert.equal(ITEMS['ruler:folding-acrylic'].rarity, 'SSR');
});

test('レア度・レベル・アクセサリは掛け算で効き、公平モードでは消える', () => {
  const n = resolveLoadout({ ruler: 'ruler:straight30-metal' });
  const ssr = resolveLoadout({ ruler: 'ruler:ssr-makie30', acc: 'acc:goldclip' }, undefined, 10);
  assert.equal(n.mods.mass, 1);
  assert.ok(Math.abs(ssr.mods.mass - 1.06 * 1.036 * 1.05) < 1e-3, `${ssr.mods.mass}`);
  const { r, g } = game('ruler:ssr-makie30', undefined, { acc: 'acc:goldclip', level: 10 });
  const body = r.makeBody(g.bodies[0]);
  assert.ok(body.m > Physics.RULERS['straight30-metal'].mass * 1.14, '上限 +16% まで効く');
  const fair = game('ruler:ssr-makie30', undefined, { fair: true, acc: 'acc:goldclip', level: 10 });
  assert.equal(fair.r.makeBody(fair.g.bodies[0]).m, Physics.RULERS['straight30-metal'].mass);
  assert.equal(fair.r.snapshot().fair, true);
  assert.equal(fair.g.bodies[0].trait, 'center', '公平モードでも特性は残る');
});

test('特性：鋭い縁はダメージ、ふんばりはすべりにくさ、重心は飛び方、方眼はゲージ', () => {
  const dmg = (ruler) => {
    const { r, a, g } = game(ruler);
    Object.assign(g.bodies[0], { x: -8, y: 0, a: Math.PI / 2 });
    Object.assign(g.bodies[1], { x: 6, y: 0, a: Math.PI / 2 });
    r.handle(a.id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.5 });
    return 100 - g.bodies[1].hp;
  };
  // 同じ形・素材（15cm メタル）で、特性のある SR と N を比べる。レア度の分（はじく力）も入るので大きめに出る
  assert.ok(dmg('ruler:sr-steel15') > dmg('ruler:straight15-metal'));
  const grip = game('ruler:sr-grip45');
  assert.ok(Math.abs(grip.r.makeBody(grip.g.bodies[0]).mu - Physics.RULERS['tri45-rubber'].mu * 1.08) < 1e-9);
  const center = game('ruler:sr-full-prot');
  const cb = center.r.makeBody(center.g.bodies[0]);
  const nb = game('ruler:protractor-metal');
  const nn = nb.r.makeBody(nb.g.bodies[0]);
  Physics.setHp(cb, 50); Physics.setHp(nn, 50);
  assert.ok(cb.grip > nn.grip, '重心の方が押されたときに止まりやすい');
  // 方眼：1周でたまる量が+5%（25 → 26.3）
  const grid = game('ruler:sr-draft60');
  Object.assign(grid.g.bodies[1], { x: 25, y: 18 });
  const firstSeat = grid.g.turn;
  for (let k = 0; k < 2; k++) {
    const id = grid.g.order[grid.g.turn];
    grid.r.handle(id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: grid.g.turn === 0 ? -1 : 1, power: 0.05 });
  }
  assert.ok(firstSeat === 0 || firstSeat === 1);
  assert.equal(grid.g.gauge[0], 26.3);
  assert.equal(grid.g.gauge[1], 25);
});

test('一文字：その1打は回らない。ゴム跳び：机の端で1回跳ね返る', () => {
  const turn = (skill) => {
    const { r, a, g } = game('ruler:ssr-makie30');
    g.gauge[0] = 100;
    const a0 = g.bodies[0].a;
    r.handle(a.id, { t: 'flick', lx: 10, ly: 0, dx: 1, dy: 0.2, power: 0.6, skill });
    return Math.abs(g.bodies[0].a - a0);
  };
  assert.ok(turn(false) > 0.1);
  assert.ok(turn(true) < 1e-3);
  const { r, a, g } = game('ruler:ssr-karakawa15');
  g.gauge[0] = 100;
  Object.assign(g.bodies[1], { x: 0, y: 18, a: 0 });
  const m = r.handle(a.id, { t: 'flick', lx: 0, ly: 0, dx: -1, dy: 0, power: 0.9, skill: true })[0].msg;
  assert.equal(m.marks.filter((x) => x.kind === 'bounce').length, 1);
});

test('虹の道ははじく力が上がり、一角は角の先で当てると強い', () => {
  const dist = (skill) => {
    const { r, a, g } = game('ruler:ssr-raden45');
    g.gauge[0] = 100; Object.assign(g.bodies[1], { x: 20, y: 18 });
    const x0 = g.bodies[0].x;
    r.handle(a.id, { t: 'flick', lx: 0, ly: 0, dx: 0, dy: -1, power: 0.3, skill });
    return Math.hypot(g.bodies[0].x - x0, g.bodies[0].y);
  };
  assert.ok(dist(true) > dist(false) * 1.3);
  const hit = (skill) => {
    const { r, a, g } = game('ruler:ssr-urushi60');
    g.gauge[0] = 100;
    Object.assign(g.bodies[0], { x: -14, y: 0, a: 0 });
    Object.assign(g.bodies[1], { x: 6, y: 0, a: Math.PI / 2 });
    const m = r.handle(a.id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.5, skill })[0].msg;
    return { dmg: 100 - g.bodies[1].hp, tip: m.marks.some((x) => x.kind === 'tip') };
  };
  const plain = hit(false), tip = hit(true);
  assert.equal(tip.tip, true);
  assert.ok(tip.dmg > plain.dmg * 1.3, `${plain.dmg} → ${tip.dmg}`);
  const c = Physics.sharpestCorner('tri60');
  assert.ok(Math.abs(c.angle - 30) < 1);
});

test('百八十度：決めた角度に曲がる（左右で対称）', () => {
  const end = (curve) => {
    const { r, a, g } = game('ruler:ssr-kinpaku-prot');
    g.gauge[0] = 100; Object.assign(g.bodies[1], { x: 20, y: 18 });
    r.handle(a.id, { t: 'flick', lx: 0, ly: 0, dx: 1, dy: 0, power: 0.75, skill: true, curve });
    return g.bodies[0];
  };
  const s = end(0), l = end(90), rgt = end(-90), over = end(500);
  assert.ok(Math.abs(s.y) < 3);
  assert.ok(l.y > 10 && rgt.y < -10);
  assert.ok(Math.abs(l.y + rgt.y) < 0.5);
  assert.ok(Math.abs(over.y - l.y) < 0.5, '最大の角度で止める');
  assert.match(skillDesc('hyaku', { hyakuMax: 60, hyakuDelay: 200 }), /±60°.*200ミリ秒/);
});

test('設定：銘柄の名前・必殺技を変えたり、新しい銘柄を足したりできる', () => {
  const cfg = sanitizeConfig({
    brands: {
      'ruler:r-name30': { name: '<b>名前シール改</b>', skill: 'bomb', gacha: false },
      'ruler:x-test1': { custom: true, shape: 'tri60', mat: 'rubber', name: '新しい三角', rarity: 'SR', trait: 'grip', skill: 'niji', art: 'grid' },
      'ruler:x-bad': { custom: true, shape: 'folding', mat: 'rubber' },
      'ruler:folding-acrylic': { gacha: true },
    },
    traits: { edge: 99 }, rulerGacha: { weights: { SSR: 50 }, pity: 20 },
  });
  assert.equal(cfg.brands['ruler:r-name30'].name, 'b名前シール改/b');
  assert.ok(!cfg.brands['ruler:x-bad']);
  assert.equal(cfg.brands['ruler:folding-acrylic'], undefined, 'ステージの報酬はガチャに出せない');
  assert.equal(cfg.traits.edge, 30);
  assert.equal(cfg.rulerGacha.pity, 20);
  applyConfig(cfg);
  try {
    assert.equal(ITEMS['ruler:x-test1'].specKey, 'tri60-rubber');
    assert.ok(rulerPool('SR').some((it) => it.id === 'ruler:x-test1'));
    assert.ok(!rulerPool('R').some((it) => it.id === 'ruler:r-name30'));
    assert.equal(resolveLoadout({ ruler: 'ruler:r-name30' }, cfg).skill, 'bomb');
    assert.equal(resolveLoadout({ ruler: 'ruler:sr-steel15' }, cfg).traitPct, 30);
    assert.equal(configProblem(cfg), null);
    const odds = rulerOdds(cfg);
    assert.ok(Math.abs(odds.reduce((a, o) => a + o.percent, 0) - 100) < 1e-6);
  } finally {
    applyConfig(defaultConfig());
  }
  assert.equal(ITEMS['ruler:x-test1'], undefined, '設定を戻すと消える');
});

test('定規ガチャ：10回はSR以上が1本確定', () => {
  for (let k = 0; k < 50; k++) assert.ok(['SR', 'SSR'].includes(rollRuler(Math.random, 'SR').rarity));
});

const db = await createFakeD1();
const skip = !db && 'この Node には node:sqlite がないため省略';
if (db) await D.ensureSchema(db);
let n = 0;
const newUser = async (coins = 0) => {
  const u = (await D.upsertGoogleUser(db, 'brand' + (++n), 'ユーザー' + n)).user;
  if (coins) await db.prepare('UPDATE users SET coins = ? WHERE id = ?').bind(coins, u.id).run();
  return u;
};

test('定規ガチャ：値段・重複の返還・天井でSSR交換券が受け取り箱に届き、好きなSSRを選べる', { skip }, async () => {
  const u = await newUser(10000);
  const r = await D.pullRulerGacha(db, u.id, 10, seeded(7));
  assert.equal(r.cost, RULER_GACHA.pull10);
  assert.equal(r.results.length, 10);
  assert.ok(['SR', 'SSR'].includes(ITEMS[r.results[9].id].rarity));
  assert.equal(r.pity, 10);
  // 同じ N を2回：2回目はえんぴつに変わる
  const v = await newUser(1000);
  const a = await D.pullRulerGacha(db, v.id, 1, seq(0.01, 0.01));
  const b = await D.pullRulerGacha(db, v.id, 1, seq(0.01, 0.01));
  assert.equal(a.results[0].id, b.results[0].id);
  assert.equal(b.results[0].dup, true);
  assert.equal(b.refund, RULER_GACHA.refund.N);
  // 天井：100回で交換券
  for (let k = 0; k < 9; k++) await D.pullRulerGacha(db, u.id, 10, seeded(100 + k));
  const box = await D.inboxOf(db, u.id);
  const ticket = box.find((x) => x.kind === 'ticket');
  assert.ok(ticket, '交換券が届く');
  assert.equal((await D.profile(db, await db.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first())).pity, 0);
  const need = await D.claimInbox(db, u.id, { id: ticket.id });
  assert.match(need.error, /選んで/);
  const owned = await D.ownedSet(db, u.id);
  const pick = need.choices[0];
  assert.ok(!owned.has(pick));
  const got = await D.claimInbox(db, u.id, { id: ticket.id, pick });
  assert.deepEqual(got.items, [pick]);
  assert.ok((await D.ownedSet(db, u.id)).has(pick));
  assert.match((await D.pullRulerGacha(db, (await newUser(5)).id, 1)).error, /足りません/);
});

test('受け取り箱：毎日ボーナスは箱に届き、まとめて受け取れる。相棒を持ち替えられる', { skip }, async () => {
  const u = await newUser();
  const t = Date.UTC(2026, 10, 9, 10);
  await D.claimDaily(db, u.id, t);
  const before = (await db.prepare('SELECT coins FROM users WHERE id = ?').bind(u.id).first()).coins;
  const box = await D.inboxOf(db, u.id);
  assert.equal(box.length, 1);
  assert.match(box[0].title, /毎日ボーナス/);
  const got = await D.claimInbox(db, u.id);
  assert.equal(got.total, before + box[0].coins);
  assert.match((await D.claimInbox(db, u.id)).error, /ありません/);
  assert.equal(D.msToNextDay(Date.UTC(2026, 10, 9, 14, 30)), 30 * 60 * 1000);
  assert.match((await D.setPartner(db, u.id, 'ruler:ssr-makie30')).error, /持っていません/);
  assert.equal((await D.setPartner(db, u.id, 'ruler:straight30-rubber')).ok, true);
  const me = await D.profile(db, await db.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first());
  assert.equal(me.selectedRuler, 'ruler:straight30-rubber');
  assert.equal(me.inbox, 0);
});
