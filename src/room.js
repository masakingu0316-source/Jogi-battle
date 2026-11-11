// 1部屋＝1つの Durable Object。WebSocket で部屋のメンバー全員とつながる。
// 休止（ハイバネーション）から復帰しても続きができるよう、変更のたびに保存する。
import { DurableObject } from 'cloudflare:workers';
import { RoomCore } from '../public/shared/core.js';
import { ensureSchema, loadoutFor, recordMatch } from './db.js';
import { ITEMS, resolveLoadout } from '../public/shared/catalog.js';
import { VERSION } from '../public/shared/version.js';
import { handleStage, stageAlarm } from './stage-host.js';

const IDLE_LIMIT_MS = 6 * 60 * 60 * 1000; // 6時間だれも使わなかった部屋は片付ける
const MAX_MESSAGE_BYTES = 4096;
const USER_HEADER = 'X-Jogi-User'; // worker.js が付けるログイン情報
const LOGIN_HEADER = 'X-Jogi-Login-Required';

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

    // ステージモード（この Durable Object は「stage:<アカウントID>」の名前で、1人の攻略だけを持つ）
    if (url.pathname.startsWith('/stage/')) {
      let user = null;
      try {
        const raw = request.headers.get(USER_HEADER);
        if (raw) user = JSON.parse(decodeURIComponent(raw));
      } catch { user = null; }
      return handleStage(this, request, user);
    }

    if (url.pathname === '/create') {
      if (this.core) return new Response('exists', { status: 409 });
      this.core = new RoomCore(url.searchParams.get('code') || '', url.searchParams.get('mode') || 'standard');
      await this.save();
      return Response.json({ ok: true });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket で接続してください', { status: 426 });
    }
    let user = null;
    try {
      const raw = request.headers.get(USER_HEADER);
      if (raw) user = JSON.parse(decodeURIComponent(raw));
    } catch { user = null; }
    const loginRequired = request.headers.get(LOGIN_HEADER) === '1';

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ memberId: null, user });
    if (!this.core) {
      server.send(JSON.stringify({ t: 'error', text: 'この部屋は見つかりません。部屋コードを確かめてください。', fatal: true }));
      server.close(4004, 'room not found');
    } else if (loginRequired && !user) {
      server.send(JSON.stringify({ t: 'error', text: 'ログインしてから部屋に入ってください。', fatal: true, login: true }));
      server.close(4001, 'login required');
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
      // 画面が古い版のままなら、再読み込みを促す（席はトークンで戻れる）
      if (msg.version !== VERSION) {
        ws.send(JSON.stringify(msg.version
          ? { t: 'update' }
          : { t: 'error', text: '新しい版が公開されています。画面を再読み込みしてください（対戦中でも同じ席に戻れます）' }));
      }
      const res = this.core.join(msg.name, msg.token, att.user || null);
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
      ws.serializeAttachment({ memberId: res.member.id, user: att.user || null });
      // ログイン中なら、アカウントで選んでいる定規（装飾・アクセサリ込み）を読み込む
      if (res.member.userId && this.core.s.phase !== 'aim' && this.env.DB) {
        try {
          await ensureSchema(this.env.DB);
          const r = await loadoutFor(this.env.DB, res.member.userId);
          if (r.loadout) res.member.loadout = r.loadout;
        } catch { /* 読めなければ標準の定規のまま */ }
      }
      ws.send(JSON.stringify({ t: 'welcome', you: { id: res.member.id, token: res.member.token, account: !!res.member.userId }, state: this.core.snapshot() }));
      this.broadcast({ t: 'state', state: this.core.snapshot() }, ws);
      await this.save();
      return;
    }

    if (!att.memberId) return;
    let out;
    if (msg.t === 'ruler') out = await this.chooseRuler(att.memberId, msg.ruler);
    else out = this.core.handle(att.memberId, msg);
    for (const o of out) {
      if (o.to === 'all') this.broadcast(o.msg);
      else this.sendTo(o.to, o.msg);
    }
    if (out.length) await this.save();
    if (msg.t === 'leave') {
      ws.serializeAttachment({ memberId: null, user: att.user || null });
      try { ws.close(1000, 'left'); } catch { }
    }
    const rec = this.core.takeRecord();
    if (rec) await this.saveRecord(rec);
  }

  // 定規を選ぶ。ログイン中は持っているかをデータベースで確かめる。ゲストは基本の4本だけ
  async chooseRuler(memberId, rulerId) {
    const m = this.core.member(memberId);
    if (!m) return [];
    const err = (text) => [{ to: memberId, msg: { t: 'error', text } }];
    if (ITEMS[rulerId]?.kind !== 'ruler') return err('その定規は選べません');
    if (m.userId && this.env.DB) {
      try {
        await ensureSchema(this.env.DB);
        const r = await loadoutFor(this.env.DB, m.userId, rulerId);
        if (r.error) return err(r.error);
        return this.core.setLoadout(memberId, r.loadout);
      } catch {
        return err('定規を読み込めませんでした。もう一度お試しください');
      }
    }
    if (ITEMS[rulerId].rarity !== 'basic') return err('この定規を使うにはログインが必要です');
    return this.core.setLoadout(memberId, resolveLoadout({ ruler: rulerId }));
  }

  // 決着した対戦をアカウントに記録し、えんぴつを配る
  async saveRecord(rec) {
    if (!this.env.DB || !rec.players.some((p) => p.userId)) return;
    try {
      await ensureSchema(this.env.DB);
      const rewards = await recordMatch(this.env.DB, rec);
      for (const p of rec.players) {
        const r = p.userId && rewards[p.userId];
        if (!r) continue;
        this.sendTo(p.memberId, { t: 'reward', coins: r.coins, total: r.total, capped: r.capped, exp: r.exp || null });
        // レベルが上がったら、部屋で使っている定規にもすぐ反映する
        const m = this.core.member(p.memberId);
        if (r.exp?.levelUp && m && m.loadout?.ruler === r.exp.ruler) {
          const lo = await loadoutFor(this.env.DB, p.userId, r.exp.ruler);
          if (lo.loadout) for (const o of this.core.setLoadout(p.memberId, lo.loadout)) if (o.to === 'all') this.broadcast(o.msg);
        }
      }
      await this.save();
    } catch (e) {
      console.error('記録の保存に失敗', e);
    }
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
    this.core.tick();
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

  // 保存して、次に起きる時刻（対戦の開始時刻か、片付けの時刻）を予約する
  async save() {
    if (!this.core) return;
    await this.ctx.storage.put('core', this.core.toJSON());
    const startAt = this.core.s.phase === 'lobby' ? this.core.s.startAt : null;
    await this.ctx.storage.setAlarm(startAt ?? Date.now() + IDLE_LIMIT_MS);
  }

  async alarm() {
    // ステージ用（部屋を持たない）なら、途中の攻略が残っている間は片付けない
    if (!this.core && await stageAlarm(this)) return;
    if (this.core && this.core.s.phase === 'lobby' && this.core.s.startAt !== null) {
      // カウントダウンが終わったら、準備OKでなくても全員で始める
      if (this.core.tick(Date.now())) this.broadcast({ t: 'state', state: this.core.snapshot() });
      await this.save();
      return;
    }
    const idle = !this.core || Date.now() - this.core.s.lastActive >= IDLE_LIMIT_MS - 1000;
    if (idle && this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll();
      this.core = null;
    } else {
      await this.save();
    }
  }
}
