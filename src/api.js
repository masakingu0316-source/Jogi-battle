// アカウントの API（プロフィール・装備・ガチャ・戦績）
import { loginEnabled, sessionUser, sameOrigin } from './auth.js';
import { ensureSchema, profile, claimDaily, rename, saveSetup, pullGacha, recentMatches } from './db.js';

const json = (obj, status = 200) => Response.json(obj, { status, headers: { 'cache-control': 'no-store' } });

export async function handleApi(request, env, url) {
  const path = url.pathname;

  if (path === '/api/config') return json({ login: loginEnabled(env) });

  if (!loginEnabled(env)) return json({ error: 'ログイン機能はまだ使えません' }, 503);
  if (request.method === 'POST' && !sameOrigin(request, url)) return json({ error: 'forbidden' }, 403);

  await ensureSchema(env.DB);
  const user = await sessionUser(request, env);

  if (path === '/api/me' && request.method === 'GET') {
    if (!user) return json({ user: null });
    const bonus = await claimDaily(env.DB, user.id);
    const fresh = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    return json({ user: await profile(env.DB, fresh), dailyBonus: bonus });
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
  if (path === '/api/gacha' && request.method === 'POST') {
    const r = await pullGacha(env.DB, user.id, Number(body.count));
    return r.error ? json(r, 400) : json(r);
  }
  return json({ error: 'not found' }, 404);
}
