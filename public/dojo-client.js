// バトル道場の通信。計算はサーバー（1人に1つの Durable Object）で行い、
// 画面には部屋と同じ形のメッセージ（welcome / state / shot / dojo）を、動きの再生が終わるのを待ちながら1つずつ渡す。
import { VERSION } from './shared/version.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function dojoApi(path, body) {
  const res = await fetch('/api/dojo/' + path, body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, version: VERSION }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '通信に失敗しました。もう一度お試しください'), { status: res.status, data });
  return data;
}

// onMessage(m)：画面へ。busy()：動きの再生中か
export function createDojoRun({ onMessage, busy }) {
  let closed = false, pending = false;
  async function deliver(messages) {
    for (const m of messages) {
      if (closed) return;
      while (!closed && busy()) await wait(80);
      if (closed) return;
      onMessage(m);
      // クラスメイトがその場で使った必殺技は、カットインを見せてから次へ
      if (m.t === 'state' && m.act) await wait(1500);
      else await wait(40);
    }
  }
  const fail = (e) => onMessage({ t: 'error', text: e.message, dojoGone: !!e.data?.gone, login: e.status === 401 });
  return {
    async start(opt) {
      const d = await dojoApi('start', opt);
      await deliver(d.messages);
    },
    send(msg) {
      if (closed) return true;
      if (msg.t === 'leave') {
        closed = true;
        dojoApi('quit', {}).catch(() => {});
        onMessage({ t: 'left' });
        return true;
      }
      if (pending) return false;
      pending = true;
      dojoApi('act', msg).then((d) => deliver(d.messages)).catch(fail).finally(() => { pending = false; });
      return true;
    },
    close() { closed = true; },
    get waiting() { return pending; },
  };
}
