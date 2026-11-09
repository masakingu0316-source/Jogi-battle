// Googleでログイン（認可コード方式＋PKCE）とセッション
// 端末には推測できないセッションIDだけを HttpOnly のクッキーで持たせ、データベースにはそのハッシュを保存する。
import { ensureSchema, upsertGoogleUser, createSession, userBySession, deleteSession } from './db.js';

const SESSION_COOKIE = 'jogi_sid';
const OAUTH_COOKIE = 'jogi_oauth';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export const loginEnabled = (env) => !!(env.DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function cookie(name, value, maxAge, path = '/') {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomB64url(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return b64url(a);
}
function decodeJwtPayload(jwt) {
  const part = jwt.split('.')[1];
  const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}
// 戻り先はこのサイトの中だけ
function safeReturn(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path.slice(0, 200) : '/';
}

function messagePage(text, status = 400) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>定規バトル</title><body style="font-family:sans-serif;background:#1f3c35;color:#f1efe6;padding:24px">
<p>${text}</p><p><a style="color:#f4d35e" href="/">トップに戻る</a></p></body>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function handleAuth(request, env, url) {
  if (!loginEnabled(env)) return messagePage('ログインの設定がまだ済んでいません。管理者にお知らせください。', 503);

  if (url.pathname === '/auth/login') {
    const state = randomB64url(16);
    const verifier = randomB64url(32);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const ret = safeReturn(url.searchParams.get('return'));
    const q = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${url.origin}/auth/callback`,
      response_type: 'code',
      scope: 'openid profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${GOOGLE_AUTH}?${q}`,
        'Set-Cookie': cookie(OAUTH_COOKIE, JSON.stringify({ state, verifier, ret }), 600, '/auth'),
      },
    });
  }

  if (url.pathname === '/auth/callback') {
    let saved;
    try { saved = JSON.parse(readCookie(request, OAUTH_COOKIE) || 'null'); } catch { saved = null; }
    if (url.searchParams.get('error')) return messagePage('ログインを取りやめました。', 400);
    const code = url.searchParams.get('code');
    if (!saved || !code || url.searchParams.get('state') !== saved.state) {
      return messagePage('ログインの手続きが確認できませんでした。もう一度ログインしてください。', 400);
    }
    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${url.origin}/auth/callback`,
        grant_type: 'authorization_code',
        code_verifier: saved.verifier,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id_token) return messagePage('Googleからの応答を確認できませんでした。時間をおいてもう一度お試しください。', 502);
    // Google のトークン窓口から HTTPS で直接受け取った ID トークンなので、中身の確認だけ行う
    let claims;
    try { claims = decodeJwtPayload(data.id_token); } catch { claims = null; }
    const now = Date.now();
    if (!claims || !GOOGLE_ISSUERS.includes(claims.iss) || claims.aud !== env.GOOGLE_CLIENT_ID || !claims.sub || claims.exp * 1000 < now) {
      return messagePage('ログイン情報を確認できませんでした。もう一度お試しください。', 400);
    }
    await ensureSchema(env.DB);
    const { user } = await upsertGoogleUser(env.DB, claims.sub, claims.name || claims.given_name || 'ゲスト', now);
    const token = await createSession(env.DB, user.id, now);
    const headers = new Headers({ Location: saved.ret || '/' });
    headers.append('Set-Cookie', cookie(SESSION_COOKIE, token, 30 * 86400));
    headers.append('Set-Cookie', cookie(OAUTH_COOKIE, '', 0, '/auth'));
    return new Response(null, { status: 302, headers });
  }

  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    if (!sameOrigin(request, url)) return new Response('forbidden', { status: 403 });
    await ensureSchema(env.DB);
    await deleteSession(env.DB, readCookie(request, SESSION_COOKIE));
    return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) } });
  }

  return new Response('Not found', { status: 404 });
}

export async function sessionUser(request, env) {
  if (!env.DB) return null;
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  await ensureSchema(env.DB);
  return userBySession(env.DB, token);
}

// 書き込みのリクエストは、このサイトの画面から来たものだけ受け付ける
export function sameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  return !origin || origin === url.origin;
}
