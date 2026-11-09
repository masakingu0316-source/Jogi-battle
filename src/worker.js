// 入口。/api/rooms で部屋を作り、/api/rooms/<コード>/ws で部屋につなぐ。
// それ以外は public/ の画面をそのまま返す。
export { Room } from './room.js';

// 読み間違えやすい文字（0/O, 1/I/L など）を除いた英数字
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 5;
const CODE_RE = new RegExp(`^/api/rooms/([${CODE_CHARS}]{${CODE_LEN}})/ws$`);

function newCode() {
  const a = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
      return stub.fetch(request);
    }

    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
