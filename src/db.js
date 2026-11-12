// アカウントまわりのデータベース操作（Cloudflare D1）
import { ITEMS, BASIC_RULERS, DEFAULT_RULER, ECONOMY, rollOnce, resolveLoadout, sanitizeConfig, levelInfo, LEVEL_MAX, STAGE_LEVEL_MAX, applyConfig, rollRuler, rulerPool, DEFAULT_BRAND_IDS, RULER_RARITY } from '../public/shared/catalog.js';
import { STAGES, REWARD } from '../public/shared/stage.js';
import { cleanName } from '../public/shared/core.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, google_sub TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    coins INTEGER NOT NULL DEFAULT 0, selected_ruler TEXT NOT NULL DEFAULT '${DEFAULT_RULER}',
    last_daily TEXT, battle_day TEXT, battle_earned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS items (
    user_id TEXT NOT NULL, item_id TEXT NOT NULL, acquired_at INTEGER NOT NULL, PRIMARY KEY (user_id, item_id))`,
  `CREATE TABLE IF NOT EXISTS setups (
    user_id TEXT NOT NULL, ruler_id TEXT NOT NULL, pattern TEXT, sticker TEXT, acc TEXT, PRIMARY KEY (user_id, ruler_id))`,
  `CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY, room TEXT, mode TEXT NOT NULL, players INTEGER NOT NULL, shots INTEGER NOT NULL,
    names TEXT NOT NULL, played_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS match_players (
    match_id TEXT NOT NULL, user_id TEXT NOT NULL, seat INTEGER NOT NULL, won INTEGER NOT NULL,
    kos INTEGER NOT NULL, self_out INTEGER NOT NULL, ruler_id TEXT, coins INTEGER NOT NULL DEFAULT 0,
    played_at INTEGER NOT NULL, PRIMARY KEY (match_id, user_id))`,
  `CREATE INDEX IF NOT EXISTS match_players_user ON match_players(user_id, played_at)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS gacha_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, item_id TEXT NOT NULL, dup INTEGER NOT NULL, pulled_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ruler_exp (
    user_id TEXT NOT NULL, ruler_id TEXT NOT NULL, exp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, ruler_id))`,
  // ステージ：マップごとのクリア回数・初めてクリアした時刻・いちばん少ない打った回数
  `CREATE TABLE IF NOT EXISTS stage_clears (
    user_id TEXT NOT NULL, stage_id TEXT NOT NULL, map INTEGER NOT NULL, clears INTEGER NOT NULL DEFAULT 0,
    first_at INTEGER NOT NULL, best_shots INTEGER, PRIMARY KEY (user_id, stage_id, map))`,
  // 受け取り箱：毎日ボーナス・ステージ初クリアの報酬・天井の交換券・管理者からの配布。押して受け取る（期限なし）
  // kind：daily / stage / ticket（SSR交換券）/ gift。item_id は受け取ると手に入る定規
  `CREATE TABLE IF NOT EXISTS inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
    coins INTEGER NOT NULL DEFAULT 0, item_id TEXT, created_at INTEGER NOT NULL, claimed_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS inbox_user ON inbox(user_id, claimed_at)`,
  // 定規ガチャの天井までの回数
  `CREATE TABLE IF NOT EXISTS ruler_pity (user_id TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0)`,
];

// 定規を「形×素材」に作り直したので、前の定規（今の一覧にないもの）は片付ける。柄・シール・アクセサリはそのまま
// 設定画面で追加した銘柄（ruler:x-…）は消さない
const RULER_IDS = DEFAULT_BRAND_IDS.map((id) => `'${id}'`).join(', ');
const CLEANUP = [
  `DELETE FROM items WHERE item_id LIKE 'ruler:%' AND item_id NOT LIKE 'ruler:x-%' AND item_id NOT IN (${RULER_IDS})`,
  `DELETE FROM setups WHERE ruler_id NOT LIKE 'ruler:x-%' AND ruler_id NOT IN (${RULER_IDS})`,
  `UPDATE users SET selected_ruler = '${DEFAULT_RULER}' WHERE selected_ruler NOT LIKE 'ruler:x-%' AND selected_ruler NOT IN (${RULER_IDS})`,
];

let schemaReady = null;
export function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch([...SCHEMA, ...CLEANUP].map((s) => db.prepare(s))).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}
// テスト用：作り直しの片付けをもう一度走らせる
export function ensureSchemaFresh(db) { schemaReady = null; return ensureSchema(db); }

export function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
// 日本時間の日付（ログインボーナスと、対戦報酬の1日の上限に使う）
export const jstDay = (now = Date.now()) => new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

// ---- ゲームの設定（管理者が設定画面で変えた値） ----
// 毎回データベースを読まないよう、30秒だけ手元に覚えておく
const CONFIG_TTL_MS = 30 * 1000;
let configCache = null;
export async function getConfig(db, now = Date.now()) {
  if (configCache && now - configCache.at < CONFIG_TTL_MS) return configCache.cfg;
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'game'`).first();
  let raw = null;
  try { raw = row ? JSON.parse(row.value) : null; } catch { raw = null; }
  const cfg = sanitizeConfig(raw);
  applyConfig(cfg); // 変えた銘柄・追加した銘柄を、定規の一覧に反映する
  configCache = { cfg, at: now };
  return cfg;
}
export async function saveConfig(db, cfg, now = Date.now()) {
  const clean = sanitizeConfig(cfg);
  await db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('game', ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(JSON.stringify(clean), now).run();
  applyConfig(clean);
  configCache = { cfg: clean, at: now };
  return clean;
}
export async function resetConfig(db, now = Date.now()) {
  await db.prepare(`DELETE FROM settings WHERE key = 'game'`).run();
  configCache = { cfg: sanitizeConfig(null), at: now };
  applyConfig(configCache.cfg);
  return configCache.cfg;
}
export function clearConfigCache() { configCache = null; }

// ---- セッション ----
const SESSION_DAYS = 30;
export async function createSession(db, userId, now = Date.now()) {
  const token = randomHex(32);
  await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), userId, now + SESSION_DAYS * 86400 * 1000).run();
  return token;
}
export async function userBySession(db, token, now = Date.now()) {
  if (!token || token.length > 128) return null;
  return db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`)
    .bind(await sha256Hex(token), now).first();
}
export async function deleteSession(db, token) {
  if (!token) return;
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run();
}

// ---- ユーザー ----
export async function upsertGoogleUser(db, sub, name, now = Date.now()) {
  const found = await db.prepare('SELECT * FROM users WHERE google_sub = ?').bind(sub).first();
  if (found) return { user: found, created: false };
  const id = randomHex(8);
  const cfg = await getConfig(db, now);
  await db.prepare('INSERT INTO users (id, google_sub, name, coins, selected_ruler, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, sub, cleanName(name), cfg.economy.welcome, DEFAULT_RULER, now).run();
  return { user: await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first(), created: true };
}

// 毎日ボーナス：その日はじめて開いたとき、受け取り箱に届ける（日本時間で日付が変わると再び）
export async function claimDaily(db, userId, now = Date.now()) {
  const day = jstDay(now);
  const { daily } = (await getConfig(db, now)).economy;
  const r = await db.prepare(`UPDATE users SET last_daily = ? WHERE id = ? AND (last_daily IS NULL OR last_daily <> ?)`)
    .bind(day, userId, day).run();
  if (!r.meta.changes) return 0;
  if (daily > 0) await sendInbox(db, userId, { kind: 'daily', title: `毎日ボーナス（${day.slice(5).replace('-', '/')}）`, coins: daily }, now);
  return daily;
}
// 次の毎日ボーナスまでのミリ秒（日本時間の0時）
export function msToNextDay(now = Date.now()) {
  const jst = now + 9 * 3600 * 1000;
  return 86400 * 1000 - (jst % (86400 * 1000));
}

// ---- 受け取り箱 ----
export async function sendInbox(db, userId, { kind, title, coins = 0, item = null }, now = Date.now()) {
  await db.prepare('INSERT INTO inbox (user_id, kind, title, coins, item_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(userId, kind, title, Math.max(0, Math.trunc(coins)), item, now).run();
}
const inboxStmt = (db, userId, { kind, title, coins = 0, item = null }, now) =>
  db.prepare('INSERT INTO inbox (user_id, kind, title, coins, item_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(userId, kind, title, Math.max(0, Math.trunc(coins)), item, now);
export async function inboxOf(db, userId) {
  const rows = (await db.prepare('SELECT id, kind, title, coins, item_id, created_at FROM inbox WHERE user_id = ? AND claimed_at IS NULL ORDER BY id DESC LIMIT 100').bind(userId).all()).results;
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, coins: r.coins, item: r.item_id, at: r.created_at }));
}
// もう持っているアイテムを受け取ったときに、代わりにもらえるえんぴつ（ガチャでかぶったときと同じ本数）
// 定規は定規ガチャの返却、柄・シール・アクセサリは飾りガチャの返却
export function dupRefund(cfg, itemId) {
  const it = ITEMS[itemId];
  if (!it) return 0;
  return (it.kind === 'ruler' ? cfg.rulerGacha?.refund?.[it.rarity] : cfg.rarities?.[it.rarity]?.refund) ?? 0;
}
// 受け取り箱の一覧に「もう持っているので、受け取るとえんぴつになる」を付ける（全部受け取るときと同じ順で数える）
export async function inboxWithNotes(db, userId, now = Date.now()) {
  const cfg = await getConfig(db, now);
  const list = await inboxOf(db, userId);
  const owned = await ownedSet(db, userId);
  return list.map((x) => {
    if (!x.item || !ITEMS[x.item]) return x;
    if (owned.has(x.item)) return { ...x, owned: true, refund: dupRefund(cfg, x.item) };
    owned.add(x.item);
    return x;
  });
}
// 受け取る。id を省くと、選ぶ必要のないもの（交換券以外）を全部。交換券は pick（SSRの定規）を選んで1枚ずつ
// もう持っているアイテムは、えんぴつに変えて受け取る（届いたあとにガチャなどで同じものを手に入れていた場合も）
export async function claimInbox(db, userId, { id = null, pick = null } = {}, now = Date.now()) {
  await getConfig(db, now);
  const list = await inboxOf(db, userId);
  const targets = id === null ? list.filter((x) => x.kind !== 'ticket') : list.filter((x) => x.id === Number(id));
  if (!targets.length) return { error: id === null ? '受け取れるものはありません' : 'もう受け取ったか、見つかりません' };
  const owned = await ownedSet(db, userId);
  const cfg = await getConfig(db, now);
  const stmts = [];
  const got = { coins: 0, items: [], refund: 0, claimed: [], converted: [] };
  for (const x of targets) {
    let item = x.item;
    if (x.kind === 'ticket') {
      const ssr = rulerPool('SSR').filter((it) => !owned.has(it.id));
      if (!ssr.length) {
        // 全部持っていれば、えんぴつに変える
        item = null;
        got.refund += cfg.rulerGacha.refund.SSR;
      } else if (!ssr.some((it) => it.id === pick)) {
        return { error: 'SSR交換券で受け取る定規を選んでください', choices: ssr.map((it) => it.id) };
      } else item = pick;
    }
    // 同じアイテムをもう持っていれば、えんぴつに変える
    if (item && owned.has(item)) {
      const back = dupRefund(cfg, item);
      got.refund += back;
      got.converted.push({ item, refund: back });
      item = null;
    }
    if (item && ITEMS[item]) {
      owned.add(item);
      got.items.push(item);
      stmts.push(db.prepare('INSERT OR IGNORE INTO items (user_id, item_id, acquired_at) VALUES (?, ?, ?)').bind(userId, item, now));
    }
    got.coins += x.coins;
    got.claimed.push(x.id);
    stmts.push(db.prepare('UPDATE inbox SET claimed_at = ? WHERE id = ? AND user_id = ? AND claimed_at IS NULL').bind(now, x.id, userId));
  }
  const add = got.coins + got.refund;
  if (add) stmts.push(db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(add, userId));
  await db.batch(stmts);
  got.total = (await db.prepare('SELECT coins FROM users WHERE id = ?').bind(userId).first())?.coins ?? 0;
  return got;
}

export async function rename(db, userId, name) {
  const n = cleanName(name);
  await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(n, userId).run();
  return n;
}

export async function ownedSet(db, userId) {
  const rows = (await db.prepare('SELECT item_id FROM items WHERE user_id = ?').bind(userId).all()).results;
  return new Set([...BASIC_RULERS, ...rows.map((r) => r.item_id)]);
}

export async function setupsOf(db, userId) {
  const rows = (await db.prepare('SELECT ruler_id, pattern, sticker, acc FROM setups WHERE user_id = ?').bind(userId).all()).results;
  return Object.fromEntries(rows.map((r) => [r.ruler_id, { pattern: r.pattern, sticker: r.sticker, acc: r.acc }]));
}

// 定規ごとの経験値 { 'ruler:...': 数 }
export async function expOf(db, userId) {
  const rows = (await db.prepare('SELECT ruler_id, exp FROM ruler_exp WHERE user_id = ?').bind(userId).all()).results;
  return Object.fromEntries(rows.filter((r) => ITEMS[r.ruler_id]?.kind === 'ruler').map((r) => [r.ruler_id, r.exp]));
}

export async function statsOf(db, userId) {
  const total = await db.prepare(`SELECT COUNT(*) AS games, COALESCE(SUM(won), 0) AS wins, COALESCE(SUM(kos), 0) AS kos,
      COALESCE(SUM(self_out), 0) AS selfOuts FROM match_players WHERE user_id = ?`).bind(userId).first();
  const byMode = (await db.prepare(`SELECT m.mode AS mode, COUNT(*) AS games, COALESCE(SUM(p.won), 0) AS wins
      FROM match_players p JOIN matches m ON m.id = p.match_id WHERE p.user_id = ? GROUP BY m.mode`).bind(userId).all()).results;
  return { ...total, byMode: Object.fromEntries(byMode.map((r) => [r.mode, { games: r.games, wins: r.wins }])) };
}

export async function recentMatches(db, userId, limit = 20) {
  const rows = (await db.prepare(`SELECT m.mode, m.players, m.names, m.played_at, p.seat, p.won, p.kos, p.self_out, p.ruler_id, p.coins
      FROM match_players p JOIN matches m ON m.id = p.match_id WHERE p.user_id = ? ORDER BY p.played_at DESC LIMIT ?`)
    .bind(userId, limit).all()).results;
  return rows.map((r) => ({
    mode: r.mode, players: r.players, names: JSON.parse(r.names), playedAt: r.played_at, seat: r.seat,
    won: !!r.won, kos: r.kos, selfOut: !!r.self_out, ruler: r.ruler_id, coins: r.coins,
  }));
}

export async function profile(db, user, now = Date.now()) {
  await getConfig(db, now); // 設定で追加した銘柄を一覧に入れてから読む
  const [owned, setups, stats, exp, stage, inbox, pity] = await Promise.all([ownedSet(db, user.id), setupsOf(db, user.id), statsOf(db, user.id), expOf(db, user.id), stageProgress(db, user.id),
    db.prepare('SELECT COUNT(*) AS n FROM inbox WHERE user_id = ? AND claimed_at IS NULL').bind(user.id).first(),
    db.prepare('SELECT count FROM ruler_pity WHERE user_id = ?').bind(user.id).first()]);
  // 定規を手に入れた時刻（定規ケースの「取得順」と NEW の印に使う。はじめからある定規は0）
  const got = (await db.prepare(`SELECT item_id, acquired_at FROM items WHERE user_id = ? AND item_id LIKE 'ruler:%'`).bind(user.id).all()).results;
  const acquired = Object.fromEntries(got.map((r) => [r.item_id, r.acquired_at]));
  const selected = owned.has(user.selected_ruler) && ITEMS[user.selected_ruler]?.kind === 'ruler' ? user.selected_ruler : DEFAULT_RULER;
  return {
    id: user.id, name: user.name, coins: user.coins, selectedRuler: selected,
    owned: [...owned].filter((id) => ITEMS[id]), setups, stats, exp, stage, acquired,
    inbox: inbox?.n ?? 0, pity: pity?.count ?? 0, nextDaily: msToNextDay(now), dailyDone: user.last_daily === jstDay(now),
  };
}

// 相棒（使う定規）を持ち替える（ホームのスワイプ）
export async function setPartner(db, userId, rulerId) {
  const owned = await ownedSet(db, userId);
  if (ITEMS[rulerId]?.kind !== 'ruler' || !owned.has(rulerId)) return { error: 'その定規は持っていません' };
  await db.prepare('UPDATE users SET selected_ruler = ? WHERE id = ?').bind(rulerId, userId).run();
  return { ok: true, ruler: rulerId };
}

// 定規1本の装飾とアクセサリを保存し、その定規を「使う定規」にする
export async function saveSetup(db, userId, input) {
  const owned = await ownedSet(db, userId);
  const ruler = String(input.ruler || '');
  if (ITEMS[ruler]?.kind !== 'ruler' || !owned.has(ruler)) return { error: 'その定規は持っていません' };
  const pick = (id, kind) => {
    if (id === null || id === undefined || id === '') return null;
    if (ITEMS[id]?.kind !== kind || !owned.has(id)) throw new Error('持っていないアイテムがあります');
    return id;
  };
  let pattern, sticker, acc;
  try { pattern = pick(input.pattern, 'pattern'); sticker = pick(input.sticker, 'sticker'); acc = pick(input.acc, 'acc'); }
  catch (e) { return { error: e.message }; }
  await db.batch([
    db.prepare(`INSERT INTO setups (user_id, ruler_id, pattern, sticker, acc) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, ruler_id) DO UPDATE SET pattern = excluded.pattern, sticker = excluded.sticker, acc = excluded.acc`)
      .bind(userId, ruler, pattern, sticker, acc),
    db.prepare('UPDATE users SET selected_ruler = ? WHERE id = ?').bind(ruler, userId),
  ]);
  return { ok: true };
}

// 対戦で使う定規（所持を確かめたうえで）。rulerId を省くと「使う定規」
// cap：レベルの上限（対人10・ステージ50）
export async function loadoutFor(db, userId, rulerId, cap = LEVEL_MAX) {
  const user = await db.prepare('SELECT selected_ruler FROM users WHERE id = ?').bind(userId).first();
  const owned = await ownedSet(db, userId);
  let ruler = rulerId || user?.selected_ruler || DEFAULT_RULER;
  if (!owned.has(ruler) || ITEMS[ruler]?.kind !== 'ruler') {
    if (rulerId) return { error: 'その定規は持っていません' };
    ruler = DEFAULT_RULER;
  }
  const s = (await db.prepare('SELECT pattern, sticker, acc FROM setups WHERE user_id = ? AND ruler_id = ?').bind(userId, ruler).first()) || {};
  const keep = (id) => (id && owned.has(id) ? id : null);
  if (rulerId && rulerId !== user?.selected_ruler) {
    await db.prepare('UPDATE users SET selected_ruler = ? WHERE id = ?').bind(ruler, userId).run();
  }
  const cfg = await getConfig(db);
  const row = await db.prepare('SELECT exp FROM ruler_exp WHERE user_id = ? AND ruler_id = ?').bind(userId, ruler).first();
  const { level } = levelInfo(row?.exp ?? 0, cap);
  return { loadout: resolveLoadout({ ruler, pattern: keep(s.pattern), sticker: keep(s.sticker), acc: keep(s.acc) }, cfg, level, cap) };
}

// ---- ガチャ ----
export async function pullGacha(db, userId, count, rand = Math.random, now = Date.now()) {
  if (count !== 1 && count !== 10) return { error: '1回か10回で引いてください' };
  const cfg = await getConfig(db, now);
  const cost = count === 10 ? cfg.economy.pull10 : cfg.economy.pull1 * count;
  const paid = await db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?').bind(cost, userId, cost).run();
  if (!paid.meta.changes) return { error: `${ECONOMY.currency}が足りません（${cost}${ECONOMY.unit}必要です）` };

  const owned = await ownedSet(db, userId);
  const results = [];
  let refund = 0;
  for (let i = 0; i < count; i++) {
    // 10回のときは最後の1回をRレア以上にする
    const item = rollOnce(rand, count === 10 && i === count - 1 ? 'R' : null, cfg);
    const dup = owned.has(item.id);
    const back = dup ? cfg.rarities[item.rarity].refund : 0;
    refund += back;
    if (!dup) owned.add(item.id);
    results.push({ id: item.id, dup, refund: back });
  }
  const stmts = [];
  for (const r of results) {
    if (!r.dup) stmts.push(db.prepare('INSERT OR IGNORE INTO items (user_id, item_id, acquired_at) VALUES (?, ?, ?)').bind(userId, r.id, now));
    stmts.push(db.prepare('INSERT INTO gacha_log (user_id, item_id, dup, pulled_at) VALUES (?, ?, ?, ?)').bind(userId, r.id, r.dup ? 1 : 0, now));
  }
  if (refund) stmts.push(db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(refund, userId));
  await db.batch(stmts);
  const coins = (await db.prepare('SELECT coins FROM users WHERE id = ?').bind(userId).first()).coins;
  return { results, refund, coins, cost };
}

// ---- 定規ガチャ ----
// 10回はSR以上を1本確定。持っている定規は、えんぴつに変えて返す。決めた回数を引くたびに、受け取り箱へ「SSR交換券」
export async function pullRulerGacha(db, userId, count, rand = Math.random, now = Date.now()) {
  if (count !== 1 && count !== 10) return { error: '1回か10回で引いてください' };
  const cfg = await getConfig(db, now);
  const g = cfg.rulerGacha;
  const cost = count === 10 ? g.pull10 : g.pull1;
  const paid = await db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?').bind(cost, userId, cost).run();
  if (!paid.meta.changes) return { error: `${ECONOMY.currency}が足りません（${cost}${ECONOMY.unit}必要です）` };
  const owned = await ownedSet(db, userId);
  const results = [];
  let refund = 0;
  for (let i = 0; i < count; i++) {
    const item = rollRuler(rand, count === 10 && i === count - 1 ? 'SR' : null, cfg);
    const dup = owned.has(item.id);
    const back = dup ? g.refund[item.rarity] ?? 0 : 0;
    refund += back;
    if (!dup) owned.add(item.id);
    results.push({ id: item.id, dup, refund: back });
  }
  const before = (await db.prepare('SELECT count FROM ruler_pity WHERE user_id = ?').bind(userId).first())?.count ?? 0;
  let pity = before + count, tickets = 0;
  if (g.pity > 0) while (pity >= g.pity) { pity -= g.pity; tickets++; }
  const stmts = [];
  for (const r of results) {
    if (!r.dup) stmts.push(db.prepare('INSERT OR IGNORE INTO items (user_id, item_id, acquired_at) VALUES (?, ?, ?)').bind(userId, r.id, now));
    stmts.push(db.prepare('INSERT INTO gacha_log (user_id, item_id, dup, pulled_at) VALUES (?, ?, ?, ?)').bind(userId, r.id, r.dup ? 1 : 0, now));
  }
  if (refund) stmts.push(db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(refund, userId));
  stmts.push(db.prepare(`INSERT INTO ruler_pity (user_id, count) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET count = excluded.count`).bind(userId, pity));
  for (let k = 0; k < tickets; k++) stmts.push(inboxStmt(db, userId, { kind: 'ticket', title: `SSR交換券（定規ガチャ${g.pity}回）` }, now));
  await db.batch(stmts);
  const coins = (await db.prepare('SELECT coins FROM users WHERE id = ?').bind(userId).first()).coins;
  return { results, refund, coins, cost, pity, pityMax: g.pity, tickets };
}

// ---- 対戦の記録と報酬 ----
// rec: { room, mode, n, shots, names: [席順の名前], players: [{ userId, seat, won, kos, selfOut, ruler }] }
export async function recordMatch(db, rec, now = Date.now()) {
  const accounts = rec.players.filter((p) => p.userId);
  if (!accounts.length) return {};
  const day = jstDay(now);
  const { economy } = await getConfig(db, now);
  const matchId = randomHex(8);
  const rewards = {};
  const stmts = [db.prepare('INSERT INTO matches (id, room, mode, players, shots, names, played_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(matchId, rec.room, rec.mode, rec.n, rec.shots, JSON.stringify(rec.names), now)];
  const seen = new Set();
  for (const p of accounts) {
    if (seen.has(p.userId)) continue; // 同じアカウントが2席にいる場合は1回だけ
    seen.add(p.userId);
    const u = await db.prepare('SELECT battle_day, battle_earned FROM users WHERE id = ?').bind(p.userId).first();
    if (!u) continue;
    const earned = u.battle_day === day ? u.battle_earned : 0;
    const want = economy.play + (p.won ? economy.win : 0);
    const give = Math.max(0, Math.min(want, economy.dailyBattleCap - earned));
    rewards[p.userId] = { coins: give, capped: give < want };
    // 定規の経験値（使った定規に入る。1日の上限はない）
    if (ITEMS[p.ruler]?.kind === 'ruler') {
      const gain = economy.expPlay + (p.won ? economy.expWin : 0) + (p.kos || 0) * economy.expKo;
      const before = (await db.prepare('SELECT exp FROM ruler_exp WHERE user_id = ? AND ruler_id = ?').bind(p.userId, p.ruler).first())?.exp ?? 0;
      const a = levelInfo(before), b = levelInfo(before + gain);
      rewards[p.userId].exp = { ruler: p.ruler, gain, ...b, levelUp: b.level > a.level };
      if (gain > 0) {
        stmts.push(db.prepare(`INSERT INTO ruler_exp (user_id, ruler_id, exp) VALUES (?, ?, ?)
          ON CONFLICT (user_id, ruler_id) DO UPDATE SET exp = exp + excluded.exp`).bind(p.userId, p.ruler, gain));
      }
    }
    stmts.push(db.prepare('UPDATE users SET coins = coins + ?, battle_day = ?, battle_earned = ? WHERE id = ?').bind(give, day, earned + give, p.userId));
    stmts.push(db.prepare(`INSERT INTO match_players (match_id, user_id, seat, won, kos, self_out, ruler_id, coins, played_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(matchId, p.userId, p.seat, p.won ? 1 : 0, p.kos, p.selfOut ? 1 : 0, p.ruler, give, now));
  }
  await db.batch(stmts);
  for (const uid of Object.keys(rewards)) {
    rewards[uid].total = (await db.prepare('SELECT coins FROM users WHERE id = ?').bind(uid).first())?.coins ?? 0;
  }
  return rewards;
}

// ---- 管理者向け ----
export async function findUsers(db, q, limit = 30) {
  const like = `%${String(q || '').replace(/[%_]/g, '')}%`;
  const rows = (await db.prepare(`SELECT u.id, u.name, u.coins, u.created_at,
      (SELECT COUNT(*) FROM match_players p WHERE p.user_id = u.id) AS games
      FROM users u WHERE u.name LIKE ? OR u.id = ? ORDER BY u.created_at DESC LIMIT ?`).bind(like, String(q || ''), limit).all()).results;
  return rows.map((r) => ({ id: r.id, name: r.name, coins: r.coins, createdAt: r.created_at, games: r.games }));
}

// えんぴつを配る（マイナスで減らす。0本より下にはしない）
// 配るとき（プラス）は受け取り箱に届ける。減らすとき（マイナス）はすぐに減らす
export async function giftCoins(db, userId, amount, title = '運営からのおくりもの', now = Date.now()) {
  const n = Math.trunc(Number(amount));
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 100000) return { error: '本数は -100000〜100000 の整数で入れてください（0以外）' };
  const u = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(userId).first();
  if (!u) return { error: 'そのユーザーが見つかりません' };
  if (n > 0) {
    await sendInbox(db, userId, { kind: 'gift', title: String(title || '').slice(0, 40) || '運営からのおくりもの', coins: n }, now);
    return { coins: u.coins, inbox: true };
  }
  await db.prepare('UPDATE users SET coins = MAX(0, coins + ?) WHERE id = ?').bind(n, userId).run();
  return { coins: (await db.prepare('SELECT coins FROM users WHERE id = ?').bind(userId).first()).coins };
}

// アイテムを配る（受け取り箱に届ける）。itemIds は1つか配列。1つずつ別の箱に入る
// もう持っているアイテムは、allowOwned のときだけ送る（受け取るとえんぴつに変わる）。返り値 { sent, skipped }
export async function giftItems(db, userId, itemIds, { title = '運営からのおくりもの', allowOwned = false } = {}, now = Date.now()) {
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : [itemIds]).map(String))];
  if (!ids.length) return { error: '配るアイテムを選んでください' };
  if (ids.length > 50) return { error: '一度に配れるのは50個までです' };
  const bad = ids.filter((id) => !ITEMS[id]);
  if (bad.length) return { error: `そのアイテムはありません（${bad.join('、')}）` };
  const u = await db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
  if (!u) return { error: 'そのユーザーが見つかりません' };
  const owned = await ownedSet(db, userId);
  const head = String(title || '').slice(0, 40) || '運営からのおくりもの';
  const sent = [], skipped = [];
  const stmts = [];
  for (const id of ids) {
    if (owned.has(id) && !allowOwned) { skipped.push(id); continue; }
    sent.push(id);
    stmts.push(inboxStmt(db, userId, { kind: 'gift', title: head, item: id }, now));
  }
  if (stmts.length) await db.batch(stmts);
  return { sent, skipped };
}

// 管理者向け：その人の持ち物と、まだ受け取っていない受け取り箱
export async function userItemsForAdmin(db, userId) {
  const u = await db.prepare('SELECT id, name, coins FROM users WHERE id = ?').bind(userId).first();
  if (!u) return { error: 'そのユーザーが見つかりません' };
  const owned = [...(await ownedSet(db, userId))];
  const pending = await inboxOf(db, userId);
  return { user: { id: u.id, name: u.name, coins: u.coins }, owned, pending };
}

// 管理者向け：まだ受け取っていない「運営からのおくりもの」を取り消す
export async function cancelGift(db, userId, inboxId) {
  const r = await db.prepare("DELETE FROM inbox WHERE id = ? AND user_id = ? AND claimed_at IS NULL AND kind = 'gift'").bind(Number(inboxId), userId).run();
  return r.meta.changes ? { ok: true } : { error: 'もう受け取られたか、取り消せないものです' };
}

// ---- ステージ ----
// { [stageId]: { cleared: いちばん先にクリアしたマップの番号, maps: { [map]: { clears, best } } } }
export async function stageProgress(db, userId) {
  const rows = (await db.prepare('SELECT stage_id, map, clears, best_shots FROM stage_clears WHERE user_id = ?').bind(userId).all()).results;
  const out = {};
  for (const id of Object.keys(STAGES)) out[id] = { cleared: 0, maps: {} };
  for (const r of rows) {
    const p = out[r.stage_id];
    if (!p) continue;
    p.maps[r.map] = { clears: r.clears, best: r.best_shots };
    // 順に開放されるので、続けてクリアしているところまで
  }
  for (const p of Object.values(out)) {
    let n = 0;
    while (p.maps[n + 1]?.clears > 0) n++;
    p.cleared = n;
  }
  return out;
}

// マップをクリアした記録と報酬。rec: { userId, stage, map, ruler, shots }
// 経験値はクリアのたび、えんぴつは初クリアのときだけ。最後のマップの初クリアで報酬の定規
export async function recordStageClear(db, rec, now = Date.now()) {
  const st = STAGES[rec.stage];
  if (!st || !rec.userId) return null;
  const prev = await db.prepare('SELECT clears, best_shots FROM stage_clears WHERE user_id = ? AND stage_id = ? AND map = ?')
    .bind(rec.userId, rec.stage, rec.map).first();
  const first = !prev;
  const coins = first ? REWARD.coins(rec.map) : 0;
  const gain = REWARD.exp(rec.map);
  const stmts = [db.prepare(`INSERT INTO stage_clears (user_id, stage_id, map, clears, first_at, best_shots) VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT (user_id, stage_id, map) DO UPDATE SET clears = clears + 1, best_shots = MIN(COALESCE(best_shots, excluded.best_shots), excluded.best_shots)`)
    .bind(rec.userId, rec.stage, rec.map, now, rec.shots ?? null)];
  const mapName = st.maps[rec.map - 1]?.name || '';
  if (coins) stmts.push(inboxStmt(db, rec.userId, { kind: 'stage', title: `${st.name} マップ${rec.map}「${mapName}」初クリア`, coins }, now));
  let exp = null;
  if (ITEMS[rec.ruler]?.kind === 'ruler') {
    const before = (await db.prepare('SELECT exp FROM ruler_exp WHERE user_id = ? AND ruler_id = ?').bind(rec.userId, rec.ruler).first())?.exp ?? 0;
    const a = levelInfo(before, STAGE_LEVEL_MAX), b = levelInfo(before + gain, STAGE_LEVEL_MAX);
    exp = { ruler: rec.ruler, gain, ...b, levelUp: b.level > a.level, stage: true };
    stmts.push(db.prepare(`INSERT INTO ruler_exp (user_id, ruler_id, exp) VALUES (?, ?, ?)
      ON CONFLICT (user_id, ruler_id) DO UPDATE SET exp = exp + excluded.exp`).bind(rec.userId, rec.ruler, gain));
  }
  // 最後のマップの初クリア：報酬の定規
  let item = null;
  if (first && rec.map === st.maps.length && st.reward) {
    const has = await db.prepare('SELECT 1 FROM items WHERE user_id = ? AND item_id = ?').bind(rec.userId, st.reward).first();
    if (!has) {
      item = st.reward;
      stmts.push(inboxStmt(db, rec.userId, { kind: 'stage', title: `${st.name} 全クリア報酬`, item: st.reward }, now));
    }
  }
  await db.batch(stmts);
  const total = (await db.prepare('SELECT coins FROM users WHERE id = ?').bind(rec.userId).first())?.coins ?? 0;
  return { first, coins, total, exp, item, map: rec.map, stage: rec.stage, inbox: !!(coins || item) };
}
