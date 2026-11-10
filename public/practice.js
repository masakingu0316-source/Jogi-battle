// コンピュータとの練習。部屋の進行（core.js）をブラウザの中で動かし、サーバーとは通信しない。
// 画面には、オンラインの部屋と同じ形のメッセージを渡すので、画面側はほとんど同じ作りで動く。
// 練習なので、えんぴつ・経験値・戦績は増えない。
import { RoomCore } from './shared/core.js';
import { planShot, CPU_LEVELS } from './shared/cpu.js';
import { ITEMS, resolveLoadout } from './shared/catalog.js';

const RULER_IDS = Object.values(ITEMS).filter((it) => it.kind === 'ruler').map((it) => it.id);

// mode: 遊び方、cpus: コンピュータの人数、level: 強さ
// loadout: 自分の定規、loadoutFor(rulerId): 部屋で定規を替えたとき、onMessage: 画面へ、busy(): 動きの再生中か
export function createPractice({ mode, cpus, level, name, loadout, loadoutFor, onMessage, busy }) {
  const core = new RoomCore('PRACT', mode);
  const lv = CPU_LEVELS[level] ? level : 'normal';
  const me = core.join(name, null, null).member;
  core.setLoadout(me.id, loadout);
  const cpuIds = [];
  for (let i = 0; i < cpus; i++) {
    const m = core.join(`CPU${i + 1}`, null, null).member;
    const ruler = RULER_IDS[Math.floor(Math.random() * RULER_IDS.length)];
    core.setLoadout(m.id, resolveLoadout({ ruler }, undefined, CPU_LEVELS[lv].level));
    cpuIds.push(m.id);
  }
  let closed = false, thinking = false;

  const deliver = (msg) => setTimeout(() => { if (!closed) onMessage(structuredClone(msg)); }, 0);
  const out = (list) => { for (const o of list) if (o.to === 'all' || o.to === me.id) deliver(o.msg); };
  // 練習では1分の自動開始はせず、コンピュータはいつも準備OK
  const settle = () => {
    core.s.startAt = null;
    if (core.s.phase === 'lobby') for (const m of core.s.members) if (cpuIds.includes(m.id)) m.ready = true;
  };
  const state = () => deliver({ t: 'state', state: core.snapshot() });

  async function cpuTurn() {
    if (closed || thinking) return;
    const g = core.s.game;
    if (core.s.phase !== 'aim' || !g || !cpuIds.includes(g.order[g.turn])) return;
    thinking = true;
    try {
      const id = g.order[g.turn];
      const shot = await planShot(core, lv);
      // 動きの再生が終わってから、少し考えるふりをしてはじく
      const t0 = Date.now();
      while (!closed && (busy() || Date.now() - t0 < 900)) await new Promise((r) => setTimeout(r, 120));
      if (closed || core.s.phase !== 'aim' || core.s.game.order[core.s.game.turn] !== id) return;
      out(core.handle(id, { t: 'flick', ...shot }));
      settle();
      if (core.s.phase === 'lobby') state();
    } finally {
      thinking = false;
    }
    cpuTurn(); // 連打や、コンピュータが続くとき
  }

  settle();
  deliver({ t: 'welcome', you: { id: me.id, token: me.token, account: true }, state: core.snapshot() });

  return {
    send(msg) {
      if (closed) return true;
      if (msg.t === 'leave') { closed = true; onMessage({ t: 'left' }); return true; }
      if (msg.t === 'ruler') {
        const lo = loadoutFor(msg.ruler);
        if (lo) out(core.setLoadout(me.id, lo));
      } else {
        out(core.handle(me.id, msg));
      }
      settle();
      if (core.s.phase === 'lobby') state();
      cpuTurn();
      return true;
    },
    close() { closed = true; },
    get level() { return CPU_LEVELS[lv]; },
  };
}
