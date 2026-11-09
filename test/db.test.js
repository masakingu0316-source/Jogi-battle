import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './fake-d1.js';
import * as D from '../src/db.js';
import { ECONOMY, ITEMS } from '../public/shared/catalog.js';

const db = await createFakeD1();
const skip = !db && 'この Node には node:sqlite がないため省略';
if (db) await D.ensureSchema(db);
// 決まった順に値を返す乱数
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
let n = 0;
const newUser = async () => (await D.upsertGoogleUser(db, 'sub' + (++n), 'テスト' + n)).user;

test('はじめてのログインで、えんぴつがもらえる。2回目は同じアカウント', { skip }, async () => {
  const a = await D.upsertGoogleUser(db, 'g-1', '山田');
  assert.equal(a.created, true);
  assert.equal(a.user.coins, ECONOMY.welcome);
  const b = await D.upsertGoogleUser(db, 'g-1', '別名');
  assert.equal(b.created, false);
  assert.equal(b.user.id, a.user.id);
});

test('セッションで本人を確かめられ、ログアウトで無効になる', { skip }, async () => {
  const u = await newUser();
  const token = await D.createSession(db, u.id);
  assert.equal((await D.userBySession(db, token)).id, u.id);
  assert.equal(await D.userBySession(db, token + 'x'), null);
  await D.deleteSession(db, token);
  assert.equal(await D.userBySession(db, token), null);
});

test('ログインボーナスは日本時間で1日1回', { skip }, async () => {
  const u = await newUser();
  const t = Date.UTC(2026, 10, 9, 10); // 11/9 19時（日本時間）
  assert.equal(await D.claimDaily(db, u.id, t), ECONOMY.daily);
  assert.equal(await D.claimDaily(db, u.id, t + 3600e3), 0);
  assert.equal(await D.claimDaily(db, u.id, Date.UTC(2026, 10, 9, 15, 1)), ECONOMY.daily); // 翌0時1分
});

test('ガチャ：えんぴつが足りないと引けない。10回は最後がRレア以上', { skip }, async () => {
  const u = await newUser();
  const r = await D.pullGacha(db, u.id, 10, seq(0.01, 0.5, 0.0));
  assert.equal(r.results.length, 10);
  assert.equal(r.cost, ECONOMY.pull10);
  assert.notEqual(ITEMS[r.results[9].id].rarity, 'N');
  // 同じものが出たら、かぶりとして返ってくる
  assert.ok(r.results.some((x) => x.dup));
  assert.equal(r.coins, ECONOMY.welcome - ECONOMY.pull10 + r.refund);
  const before = r.coins;
  const poor = await D.pullGacha(db, u.id, 10);
  assert.match(poor.error, /足りません/);
  assert.equal((await D.profile(db, (await db.prepare('SELECT * FROM users WHERE id=?').bind(u.id).first()))).coins, before);
});

test('持っていない定規やアクセサリは装備できない', { skip }, async () => {
  const u = await newUser();
  assert.match((await D.saveSetup(db, u.id, { ruler: 'ruler:grid30' })).error, /持っていません/);
  assert.match((await D.saveSetup(db, u.id, { ruler: 'ruler:plastic30', acc: 'acc:goldcot' })).error, /持っていない/);
  assert.match((await D.loadoutFor(db, u.id, 'ruler:grid30')).error, /持っていません/);
  await db.prepare('INSERT INTO items (user_id, item_id, acquired_at) VALUES (?, ?, 0)').bind(u.id, 'acc:goldcot').run();
  await db.prepare('INSERT INTO items (user_id, item_id, acquired_at) VALUES (?, ?, 0)').bind(u.id, 'pattern:rainbow').run();
  assert.deepEqual(await D.saveSetup(db, u.id, { ruler: 'ruler:bamboo30', acc: 'acc:goldcot', pattern: 'pattern:rainbow' }), { ok: true });
  const { loadout } = await D.loadoutFor(db, u.id);
  assert.equal(loadout.ruler, 'ruler:bamboo30');
  assert.equal(loadout.mods.power, 1.05);
  assert.equal(loadout.pattern, 'pattern:rainbow');
});

test('対戦の記録：勝つと多くもらえ、1日の上限で止まる。戦績に反映される', { skip }, async () => {
  const a = await newUser(), b = await newUser();
  const rec = (won) => ({ room: 'ABCDE', mode: 'standard', n: 2, shots: 5, names: ['A', 'B'],
    players: [{ userId: a.id, seat: 0, won, kos: won ? 1 : 0, selfOut: false, ruler: 'ruler:plastic30' },
              { userId: b.id, seat: 1, won: !won, kos: 0, selfOut: won, ruler: 'ruler:plastic15' }] });
  const t = Date.UTC(2026, 10, 9, 3);
  const r1 = await D.recordMatch(db, rec(true), t);
  assert.equal(r1[a.id].coins, ECONOMY.play + ECONOMY.win);
  assert.equal(r1[b.id].coins, ECONOMY.play);
  for (let i = 0; i < 20; i++) await D.recordMatch(db, rec(true), t + i);
  const capped = await D.recordMatch(db, rec(true), t + 99);
  assert.equal(capped[a.id].coins, 0);
  assert.equal(capped[a.id].capped, true);
  const st = await D.statsOf(db, a.id);
  assert.equal(st.games, 22);
  assert.equal(st.wins, 22);
  assert.equal(st.kos, 22);
  assert.equal(st.byMode.standard.games, 22);
  const recent = await D.recentMatches(db, b.id, 3);
  assert.equal(recent.length, 3);
  assert.deepEqual(recent[0].names, ['A', 'B']);
  assert.equal(recent[0].selfOut, true);
});

test('設定画面で変えた値が、ガチャの値段・ログイン時の本数・対戦の報酬・アクセサリに効く', { skip }, async () => {
  await D.saveConfig(db, { economy: { pull1: 7, welcome: 500, play: 1, win: 2, dailyBattleCap: 999 }, acc: { 'acc:goldcot': 1.5 } });
  try {
    const { user } = await D.upsertGoogleUser(db, 'cfg-user', '設定テスト');
    assert.equal(user.coins, 500);
    const r = await D.pullGacha(db, user.id, 1);
    assert.equal(r.cost, 7);
    const o = await newUser();
    const rw = await D.recordMatch(db, { room: 'X', mode: 'quick', n: 2, shots: 3, names: ['a', 'b'],
      players: [{ userId: user.id, seat: 0, won: true, kos: 1, selfOut: false, ruler: 'ruler:plastic30' },
                { userId: o.id, seat: 1, won: false, kos: 0, selfOut: false, ruler: 'ruler:plastic30' }] });
    assert.equal(rw[user.id].coins, 3);
    assert.equal(rw[o.id].coins, 1);
    await db.prepare('INSERT INTO items (user_id, item_id, acquired_at) VALUES (?, ?, 0)').bind(user.id, 'acc:goldcot').run();
    await D.saveSetup(db, user.id, { ruler: 'ruler:plastic30', acc: 'acc:goldcot' });
    assert.equal((await D.loadoutFor(db, user.id)).loadout.mods.power, 1.015);
  } finally {
    await D.resetConfig(db);
  }
});

test('設定の範囲チェック：上限を超える値は丸められ、出せるアイテムがなくなる設定は保存できない', { skip }, async () => {
  const { sanitizeConfig, configProblem, odds, rollOnce, GACHA_POOL } = await import('../public/shared/catalog.js');
  const s = sanitizeConfig({ economy: { pull1: -3, daily: 'abc' }, acc: { 'acc:goldclip': 30 }, rarities: { SSR: { weight: 0 } } });
  assert.equal(s.economy.pull1, 1);
  assert.equal(s.economy.daily, ECONOMY.daily);
  assert.equal(s.acc['acc:goldclip'], 5);
  assert.equal(odds(s).find((x) => x.rarity === 'SSR').percent, 0);
  for (let i = 0; i < 200; i++) assert.notEqual(rollOnce(Math.random, null, s).rarity, 'SSR');
  const none = sanitizeConfig({ disabled: GACHA_POOL.map((it) => it.id) });
  assert.match(configProblem(none), /出るものがありません/);
  // ガチャから外したアイテムは出ない
  const off = sanitizeConfig({ disabled: GACHA_POOL.filter((it) => it.rarity === 'N').map((it) => it.id) });
  for (let i = 0; i < 200; i++) assert.notEqual(rollOnce(Math.random, null, off).rarity, 'N');
});

test('えんぴつを配る・減らす（0本より下にはならない）。ユーザーを名前で探せる', { skip }, async () => {
  const { user } = await D.upsertGoogleUser(db, 'gift-user', 'プレゼント');
  assert.equal((await D.giftCoins(db, user.id, 50)).coins, ECONOMY.welcome + 50);
  assert.equal((await D.giftCoins(db, user.id, -99999)).coins, 0);
  assert.match((await D.giftCoins(db, user.id, 0)).error, /0以外/);
  assert.match((await D.giftCoins(db, 'nobody', 5)).error, /見つかりません/);
  const found = await D.findUsers(db, 'プレゼ');
  assert.equal(found[0].id, user.id);
  assert.equal((await D.findUsers(db, user.id))[0].name, 'プレゼント');
});
