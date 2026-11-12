// アカウントの API（プロフィール・装備・ガチャ・戦績）と、管理者向けの API
import { loginEnabled, sessionUser, sameOrigin } from './auth.js';
import {
  ensureSchema, profile, claimDaily, rename, saveSetup, pullGacha, recentMatches,
  getConfig, saveConfig, resetConfig, clearConfigCache, findUsers, giftCoins, giftItems, userItemsForAdmin, cancelGift,
  inboxWithNotes, claimInbox, pullRulerGacha, setPartner,
} from './db.js';
import { defaultConfig, sanitizeConfig, configProblem } from '../public/shared/catalog.js';
import { VERSION } from '../public/shared/version.js';

const json = (obj, status = 200) => Response.json(obj, { status, headers: { 'cache-control': 'no-store' } });

// 管理者は、Cloudflare のシークレット ADMIN_USER_IDS にアカウントIDを書いた人（カンマ区切りで複数可）
export function isAdmin(env, user) {
  if (!user) return false;
  const ids = String(env.ADMIN_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return ids.includes(user.id);
}

export async function handleApi(request, env, url) {
  const path = url.pathname;

  // ログインしていなくても読める：ログインが使えるかと、ゲームの設定（値段や確率の表示に使う）
  if (path === '/api/config') {
    if (!loginEnabled(env)) return json({ login: false, version: VERSION, game: defaultConfig() });
    await ensureSchema(env.DB);
    return json({ login: true, version: VERSION, game: await getConfig(env.DB) });
  }

  if (!loginEnabled(env)) return json({ error: 'ログイン機能はまだ使えません' }, 503);
  if (request.method === 'POST' && !sameOrigin(request, url)) return json({ error: 'forbidden' }, 403);

  await ensureSchema(env.DB);
  const user = await sessionUser(request, env);

  if (path === '/api/me' && request.method === 'GET') {
    if (!user) return json({ user: null });
    const bonus = await claimDaily(env.DB, user.id);
    const fresh = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    return json({ user: { ...(await profile(env.DB, fresh)), admin: isAdmin(env, user) }, dailyBonus: bonus });
  }

  if (!user) return json({ error: 'ログインしてください' }, 401);
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};

  if (path === '/api/me/name' && request.method === 'POST') {
    return json({ name: await rename(env.DB, user.id, body.name) });
  }
  if (path === '/api/me/setup' && request.method === 'POST') {
    const r = await saveSetup(env.DB, user.id, body);
    return r.error ? json(r, 400) : json(r);
  }
  if (path === '/api/me/matches' && request.method === 'GET') {
    return json({ matches: await recentMatches(env.DB, user.id) });
  }
  if (path === '/api/me/partner' && request.method === 'POST') {
    const r = await setPartner(env.DB, user.id, String(body.ruler || ''));
    return r.error ? json(r, 400) : json(r);
  }
  if (path === '/api/inbox' && request.method === 'GET') {
    await getConfig(env.DB);
    return json({ inbox: await inboxWithNotes(env.DB, user.id) });
  }
  if (path === '/api/inbox/claim' && request.method === 'POST') {
    const r = await claimInbox(env.DB, user.id, { id: body.id ?? null, pick: body.pick ?? null });
    return r.error ? json(r, 400) : json(r);
  }
  if (path === '/api/ruler-gacha' && request.method === 'POST') {
    const r = await pullRulerGacha(env.DB, user.id, Number(body.count));
    return r.error ? json(r, 400) : json(r);
  }
  if (path === '/api/gacha' && request.method === 'POST') {
    const r = await pullGacha(env.DB, user.id, Number(body.count));
    return r.error ? json(r, 400) : json(r);
  }

  // ---- ここから管理者だけ ----
  if (path.startsWith('/api/admin/')) {
    if (!isAdmin(env, user)) return json({ error: 'このページは管理者だけが使えます', yourId: user.id }, 403);

    if (path === '/api/admin/config' && request.method === 'GET') {
      clearConfigCache(); // 設定画面では最新の値を読む
      return json({ config: await getConfig(env.DB), defaults: defaultConfig() });
    }
    if (path === '/api/admin/config' && request.method === 'POST') {
      const clean = sanitizeConfig(body.config);
      const problem = configProblem(clean);
      if (problem) return json({ error: problem }, 400);
      return json({ config: await saveConfig(env.DB, clean) });
    }
    if (path === '/api/admin/config/reset' && request.method === 'POST') {
      return json({ config: await resetConfig(env.DB) });
    }
    if (path === '/api/admin/users' && request.method === 'GET') {
      return json({ users: await findUsers(env.DB, url.searchParams.get('q') || '') });
    }
    if (path === '/api/admin/gift' && request.method === 'POST') {
      const r = await giftCoins(env.DB, String(body.userId || ''), body.amount, body.title);
      return r.error ? json(r, 400) : json(r);
    }
    // アイテムを配る（受け取り箱へ）・その人の持ち物と未受け取り・未受け取りの取り消し
    if (path === '/api/admin/gift-items' && request.method === 'POST') {
      const r = await giftItems(env.DB, String(body.userId || ''), body.items, { title: body.title, allowOwned: !!body.allowOwned });
      return r.error ? json(r, 400) : json(r);
    }
    if (path === '/api/admin/user-items' && request.method === 'GET') {
      const r = await userItemsForAdmin(env.DB, String(url.searchParams.get('userId') || ''));
      return r.error ? json(r, 404) : json(r);
    }
    if (path === '/api/admin/gift-cancel' && request.method === 'POST') {
      const r = await cancelGift(env.DB, String(body.userId || ''), body.id);
      return r.error ? json(r, 400) : json(r);
    }
  }
  return json({ error: 'not found' }, 404);
}
