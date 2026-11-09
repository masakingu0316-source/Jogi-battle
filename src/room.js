// 1部屋＝1つの Durable Object。WebSocket で部屋のメンバー全員とつながる。
// 休止（ハイバネーション）から復帰しても続きができるよう、変更のたびに保存する。
import { DurableObject } from 'cloudflare:workers';
import { RoomCore } from './core.js';

const IDLE_LIMIT_MS = 6 * 60 * 60 * 1000; // 6時間だれも使わなかった部屋は片付ける
const MAX_MESSAGE_BYTES = 4096;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = null;
    // 接続維持の ping には、部屋を起こさずに pong を返す
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('core');
      this.core = saved ? RoomCore.restore(saved) : null;
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/create') {
      if (this.core) return new Response('exists', { status: 409 });
      this.core = new RoomCore(url.searchParams.get('code') || '');
      await this.save();
      return Response.json({ ok: true });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket で接続してください', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ memberId: null });
    if (!this.core) {
      server.send(JSON.stringify({ t: 'error', text: 'この部屋は見つかりません。部屋コードを確かめてください。', fatal: true }));
      server.close(4004, 'room not found');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (!this.core) return;
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const att = ws.deserializeAttachment() || {};

    if (msg.t === 'hello') {
      const res = this.core.join(msg.name, msg.token);
      if (res.error) {
        ws.send(JSON.stringify({ t: 'error', text: res.error, fatal: true }));
        ws.close(4003, 'cannot join');
        return;
      }
      // 同じ人の古い接続が残っていたら閉じる（別タブで開き直した場合など）
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws && (other.deserializeAttachment() || {}).memberId === res.member.id) {
          try { other.close(4000, 'replaced'); } catch { }
        }
      }
      ws.serializeAttachment({ memberId: res.member.id });
      ws.send(JSON.stringify({ t: 'welcome', you: { id: res.member.id, token: res.member.token }, state: this.core.snapshot() }));
      this.broadcast({ t: 'state', state: this.core.snapshot() }, ws);
      await this.save();
      return;
    }

    if (!att.memberId) return;
    const out = this.core.handle(att.memberId, msg);
    for (const o of out) {
      if (o.to === 'all') this.broadcast(o.msg);
      else this.sendTo(o.to, o.msg);
    }
    if (out.length) await this.save();
  }

  async webSocketClose(ws) {
    await this.dropSocket(ws);
  }

  async webSocketError(ws) {
    await this.dropSocket(ws);
  }

  async dropSocket(ws) {
    if (!this.core) return;
    const att = ws.deserializeAttachment() || {};
    if (!att.memberId) return;
    // 同じ人が別の接続でつながり直している場合は何もしない
    const still = this.ctx.getWebSockets().some((o) => o !== ws && (o.deserializeAttachment() || {}).memberId === att.memberId);
    if (still) return;
    this.core.disconnect(att.memberId);
    this.broadcast({ t: 'state', state: this.core.snapshot() }, ws);
    await this.save();
  }

  broadcast(msg, except) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(data); } catch { }
    }
  }

  sendTo(memberId, msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() || {}).memberId === memberId) {
        try { ws.send(data); } catch { }
      }
    }
  }

  async save() {
    if (!this.core) return;
    await this.ctx.storage.put('core', this.core.toJSON());
    await this.ctx.storage.setAlarm(Date.now() + IDLE_LIMIT_MS);
  }

  async alarm() {
    const idle = !this.core || Date.now() - this.core.s.lastActive >= IDLE_LIMIT_MS - 1000;
    if (idle && this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll();
      this.core = null;
    } else {
      await this.ctx.storage.setAlarm(Date.now() + IDLE_LIMIT_MS);
    }
  }
}
