// アバター：パーツ・おまかせ・持ち物の確かめ・設定での追加・クラスメイト・保存と受け取り箱
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './fake-d1.js';
import * as D from '../src/db.js';
import {
  AVATAR_SLOTS, PARTS, partId, partsOf, defaultAvatar, sanitizeAvatar, avatarProblem, basicPartIds,
  sanitizeAvatarParts, randomAvatar,
} from '../public/shared/avatar.js';
import { defaultClassmates, sanitizeClassmates } from '../public/shared/dojo.js';
import { ITEMS, applyConfig, sanitizeConfig, defaultConfig } from '../public/shared/catalog.js';

const db = await createFakeD1();
const skip = !db && 'この Node には node:sqlite がないため省略';
if (db) await D.ensureSchema(db);
let n = 0;
const newUser = async () => (await D.upsertGoogleUser(db, 'av' + (++n), 'アバター' + n)).user;

test('部位と基本パーツ：髪型6・髪の色8・目6・服4、ほかは「なし」＋2つ。肌の色は5色', () => {
  const basic = (slot) => partsOf(slot).filter((p) => p.basic).length;
  assert.equal(basic('hair'), 6);
  assert.equal(basic('hairColor'), 8);
  assert.equal(basic('eyes'), 6);
  assert.equal(basic('outfit'), 4);
  assert.deepEqual(partsOf('outfit').filter((p) => p.basic).map((p) => p.name), ['学ラン', 'セーラー服', 'ブレザー', '体操服']);
  for (const s of ['jacket', 'head', 'face', 'item', 'bg']) {
    assert.equal(AVATAR_SLOTS.find((x) => x.key === s).none, true, `${s} は「なし」を選べる`);
    assert.equal(basic(s), 2, s);
  }
  assert.equal(basic('skin'), 5);
  // 基本でないパーツ（道場の報酬など）もある
  assert.ok(partsOf('outfit').some((p) => !p.basic));
  // 持ち物の一覧（ITEMS）に、アバターのパーツとして入っている
  assert.equal(ITEMS[partId('outfit', 'hakama')].kind, 'avatar');
});

test('おまかせ：同じ seed なら同じ。最初のアバターは基本パーツだけ', () => {
  const a = defaultAvatar('user-1'), b = defaultAvatar('user-1');
  assert.deepEqual(a, b);
  assert.notDeepEqual(defaultAvatar('user-1'), defaultAvatar('user-2'));
  for (const s of AVATAR_SLOTS) {
    const k = a[s.key];
    if (k) assert.ok(PARTS[s.key][k].basic, `${s.key}:${k}`);
  }
  assert.equal(avatarProblem(a, new Set()), null);
});

test('形を整える・持っていないパーツは使えない', () => {
  const av = sanitizeAvatar({ hair: 'nothing', outfit: 'sailor', jacket: null, extra: 1 }, 'x');
  assert.ok(PARTS.hair[av.hair]);
  assert.equal(av.outfit, 'sailor');
  assert.equal(av.jacket, null);
  assert.ok(!('extra' in av));
  const reward = { ...av, outfit: 'hakama' };
  assert.match(avatarProblem(reward, new Set()), /袴/);
  assert.equal(avatarProblem(reward, new Set([partId('outfit', 'hakama')])), null);
  assert.match(avatarProblem({ ...av, hair: null }, new Set()), /髪型/, '「なし」がない部位');
});

test('設定：元のパーツは変えた所だけ持ち、パーツを足せる。足したパーツは持ち物の一覧にも入る', () => {
  const clean = sanitizeAvatarParts({
    [partId('outfit', 'gakuran')]: { name: '学ラン', c1: '#112233', basic: true },            // 名前と basic は初期値と同じ
    [partId('outfit', 'x-red01')]: { custom: true, base: 'blazer', name: '臙脂ブレザー', c1: '#7a2f2f', c2: '#222222', rarity: 'SR', basic: true },
    [partId('outfit', 'x-bad01')]: { custom: true, base: 'nothing', name: 'だめ' },             // ない描き方
    [partId('nope', 'x')]: { name: 'x' },                                                          // ない部位
  });
  assert.deepEqual(clean[partId('outfit', 'gakuran')], { c1: '#112233' });
  assert.equal(clean[partId('outfit', 'x-red01')].base, 'blazer');
  assert.ok(!clean[partId('outfit', 'x-bad01')]);
  const cfg = sanitizeConfig({ ...defaultConfig(), avatarParts: clean });
  applyConfig(cfg);
  assert.equal(PARTS.outfit['x-red01'].name, '臙脂ブレザー');
  assert.equal(PARTS.outfit.gakuran.c1, '#112233');
  assert.ok(ITEMS[partId('outfit', 'x-red01')]);
  assert.ok(basicPartIds().includes(partId('outfit', 'x-red01')), '最初から選べるパーツにした');
  applyConfig(sanitizeConfig(null));
  assert.ok(!PARTS.outfit['x-red01']);
  assert.ok(!ITEMS[partId('outfit', 'x-red01')]);
});

test('クラスメイト：30人と担任の先生。名前と見た目を変えられ、ないパーツはおまかせに戻る', () => {
  const list = defaultClassmates();
  assert.equal(list.length, 31);
  assert.equal(list.filter((c) => c.teacher).length, 1);
  assert.equal(new Set(list.map((c) => c.id)).size, 31);
  for (const c of list) assert.deepEqual(sanitizeAvatar(c.avatar, c.id), c.avatar, `${c.name} のパーツはどれもある`);
  const edited = sanitizeClassmates([{ id: 'c01', name: '新しい名前', avatar: { ...list[0].avatar, outfit: 'gym', hair: 'nothing' } }]);
  assert.equal(edited[0].name, '新しい名前');
  assert.equal(edited[0].avatar.outfit, 'gym');
  assert.ok(PARTS.hair[edited[0].avatar.hair]);
  assert.deepEqual(edited[1], list[1]);
  assert.equal(sanitizeConfig(null).classmates.length, 31);
});

test('保存：持っているパーツだけ。保存すると次から自分のアバターになる', { skip }, async () => {
  const u = await newUser();
  const first = await D.avatarOf(db, u.id);
  assert.equal(first.set, false);
  assert.deepEqual(first.avatar, defaultAvatar(u.id), 'まだ作っていない人はおまかせ');
  const p = await D.profile(db, (await db.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first()));
  assert.equal(p.avatarSet, false);
  assert.ok(p.owned.includes(partId('hair', 'short')), '基本パーツは持っている');
  const mine = { ...first.avatar, outfit: 'sailor', head: 'hachimaki', bg: 'kokuban' };
  assert.deepEqual((await D.saveAvatar(db, u.id, mine)).avatar, mine);
  assert.deepEqual((await D.avatarOf(db, u.id)), { avatar: mine, set: true, title: null });
  // 持っていないパーツ・ないパーツ
  assert.match((await D.saveAvatar(db, u.id, { ...mine, outfit: 'hakama' })).error, /袴/);
  assert.ok((await D.saveAvatar(db, u.id, { ...mine, hair: 'nothing' })).error);
  assert.ok((await D.saveAvatar(db, u.id, 'x')).error);
});

test('報酬のパーツは受け取り箱で届き、受け取ると使える。もう持っていればえんぴつに', { skip }, async () => {
  const u = await newUser();
  const id = partId('outfit', 'hakama');
  assert.deepEqual((await D.giftItems(db, u.id, [id], { title: '道場の報酬' })).sent, [id]);
  await D.claimInbox(db, u.id);
  const av = { ...(await D.avatarOf(db, u.id)).avatar, outfit: 'hakama' };
  assert.ok(!(await D.saveAvatar(db, u.id, av)).error);
  // 基本パーツは、もう持っている扱い（送らない）
  assert.deepEqual((await D.giftItems(db, u.id, [partId('hair', 'short')])).skipped, [partId('hair', 'short')]);
  // 2つ目はえんぴつ（飾りガチャと同じ本数）
  await D.giftItems(db, u.id, [id], { allowOwned: true });
  const cfg = await D.getConfig(db);
  const got = await D.claimInbox(db, u.id);
  assert.equal(got.refund, cfg.rarities[ITEMS[id].rarity].refund);
});

test('おまかせ（持っているパーツだけ）', () => {
  const owned = new Set(basicPartIds());
  for (let i = 0; i < 20; i++) {
    const av = randomAvatar('r' + i, { allow: (s, p) => owned.has(partId(s, p.key)) });
    assert.equal(avatarProblem(av, owned), null);
  }
});
