// ステージモードの通信。計算はサーバー（1人に1つの Durable Object）で行い、
// 画面には部屋と同じ形のメッセージ（welcome / state / shot / reward）を、動きの再生が終わるのを待ちながら1つずつ渡す。
import { VERSION } from './shared/version.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const res = await fetch('/api/stage/' + path, body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, version: VERSION }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '通信に失敗しました。もう一度お試しください'), { status: res.status, data });
  return data;
}

// 途中の攻略があるか（画面を開き直したとき）
export async function stageRun() {
  try { return (await post('run')).run; } catch { return null; }
}

// onMessage(m)：画面へ。busy()：動きの再生中か
export function createStageRun({ onMessage, busy }) {
  let closed = false, pending = false;
  async function deliver(messages) {
    for (const m of messages) {
      if (closed) return;
      while (!closed && busy()) await wait(80);
      if (closed) return;
      onMessage(m);
      // 置物の番・次の盤面は、少し見せてから次へ
      if (m.t === 'state' && m.act !== undefined) await wait(1000);
      else if (m.t === 'state' && m.stage === 'board') await wait(1500);
      else await wait(40);
    }
  }
  const fail = (e) => onMessage({ t: 'error', text: e.message, stageGone: !!e.data?.gone, update: !!e.data?.update, login: e.status === 401 });
  return {
    async start(stage, map, ruler) {
      const d = await post('start', { stage, map, ruler });
      await deliver(d.messages);
    },
    resume(run) { onMessage({ t: 'welcome', ...run }); },
    send(msg) {
      if (closed) return true;
      if (msg.t === 'leave') {
        closed = true;
        post('quit', {}).catch(() => {});
        onMessage({ t: 'left' });
        return true;
      }
      if (pending) return false;
      pending = true;
      post('act', msg).then((d) => deliver(d.messages)).catch(fail).finally(() => { pending = false; });
      return true;
    },
    close() { closed = true; },
    get waiting() { return pending; },
  };
}
