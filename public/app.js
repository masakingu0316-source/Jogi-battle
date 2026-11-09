// 画面の切り替え・サーバーとの通信・はじく操作・動きの再生
import Physics from './shared/physics.js';
import { DESKS, MODES, PLAYERS, TEAMS, teamOf, playableReason } from './shared/rules.js';
import { createBoard, MAX_DRAG } from './board.js';
import { ITEMS, BASIC_RULERS, ECONOMY, accText } from './shared/catalog.js';
import { previewRuler } from './ruler-paint.js';
import { createAccount } from './account.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { } },
  del(k) { try { localStorage.removeItem(k); } catch { } },
};
const tokenKey = (code) => 'jogi:token:' + code;
const CODE_RE = /^[A-Z0-9]{5}$/;
const FPS = 30;

const app = {
  code: null, ws: null, you: null, state: null,
  playing: null, pendingState: null, aim: null, waitingShot: false, fx: [],
  retries: 0, closedByUs: false, fatal: false, pingTimer: 0, reconnectTimer: 0,
  view: 'room', prevPhase: null, config: null, me: null, lastReward: null,
};
const board = createBoard($('board'), $('boardWrap'));
let account; // 下で作る（画面の関数を渡すため）

// ---------------- 共通 ----------------
let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
let hintTimer = 0;
function hint(text) {
  $('hint').textContent = text;
  $('hint').hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { $('hint').hidden = true; }, 2800);
}
function setConn(text) {
  $('conn').textContent = text || '';
  $('conn').hidden = !text;
}
function show(screen) {
  for (const id of ['home', 'lobby', 'game', 'mypage']) $(id).hidden = id !== screen;
}
const myName = () => $('name').value.trim() || 'ゲスト';
const memberById = (id) => app.state?.members.find((m) => m.id === id) || null;
const isHost = () => app.state && app.you && app.state.hostId === app.you.id;
function send(msg) {
  if (app.ws && app.ws.readyState === WebSocket.OPEN) app.ws.send(JSON.stringify(msg));
  else toast('接続が切れています。つながり直すまでお待ちください');
}

// ---------------- ホーム ----------------
$('name').value = store.get('jogi:name') || '';
$('name').addEventListener('change', () => store.set('jogi:name', $('name').value.trim()));
$('code').addEventListener('input', () => {
  $('code').value = $('code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

function homeError(text) {
  $('homeError').textContent = text || '';
  $('homeError').hidden = !text;
}

$('create').addEventListener('click', async () => {
  store.set('jogi:name', $('name').value.trim());
  homeError('');
  $('create').disabled = true;
  try {
    const res = await fetch('/api/rooms', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.code) throw new Error(data.error || '部屋を作れませんでした。時間をおいてもう一度お試しください。');
    connect(data.code);
  } catch (e) {
    homeError(e.message || '部屋を作れませんでした。');
  } finally {
    $('create').disabled = false;
  }
});

$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  store.set('jogi:name', $('name').value.trim());
  const code = $('code').value.trim().toUpperCase();
  if (!CODE_RE.test(code)) { homeError('部屋コードは5文字の英数字です。'); $('code').focus(); return; }
  homeError('');
  connect(code);
});

function toHome(errorText) {
  app.closedByUs = true;
  clearInterval(app.pingTimer);
  clearTimeout(app.reconnectTimer);
  if (app.ws) { try { app.ws.close(1000); } catch { } }
  app.ws = null; app.state = null; app.playing = null; app.aim = null; app.waitingShot = false;
  app.view = 'room'; app.prevPhase = null; app.lastReward = null;
  setConn(null);
  if (app.code) $('code').value = app.code;
  app.code = null;
  history.replaceState(null, '', location.pathname);
  show('home');
  homeError(errorText || '');
}

// ---------------- 通信 ----------------
function connect(code) {
  clearTimeout(app.reconnectTimer);
  if (app.ws) { app.closedByUs = true; try { app.ws.close(1000); } catch { } }
  app.code = code;
  app.closedByUs = false;
  app.fatal = false;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws`);
  app.ws = ws;
  ws.onopen = () => {
    app.retries = 0;
    ws.send(JSON.stringify({ t: 'hello', name: myName(), token: store.get(tokenKey(code)) }));
    clearInterval(app.pingTimer);
    app.pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 25000);
  };
  ws.onmessage = (e) => {
    if (e.data === 'pong') return;
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    onMessage(m);
  };
  ws.onclose = (e) => {
    if (app.ws !== ws) return;
    clearInterval(app.pingTimer);
    if (app.closedByUs || app.fatal) return;
    if (e.code === 4000) { app.fatal = true; toHome('別のタブか端末でこの部屋を開いたため、こちらの接続を終了しました。'); return; }
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (!app.code) return;
  if (app.retries >= 12) { toHome('サーバーにつながりません。通信環境を確かめて、もう一度入ってください。'); return; }
  const wait = Math.min(8000, 500 * 2 ** app.retries);
  app.retries++;
  setConn('再接続中…');
  const code = app.code;
  app.reconnectTimer = setTimeout(() => { if (app.code === code) connect(code); }, wait);
}

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      app.you = m.you;
      store.set(tokenKey(app.code), m.you.token);
      history.replaceState(null, '', `${location.pathname}?room=${app.code}`);
      setConn(null);
      app.waitingShot = false;
      applyState(m.state);
      break;
    case 'state':
      if (app.playing) app.pendingState = m.state;
      else applyState(m.state);
      break;
    case 'shot':
      app.waitingShot = false;
      startPlayback(m);
      break;
    case 'reward':
      app.lastReward = m;
      account.setCoins(m.total);
      if (app.state?.phase === 'over' && !app.playing && app.view === 'room') renderGame();
      break;
    case 'error':
      if (m.fatal) {
        app.fatal = true;
        if (/見つかりません/.test(m.text) && app.code) store.del(tokenKey(app.code));
        toHome(m.text);
      } else {
        app.waitingShot = false;
        toast(m.text);
        if (app.state) render();
      }
      break;
  }
}

function applyState(st) {
  app.state = st;
  render();
}

// ---------------- 画面の描画 ----------------
function render() {
  const st = app.state;
  if (!st) return;
  const started = st.phase === 'aim' && app.prevPhase !== 'aim';
  app.prevPhase = st.phase;
  if (started) app.lastReward = null;
  if (app.view === 'mypage') {
    if (!started) return;
    app.view = 'room';
    toast('対戦が始まりました');
  }
  if (st.phase === 'lobby') { show('lobby'); renderLobby(); }
  else {
    const wasHidden = $('game').hidden;
    show('game');
    board.setDesk(MODES[st.mode].desk);
    if (wasHidden) board.layout();
    renderGame();
  }
}

function renderLobby() {
  const st = app.state;
  const mode = MODES[st.mode];
  $('roomCode').textContent = st.code;
  $('inviteUrl').value = `${location.origin}${location.pathname}?room=${st.code}`;
  const slots = Math.max(st.members.length, mode.max);
  const rows = [];
  for (let i = 0; i < slots; i++) {
    const m = st.members[i];
    const pl = PLAYERS[i] || PLAYERS[0];
    if (!m) { rows.push(`<li class="empty"><span class="seat" style="color:${pl.color}">${pl.name}</span><span class="who">空き席</span><span></span></li>`); continue; }
    const badges = [
      m.id === st.hostId ? '<span class="badge">部屋主</span>' : '',
      app.you && m.id === app.you.id ? '<span class="badge you">あなた</span>' : '',
      m.connected ? '' : '<span class="badge off">接続待ち</span>',
    ].join('');
    rows.push(`<li><span class="seat" style="color:${pl.color}">${pl.name}</span>
      <span class="who">${esc(m.name)}${badges}<span class="sub">${esc(ITEMS[m.loadout?.ruler]?.name || '')}${m.loadout?.acc ? '・' + esc(accText(m.loadout.acc)) : ''}${m.account ? '' : '・ゲスト'}</span></span><span></span></li>`);
  }
  $('members').innerHTML = rows.join('');
  $('memberCount').textContent = `${st.members.length}人`;

  const host = isHost();
  $('modes').innerHTML = Object.entries(MODES).map(([k, md]) =>
    `<button type="button" data-mode="${k}" aria-pressed="${k === st.mode}" ${host ? '' : 'disabled'}>${md.name}</button>`).join('');
  const desk = DESKS[mode.desk];
  $('modeNote').textContent = `${mode.note}（${desk.w}×${desk.h}cm）`;

  renderMyRuler(memberById(app.you?.id));

  const reason = playableReason(st.mode, st.members.length)
    || (st.members.some((m) => !m.connected) ? '接続が切れている人がいます' : null);
  $('start').hidden = !host;
  $('start').disabled = !!reason;
  const hostName = memberById(st.hostId)?.name || '部屋主';
  $('startNote').textContent = host ? (reason || '') : `${hostName}さんが始めるのを待っています${reason ? `（${reason}）` : ''}`;
}

// 待合室の「自分の定規」。ログイン中は持っている定規から、ゲストは基本の4本から選ぶ
function renderMyRuler(me) {
  if (!me) return;
  const lo = me.loadout;
  const ids = me.account && app.me
    ? app.me.owned.filter((id) => ITEMS[id]?.kind === 'ruler')
    : BASIC_RULERS;
  const opts = ids.map((id) => `<option value="${id}">${esc(ITEMS[id].name)}${ITEMS[id].rarity !== 'basic' ? ` [${ITEMS[id].rarity}]` : ''}</option>`).join('');
  if ($('myRuler').dataset.opts !== opts) { $('myRuler').innerHTML = opts; $('myRuler').dataset.opts = opts; }
  $('myRuler').value = lo.ruler;
  previewRuler($('lobbyPreview'), lo, Math.max(0, app.state.members.findIndex((m) => m.id === me.id)));
  const bits = [];
  if (lo.acc) bits.push(`アクセサリ：${ITEMS[lo.acc].name}（${accText(lo.acc)}）`);
  if (!me.account) bits.push(app.config?.login ? 'ログインすると、ガチャで集めた定規や飾りが使えます。' : '');
  $('rulerNote').textContent = bits.filter(Boolean).join('　');
  $('openCase').hidden = !(me.account && app.me);
}

function renderGame() {
  const st = app.state, g = st.game;
  if (!g) return;
  const teams = MODES[st.mode].teams;
  const box = $('players');
  box.dataset.n = g.n;
  box.innerHTML = g.order.map((mid, i) => {
    const m = memberById(mid), pl = PLAYERS[i], p = g.players[i];
    const turn = st.phase === 'aim' && !app.playing && g.turn === i;
    const won = st.phase === 'over' && !app.playing && g.result?.winners.includes(i);
    const status = won ? '勝ち' : !p.alive ? (p.selfOut ? '自滅' : '脱落') : m && !m.connected ? '接続待ち' : '';
    const bits = [`<b>${st.wins[mid] || 0}</b>勝`];
    if (teams) bits.push(TEAMS[teamOf(i)].name);
    if (status) bits.push(status);
    if (app.you && mid === app.you.id) bits.push('あなた');
    return `<div class="player${turn ? ' is-turn' : ''}${p.alive || won ? '' : ' is-out'}">
      <span class="seat" style="color:${pl.color}">${pl.name}</span>
      <span class="who">${esc(m?.name || '?')}</span>
      <span class="stat">${bits.join('・')}</span></div>`;
  }).join('');

  const msg = $('msg');
  const cur = g.turn, curMember = memberById(g.order[cur]), pl = PLAYERS[cur];
  const mine = myTurn();
  if (app.playing || app.waitingShot) msg.textContent = '……';
  else if (st.phase === 'aim') {
    const first = g.shots < g.n ? '<span class="first">1周目・落ちても戻る</span>' : '';
    const tTag = teams ? `（${TEAMS[teamOf(cur)].name}）` : '';
    if (mine) msg.innerHTML = `<b style="color:${pl.color}">あなたの番</b>${tTag}<span>自分の定規を押さえて、引っぱって離す</span>${first}`;
    else msg.innerHTML = `<span><b style="color:${pl.color}">${esc(curMember?.name || '?')}</b>${tTag}の番です${curMember && !curMember.connected ? '（接続が切れています）' : ''}</span>${first}`;
  } else msg.textContent = '対戦終了';
  $('board').classList.toggle('can-aim', canAim());
  $('skip').hidden = !(isHost() && st.phase === 'aim' && !app.playing && curMember && !curMember.connected);

  const over = st.phase === 'over' && !app.playing;
  $('result').hidden = !over;
  if (over && g.result) {
    const r = g.result;
    $('resultTitle').textContent = r.title;
    $('resultTitle').style.color = teams ? TEAMS[teamOf(r.winners[0])].color : PLAYERS[r.winners[0]].color;
    $('resultReason').textContent = r.reason;
    $('resultOrder').textContent = r.outOrder.length ? '脱落の順：' + r.outOrder.join(' → ') : '';
    const rw = app.lastReward;
    $('resultReward').hidden = !rw;
    if (rw) {
      $('resultReward').textContent = rw.coins
        ? `${ECONOMY.currency} +${rw.coins}${ECONOMY.unit}（合計 ${rw.total}${ECONOMY.unit}）${rw.capped ? '　今日の対戦ぶんは上限に達しました' : ''}`
        : '今日の対戦でもらえるえんぴつは上限に達しました（記録は残ります）';
    }
    $('resultActions').innerHTML = isHost()
      ? '<button class="btn-main" type="button" data-act="start">もう一回</button><button type="button" data-act="lobby">待合室へ（モード・メンバー変更）</button>'
      : `<span class="wait">${esc(memberById(st.hostId)?.name || '部屋主')}さんの操作を待っています</span>`;
  }
}

// ---------------- 待合室の操作 ----------------
$('myRuler').addEventListener('change', () => send({ t: 'ruler', ruler: $('myRuler').value }));
$('modes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (b && !b.disabled) send({ t: 'mode', mode: b.dataset.mode });
});
$('start').addEventListener('click', () => send({ t: 'start' }));
$('copyInvite').addEventListener('click', async () => {
  const input = $('inviteUrl');
  try {
    await navigator.clipboard.writeText(input.value);
    toast('招待リンクをコピーしました');
  } catch {
    input.select();
    toast('リンクを選択しました。コピーして送ってください');
  }
});
$('leave').addEventListener('click', () => {
  if (app.code) store.del(tokenKey(app.code));
  toHome('');
});
$('resultActions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) send({ t: b.dataset.act });
});
$('skip').addEventListener('click', () => send({ t: 'skip' }));

// ---------------- はじく操作 ----------------
function myIndex() {
  const g = app.state?.game;
  return g && app.you ? g.order.indexOf(app.you.id) : -1;
}
function myTurn() {
  const g = app.state?.game;
  return !!g && app.state.phase === 'aim' && g.turn === myIndex();
}
function canAim() { return myTurn() && !app.playing && !app.waitingShot; }

function contactWorld(b, lx, ly) {
  const c = Math.cos(b.a), s = Math.sin(b.a);
  return { x: b.x + lx * c - ly * s, y: b.y + lx * s + ly * c };
}

const canvas = $('board');
canvas.addEventListener('pointerdown', (e) => {
  if (!canAim()) {
    if (app.state?.phase === 'aim' && !app.playing && !app.waitingShot) hint('今はほかの人の番です');
    return;
  }
  const g = app.state.game, b = g.bodies[g.turn];
  const spec = Physics.RULERS[b.specKey];
  const hx = spec.length / 2, hy = spec.width / 2;
  const p = board.toWorld(e.clientX, e.clientY);
  const c = Math.cos(b.a), s = Math.sin(b.a);
  const dx = p.x - b.x, dy = p.y - b.y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const tol = Math.max(0.8, (e.pointerType === 'touch' ? 16 : 8) / board.scale);
  if (Math.abs(lx) > hx + tol || Math.abs(ly) > hy + tol) {
    hint(`自分の定規（${PLAYERS[g.turn].name}）を押さえてから引っぱってください`);
    return;
  }
  app.aim = { b, lx: Math.max(-hx, Math.min(hx, lx)), ly: Math.max(-hy, Math.min(hy, ly)), px: p.x, py: p.y };
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
});
canvas.addEventListener('pointermove', (e) => {
  if (!app.aim) return;
  const p = board.toWorld(e.clientX, e.clientY);
  app.aim.px = p.x; app.aim.py = p.y;
});
canvas.addEventListener('pointerup', () => {
  const a = app.aim;
  if (!a) return;
  app.aim = null;
  const cp = contactWorld(a.b, a.lx, a.ly);
  const dx = a.px - cp.x, dy = a.py - cp.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.8) { hint('定規を押さえたまま、はじきたい方向と逆に引っぱって離します'); return; }
  const power = Math.min(len, MAX_DRAG) / MAX_DRAG;
  send({ t: 'flick', lx: a.lx, ly: a.ly, dx: -dx / len, dy: -dy / len, power });
  app.waitingShot = true;
  renderGame();
});
canvas.addEventListener('pointercancel', () => { app.aim = null; });

// ---------------- 動きの再生 ----------------
function startPlayback(m) {
  app.aim = null;
  app.pendingState = null;
  app.playing = {
    frames: m.frames, falls: m.falls, by: m.by, saved: m.saved, next: m.state,
    looks: m.state.game.bodies.map((b) => ({ specKey: b.specKey, pattern: b.pattern, sticker: b.sticker })),
    start: performance.now(), fallStart: {}, fxDone: 0,
  };
  if (app.state) renderGame();
}

function playbackBodies(now) {
  const p = app.playing;
  const t = (now - p.start) / 1000 * FPS;
  const last = p.frames.length - 1;
  const i = Math.max(0, Math.min(last, Math.floor(t)));
  const j = Math.min(last, i + 1);
  const frac = Math.max(0, Math.min(1, t - i));
  const A = p.frames[i], B = p.frames[j];
  const bodies = [];
  for (let k = 0; k < p.looks.length; k++) {
    const o = k * 4;
    const s = A[o + 3];
    if (s === 2) continue;
    let alpha = 1, scale = 1;
    if (s === 1) {
      if (p.fallStart[k] === undefined) p.fallStart[k] = i;
      const ft = Math.min(1, (t - p.fallStart[k]) / (0.7 * FPS));
      alpha = 1 - ft; scale = 1 - 0.38 * ft;
    }
    const lerp = (q) => (A[o + q] + (B[o + q] - A[o + q]) * frac);
    bodies.push({ owner: k, ...p.looks[k], x: lerp(0) / 100, y: lerp(1) / 100, a: lerp(2) / 1000, alpha, scale });
  }
  // 落ちた瞬間の文字
  while (p.fxDone < p.falls.length && p.falls[p.fxDone].f <= t) {
    const f = p.falls[p.fxDone++];
    const d = DESKS[MODES[app.state.mode].desk];
    const word = p.saved ? 'セーフ' : f.owner === p.by ? '自滅！' : '落ちた！';
    app.fx.push({
      x: Math.max(-d.w / 2, Math.min(d.w / 2, f.x)), y: Math.max(-d.h / 2, Math.min(d.h / 2, f.y)),
      t0: now, text: `${PLAYERS[f.owner].name} ${word}`, color: PLAYERS[f.owner].color,
    });
  }
  if (t > last + 0.45 * FPS) finishPlayback();
  return bodies;
}

function finishPlayback() {
  const p = app.playing;
  app.playing = null;
  const next = app.pendingState || p.next;
  app.pendingState = null;
  applyState(next);
  if (p.saved) hint('1周目なので、落ちた定規は元の席に戻りました');
}

function frame(now) {
  if (app.state && !$('game').hidden && app.state.game) {
    const g = app.state.game;
    let bodies;
    if (app.playing) bodies = playbackBodies(now);
    else bodies = g.bodies.filter((b) => b.state === 'desk').map((b) => ({ ...b, alpha: 1, scale: 1 }));
    let aim = null;
    if (app.aim) {
      const cp = contactWorld(app.aim.b, app.aim.lx, app.aim.ly);
      aim = { cx: cp.x, cy: cp.y, px: app.aim.px, py: app.aim.py };
    }
    app.fx = app.fx.filter((f) => now - f.t0 < 1600);
    const active = !app.playing && app.state.phase === 'aim' ? g.turn : -1;
    board.draw({ bodies, active, aim, fx: app.fx, now });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------- 起動 ----------------
account = createAccount({ app, $, esc, toast, show, render: () => render(), send });
// ログインから戻ってきたときに部屋に入り直せるよう、状態を読み込んでから接続する
await account.load();
const params = new URLSearchParams(location.search);
const roomParam = (params.get('room') || '').toUpperCase();
show('home');
if (CODE_RE.test(roomParam)) {
  $('code').value = roomParam;
  // 以前この部屋に入っていた端末なら、そのまま席に戻る
  if (store.get(tokenKey(roomParam))) connect(roomParam);
  else { homeError(''); $('name').focus(); }
}
document.fonts?.ready?.then(() => { if (!$('game').hidden) board.layout(); });
