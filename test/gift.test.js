// 管理者がアイテムを配る：受け取り箱に届く・もう持っているとき・届いたあとに同じものを手に入れたとき・取り消し
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './fake-d1.js';
import * as D from '../src/db.js';
import { ITEMS, BASIC_RULERS } from '../public/shared/catalog.js';

const db = await createFakeD1();
const skip = !db && 'この Node には node:sqlite がないため省略';
if (db) await D.ensureSchema(db);
let n = 0;
const newUser = async () => (await D.upsertGoogleUser(db, 'gift' + (++n), 'おくりもの' + n)).user;
const coinsOf = async (id) => (await db.prepare('SELECT coins FROM users WHERE id = ?').bind(id).first()).coins;
const give = (id, item) => db.prepare('INSERT OR IGNORE INTO items (user_id, item_id, acquired_at) VALUES (?, ?, ?)').bind(id, item, Date.now()).run();
const RULER = 'ruler:sr-steel15', DECOR = 'pattern:stars';

test('アイテムを配ると受け取り箱に届き、受け取ると持ち物になる', { skip }, async () => {
  assert.equal(ITEMS[RULER].kind, 'ruler');
  assert.equal(ITEMS[DECOR].kind, 'pattern');
  const u = await newUser();
  const r = await D.giftItems(db, u.id, [RULER, DECOR], { title: 'イベントの景品' });
  assert.deepEqual(r, { sent: [RULER, DECOR], skipped: [] });
  const box = await D.inboxWithNotes(db, u.id);
  assert.equal(box.length, 2);
  assert.ok(box.every((x) => x.kind === 'gift' && x.title === 'イベントの景品' && !x.owned));
  assert.ok(!(await D.ownedSet(db, u.id)).has(RULER), '受け取るまでは持っていない');
  const before = await coinsOf(u.id);
  const got = await D.claimInbox(db, u.id);
  assert.deepEqual(got.items.sort(), [DECOR, RULER].sort());
  assert.equal(got.refund, 0);
  assert.equal(await coinsOf(u.id), before);
  const owned = await D.ownedSet(db, u.id);
  assert.ok(owned.has(RULER) && owned.has(DECOR));
});

test('もう持っているアイテムは、ふつうは送らない（もう持っているものも送る、にすると送れる）', { skip }, async () => {
  const u = await newUser();
  await give(u.id, RULER);
  const r = await D.giftItems(db, u.id, [RULER, DECOR]);
  assert.deepEqual(r, { sent: [DECOR], skipped: [RULER] });
  // 最初から持っている定規も「持っている」
  const r2 = await D.giftItems(db, u.id, BASIC_RULERS[0]);
  assert.deepEqual(r2.skipped, [BASIC_RULERS[0]]);
  const r3 = await D.giftItems(db, u.id, [RULER], { allowOwned: true });
  assert.deepEqual(r3.sent, [RULER]);
  // 受け取り箱には「受け取るとえんぴつになる」が出る
  const cfg = await D.getConfig(db);
  const note = (await D.inboxWithNotes(db, u.id)).find((x) => x.item === RULER);
  assert.equal(note.owned, true);
  assert.equal(note.refund, cfg.rulerGacha.refund[ITEMS[RULER].rarity]);
});

test('届いたあと、受け取る前にガチャなどで同じものを手に入れたら、受け取るときにえんぴつに変わる（定規は定規ガチャ、飾りは飾りガチャの本数）', { skip }, async () => {
  const u = await newUser();
  await D.giftItems(db, u.id, [RULER, DECOR]);
  // ガチャで同じものが出た（受け取り箱のものはまだ持っていない扱いなので、ガチャではふつうに手に入る）
  await give(u.id, RULER);
  await give(u.id, DECOR);
  const cfg = await D.getConfig(db);
  const want = cfg.rulerGacha.refund[ITEMS[RULER].rarity] + cfg.rarities[ITEMS[DECOR].rarity].refund;
  const notes = await D.inboxWithNotes(db, u.id);
  assert.ok(notes.every((x) => x.owned));
  const before = await coinsOf(u.id);
  const got = await D.claimInbox(db, u.id);
  assert.deepEqual(got.items, []);
  assert.equal(got.refund, want);
  assert.equal(got.converted.length, 2);
  assert.equal(await coinsOf(u.id), before + want);
  assert.equal((await D.inboxOf(db, u.id)).length, 0, '箱からは消える');
});

test('同じアイテムを2つ送ったら、1つ目は持ち物に、2つ目はえんぴつになる', { skip }, async () => {
  const u = await newUser();
  await D.giftItems(db, u.id, DECOR);
  await D.giftItems(db, u.id, DECOR);
  const notes = await D.inboxWithNotes(db, u.id);
  assert.equal(notes.filter((x) => x.owned).length, 1, '2つ目は「受け取るとえんぴつ」');
  const got = await D.claimInbox(db, u.id);
  assert.deepEqual(got.items, [DECOR]);
  assert.equal(got.converted.length, 1);
});

test('まだ受け取っていない運営からのおくりものは取り消せる。受け取ったもの・ほかの箱は取り消せない', { skip }, async () => {
  const u = await newUser();
  await D.giftItems(db, u.id, [RULER]);
  await D.claimDaily(db, u.id, Date.UTC(2026, 10, 12, 3));
  const info = await D.userItemsForAdmin(db, u.id);
  assert.equal(info.user.id, u.id);
  const gift = info.pending.find((x) => x.item === RULER);
  const daily = info.pending.find((x) => x.kind === 'daily');
  assert.ok(gift && daily);
  assert.ok((await D.cancelGift(db, u.id, daily.id)).error, '毎日ボーナスは取り消せない');
  assert.deepEqual(await D.cancelGift(db, u.id, gift.id), { ok: true });
  assert.ok(!(await D.inboxOf(db, u.id)).some((x) => x.item === RULER));
  assert.ok((await D.cancelGift(db, u.id, gift.id)).error, '2回目は取り消せない');
  // 受け取ったあとは取り消せない
  await D.giftItems(db, u.id, [DECOR]);
  const g2 = (await D.inboxOf(db, u.id)).find((x) => x.item === DECOR);
  await D.claimInbox(db, u.id, { id: g2.id });
  assert.ok((await D.cancelGift(db, u.id, g2.id)).error);
  assert.ok((await D.ownedSet(db, u.id)).has(DECOR));
});

test('アイテムを配るときの確かめ：ないアイテム・いない人・空', { skip }, async () => {
  const u = await newUser();
  assert.ok((await D.giftItems(db, u.id, ['ruler:nothing'])).error);
  assert.ok((await D.giftItems(db, 'nobody', [RULER])).error);
  assert.ok((await D.giftItems(db, u.id, [])).error);
  assert.ok((await D.userItemsForAdmin(db, 'nobody')).error);
});
