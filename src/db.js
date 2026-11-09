// アカウントまわりのデータベース操作（Cloudflare D1）
import { ITEMS, BASIC_RULERS, DEFAULT_RULER, ECONOMY, rollOnce, resolveLoadout, sanitizeConfig } from '../public/shared/catalog.js';
import { cleanName } from './core.js';

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
];

let schemaReady = null;
export function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

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
  configCache = { cfg, at: now };
  return cfg;
}
export async function saveConfig(db, cfg, now = Date.now()) {
  const clean = sanitizeConfig(cfg);
  await db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('game', ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(JSON.stringify(clean), now).run();
  configCache = { cfg: clean, at: now };
  return clean;
}
export async function resetConfig(db, now = Date.now()) {
  await db.prepare(`DELETE FROM settings WHERE key = 'game'`).run();
  configCache = { cfg: sanitizeConfig(null), at: now };
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
  await db.prepare('INSERT INTO users (id, google_sub, name, coins, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, sub, cleanName(name), cfg.economy.welcome, now).run();
  return { user: await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first(), created: true };
}

export async function claimDaily(db, userId, now = Date.now()) {
  const day = jstDay(now);
  const { daily } = (await getConfig(db, now)).economy;
  const r = await db.prepare(`UPDATE users SET coins = coins + ?, last_daily = ? WHERE id = ? AND (last_daily IS NULL OR last_daily <> ?)`)
    .bind(daily, day, userId, day).run();
  return r.meta.changes > 0 ? daily : 0;
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

export async function profile(db, user) {
  const [owned, setups, stats] = await Promise.all([ownedSet(db, user.id), setupsOf(db, user.id), statsOf(db, user.id)]);
  return {
    id: user.id, name: user.name, coins: user.coins, selectedRuler: user.selected_ruler,
    owned: [...owned], setups, stats,
  };
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
export async function loadoutFor(db, userId, rulerId) {
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
  return { loadout: resolveLoadout({ ruler, pattern: keep(s.pattern), sticker: keep(s.sticker), acc: keep(s.acc) }, cfg) };
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
export async function giftCoins(db, userId, amount) {
  const n = Math.trunc(Number(amount));
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 100000) return { error: '本数は -100000〜100000 の整数で入れてください（0以外）' };
  const r = await db.prepare('UPDATE users SET coins = MAX(0, coins + ?) WHERE id = ?').bind(n, userId).run();
  if (!r.meta.changes) return { error: 'そのユーザーが見つかりません' };
  return { coins: (await db.prepare('SELECT coins FROM users WHERE id = ?').bind(userId).first()).coins };
}
