// 入口。/api/rooms で部屋を作り、/api/rooms/<コード>/ws で部屋につなぐ。
// /auth/* はGoogleログイン、/api/* はアカウントの情報。それ以外は public/ の画面を返す。
import { handleAuth, sessionUser } from './auth.js';
import { handleApi } from './api.js';
export { Room } from './room.js';

// 読み間違えやすい文字（0/O, 1/I/L など）を除いた英数字
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 5;
const CODE_RE = new RegExp(`^/api/rooms/([${CODE_CHARS}]{${CODE_LEN}})/ws$`);
const USER_HEADER = 'X-Jogi-User'; // room.js でも同じ名前を使う

function newCode() {
  const a = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/auth/')) return handleAuth(request, env, url);

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch(`https://room/create?code=${code}`, { method: 'POST' });
        if (res.ok) return Response.json({ code });
      }
      return Response.json({ error: '部屋を作れませんでした。もう一度お試しください。' }, { status: 503 });
    }

    const m = url.pathname.match(CODE_RE);
    if (m) {
      // ほかのサイトから勝手につながれないようにする
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) return new Response('forbidden', { status: 403 });
      // ログイン中ならアカウントを部屋に伝える（画面から送られた同名ヘッダーは消してから付ける）
      const headers = new Headers(request.headers);
      headers.delete(USER_HEADER);
      try {
        const user = await sessionUser(request, env);
        if (user) headers.set(USER_HEADER, encodeURIComponent(JSON.stringify({ id: user.id, name: user.name })));
      } catch { /* データベースに届かないときはゲストとして入る */ }
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
      return stub.fetch(new Request(request, { headers }));
    }

    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
