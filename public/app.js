// 画面の切り替え・サーバーとの通信・はじく操作・動きの再生
// 流れ：ログイン → ホーム（部屋を作る／入る／定規の編集） → 部屋（全員が準備OKか1分で開始） → 対戦 → 部屋に戻る
import Physics from './shared/physics.js';
import { DESKS, MODES, PLAYERS, TEAMS, teamOf, deskTiles, SKILLS, SHAPE_SKILL, GAUGE } from './shared/rules.js';
import { VERSION } from './shared/version.js';
import { CPU_LEVELS } from './shared/cpu.js';
import { createPractice } from './practice.js';
import { createBoard, MAX_DRAG } from './board.js';
import { ITEMS, BASIC_RULERS, ECONOMY, MATERIAL_INFO, DEFAULT_RULER, accText as accTextOf, defaultConfig, resolveLoadout } from './shared/catalog.js';
import { matChip, levelHtml, levelOfRuler, affinityText, skillText } from './ruler-info.js';
import { previewRuler, paintRuler } from './ruler-paint.js';
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
const accText = (id) => accTextOf(id, app.game || defaultConfig());

const app = {
  code: null, ws: null, you: null, state: null,
  playing: null, pendingState: null, aim: null, waitingShot: false, fx: [],
  retries: 0, closedByUs: false, fatal: false, pingTimer: 0, reconnectTimer: 0,
  view: 'home',            // home | room | mypage
  config: null, me: null, game: null, lastReward: null,
  startDeadline: null,     // 自動で始まる時刻（この端末の時計で）
  playedGame: null,        // 自分が参加した対戦の番号（結果を見せるため）
  dismissedGame: null,     // 「部屋に戻る」を押した対戦の番号
  pickedMode: store.get('jogi:mode') || 'standard',
  cpuLevel: store.get('jogi:cpu') || 'normal',
};
if (!MODES[app.pickedMode]) app.pickedMode = 'standard';
const board = createBoard($('board'), $('boardWrap'));
let account; // 下で作る（画面の関数を渡すため）

// ---------------- 共通 ----------------
let toastTimer = 0;
// ---------------- 必殺技 ----------------
const skillOf = (body) => SHAPE_SKILL[Physics.RULERS[body?.specKey]?.shape] || null;
$('msg').addEventListener('click', (e) => {
  if (!e.target.closest('#skillBtn')) return;
  app.skillArmed = !app.skillArmed;
  const sk = skillOf(app.state?.game?.bodies[app.state.game.turn]);
  if (app.skillArmed && sk) hint(`必殺技「${SKILLS[sk].name}」：${SKILLS[sk].desc}`);
  renderGame();
});

// ---------------- 新しい版のお知らせ ----------------
// 画面を開いたままの端末が古い版で遊び続けると、新しいルールの表示（机が消える予告など）が出ない。
// サーバーの版と違えば、再読み込みのボタンを出す（対戦中でも、同じ席に戻れる）
function showUpdate() {
  $('updateBar').hidden = false;
}
$('reloadBtn').addEventListener('click', () => location.reload());
async function checkVersion() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    const c = await r.json();
    if (c.version && c.version !== VERSION) showUpdate();
  } catch { /* 通信できなければ次の機会に */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });

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
  for (const id of ['login', 'home', 'lobby', 'game', 'mypage']) $(id).hidden = id !== screen;
}
const memberById = (id) => app.state?.members.find((m) => m.id === id) || null;
const isHost = () => app.state && app.you && app.state.hostId === app.you.id;
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function send(msg) {
  if (app.practice) return app.practice.send(msg);
  if (app.ws && app.ws.readyState === WebSocket.OPEN) { app.ws.send(JSON.stringify(msg)); return true; }
  toast('接続が切れています。つながり直すまでお待ちください');
  return false;
}
function setError(id, text) {
  $(id).textContent = text || '';
  $(id).hidden = !text;
}
const roomParam = () => {
  const r = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  return CODE_RE.test(r) ? r : null;
};

// ---------------- ログイン ----------------
function showLogin(errorText) {
  app.view = 'home';
  show('login');
  const invited = roomParam();
  $('inviteNote').hidden = !invited;
  if (invited) $('inviteNote').innerHTML = `部屋 <b>${invited}</b> に招待されています。ログインすると、そのまま部屋に入ります。`;
  $('loginBtn').href = `/auth/login?return=${encodeURIComponent(location.pathname + location.search)}`;
  if (!app.config?.login) {
    $('loginBtn').hidden = true;
    setError('loginError', 'ログインの準備がまだできていません。サイトの管理者に、Googleログインの設定を確認するよう伝えてください。');
  } else {
    $('loginBtn').hidden = false;
    setError('loginError', errorText || '');
  }
  drawLoginArt();
}

// 机の上に定規が2本。ログイン画面の絵
function drawLoginArt() {
  const c = $('loginArt');
  const ctx = c.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = c.clientWidth || 480, h = c.clientHeight || 360;
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const cs = getComputedStyle(document.documentElement);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = cs.getPropertyValue('--floor').trim() || '#c9d0db';
  ctx.fillRect(0, 0, w, h);
  const s = w / 80; // 横80cmぶん
  ctx.setTransform(s * dpr, 0, 0, s * dpr, w / 2 * dpr, h / 2 * dpr);
  ctx.save();
  ctx.shadowColor = 'rgba(20, 28, 50, 0.3)'; ctx.shadowBlur = 14 * dpr; ctx.shadowOffsetY = 4 * dpr;
  ctx.fillStyle = '#d9bb8f';
  ctx.beginPath(); ctx.roundRect(-32.5, -22.5, 65, 45, 1.4); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(122, 78, 38, 0.12)'; ctx.lineWidth = 0.12;
  for (let y = -21; y < 22; y += 1.7) { ctx.beginPath(); ctx.moveTo(-32, y); ctx.bezierCurveTo(-10, y + 0.6, 10, y - 0.6, 32, y + 0.3); ctx.stroke(); }
  paintRuler(ctx, { owner: 0, specKey: 'straight30-acrylic', x: -10, y: 4, a: -0.35, pattern: null, sticker: 'sticker:star' }, s);
  paintRuler(ctx, { owner: 1, specKey: 'tri45-metal', level: 7, x: 13, y: -6, a: 0.5 }, s, false, 900);
  paintRuler(ctx, { owner: 3, specKey: 'protractor-rubber', x: 15, y: 11, a: -0.2 }, s);
}

// ---------------- ホーム ----------------
function showHome(errorText) {
  app.view = 'home';
  show('home');
  renderHome();
  setError('homeError', errorText || '');
}

function renderHome() {
  if (!app.me) return;
  $('hello').innerHTML = `<b>${esc(app.me.name)}</b> さん、どの遊び方にしますか？`;
  const sizes = { single: 'd1', pair: 'd2', group: 'd4' };
  $('modePick').innerHTML = Object.entries(MODES).map(([k, m]) => {
    const d = DESKS[m.desk];
    const n = m.min === m.max ? `${m.max}人` : `${m.min}〜${m.max}人`;
    const cells = { d1: 1, d2: 2, d4: 4 }[sizes[m.desk]];
    return `<button type="button" class="mode-opt" role="radio" data-mode="${k}" aria-checked="${k === app.pickedMode}">
      <span class="desks ${sizes[m.desk]}" aria-hidden="true">${'<i></i>'.repeat(cells)}</span>
      <span class="mo-name">${m.name}</span>
      <span class="mo-sub">${n}・${d.name}（${d.w}×${d.h}cm）<br>${m.note.split('。')[1] || ''}</span>
    </button>`;
  }).join('');
  renderPractice();
  const sel = app.me.selectedRuler;
  const setup = app.me.setups?.[sel] || {};
  const item = ITEMS[sel] || ITEMS[DEFAULT_RULER];
  const lv = levelOfRuler(app.me, item.id);
  previewRuler($('homePreview'), { specKey: item.specKey, level: lv.level, pattern: setup.pattern, sticker: setup.sticker });
  const extras = [setup.pattern && ITEMS[setup.pattern]?.name, setup.sticker && ITEMS[setup.sticker]?.name,
    setup.acc && `${ITEMS[setup.acc]?.name}（${accText(setup.acc)}）`].filter(Boolean).join('・');
  $('homeRuler').innerHTML = `${esc(item.name)}<span class="ruler-meta">${matChip(item.mat)}${levelHtml(lv)}</span><small>${esc(extras || '飾り・アクセサリなし')}</small>`;
}

$('modePick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  app.pickedMode = b.dataset.mode;
  store.set('jogi:mode', app.pickedMode);
  for (const x of document.querySelectorAll('.mode-opt')) x.setAttribute('aria-checked', String(x.dataset.mode === app.pickedMode));
  renderPractice();
});
// ---------------- コンピュータと練習 ----------------
// 遊び方ごとのコンピュータの人数（乱戦だけ選べる）
const cpuCountOf = (mode) => (mode === 'melee' ? +$('cpuCount').value : MODES[mode].max - 1);
function renderPractice() {
  const lv = app.cpuLevel || 'normal';
  $('cpuLevel').innerHTML = Object.entries(CPU_LEVELS).map(([k, l]) =>
    `<button type="button" data-level="${k}" aria-pressed="${k === lv}">${l.name}</button>`).join('');
  $('cpuCountWrap').hidden = app.pickedMode !== 'melee';
  const n = cpuCountOf(app.pickedMode);
  const team = MODES[app.pickedMode].teams ? '（味方1人・相手2人）' : '';
  $('practiceNote').textContent = `${MODES[app.pickedMode].name}：あなたとコンピュータ${n}人${team}`;
}
$('cpuLevel').addEventListener('click', (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  app.cpuLevel = b.dataset.level;
  store.set('jogi:cpu', app.cpuLevel);
  renderPractice();
});
$('cpuCount').addEventListener('change', renderPractice);
// 自分の定規（持っている定規の装備とレベルのまま）
function myLoadout(rulerId) {
  if (!app.me) return null;
  const id = rulerId || app.me.selectedRuler;
  if (!app.me.owned.includes(id) || ITEMS[id]?.kind !== 'ruler') return null;
  return resolveLoadout({ ...(app.me.setups?.[id] || {}), ruler: id }, app.game, levelOfRuler(app.me, id).level);
}
$('practiceBtn').addEventListener('click', () => {
  setError('homeError', '');
  const mode = app.pickedMode;
  stopRoom();
  app.view = 'room';
  app.practice = createPractice({
    mode, cpus: cpuCountOf(mode), level: app.cpuLevel || 'normal',
    name: app.me?.name || 'あなた',
    loadout: myLoadout() || resolveLoadout({}),
    loadoutFor: (id) => myLoadout(id),
    onMessage: (m) => onMessage(m),
    busy: () => !!app.playing,
  });
  show('lobby');
});

$('code').addEventListener('input', () => {
  $('code').value = $('code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
$('create').addEventListener('click', async () => {
  setError('homeError', '');
  $('create').disabled = true;
  try {
    const res = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: app.pickedMode }) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { app.me = null; showLogin('ログインの有効期限が切れました。もう一度ログインしてください。'); return; }
    if (!res.ok || !data.code) throw new Error(data.error || '部屋を作れませんでした。時間をおいてもう一度お試しください。');
    connect(data.code);
  } catch (e) {
    setError('homeError', e.message || '部屋を作れませんでした。');
  } finally {
    $('create').disabled = false;
  }
});
$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('code').value.trim().toUpperCase();
  if (!CODE_RE.test(code)) { setError('homeError', '部屋コードは5文字の英数字です。'); $('code').focus(); return; }
  setError('homeError', '');
  connect(code);
});
$('editRuler').addEventListener('click', () => account.open('case'));
for (const b of document.querySelectorAll('[data-open]')) b.addEventListener('click', () => account.open(b.dataset.open));

// 今の部屋（オンライン・練習）を閉じる
function stopRoom() {
  app.closedByUs = true;
  clearInterval(app.pingTimer);
  clearTimeout(app.reconnectTimer);
  if (app.ws) { try { app.ws.close(1000); } catch { } }
  if (app.practice) app.practice.close();
  app.practice = null;
  app.ws = null; app.state = null; app.playing = null; app.aim = null; app.waitingShot = false;
}
// 部屋から出てホームへ
function leaveRoom(errorText) {
  stopRoom();
  app.lastReward = null; app.startDeadline = null;
  setConn(null);
  if (app.code && errorText) $('code').value = app.code;
  app.code = null;
  history.replaceState(null, '', location.pathname);
  if (app.me) { account.refresh().then(() => { if (app.view === 'home' && !$('home').hidden) renderHome(); }); showHome(errorText); }
  else showLogin(errorText);
}

// ---------------- 通信 ----------------
function connect(code) {
  if (app.practice) { app.practice.close(); app.practice = null; }
  clearTimeout(app.reconnectTimer);
  if (app.ws) { app.closedByUs = true; try { app.ws.close(1000); } catch { } }
  app.code = code;
  app.closedByUs = false;
  app.fatal = false;
  app.view = 'room';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws`);
  app.ws = ws;
  ws.onopen = () => {
    app.retries = 0;
    ws.send(JSON.stringify({ t: 'hello', version: VERSION, name: app.me?.name || 'ゲスト', token: store.get(tokenKey(code)) }));
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
    if (e.code === 4000) { app.fatal = true; leaveRoom('別のタブか端末でこの部屋を開いたため、こちらの接続を終了しました。'); return; }
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (!app.code) return;
  if (app.retries >= 12) { leaveRoom('サーバーにつながりません。通信環境を確かめて、もう一度入ってください。'); return; }
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
      if (app.code) {
        store.set(tokenKey(app.code), m.you.token);
        history.replaceState(null, '', `${location.pathname}?room=${app.code}`);
      }
      setConn(null);
      app.waitingShot = false;
      applyState(m.state);
      break;
    case 'state':
      if (app.playing) app.pendingState = m.state;
      else applyState(m.state);
      if (m.vanished) toast(m.vanished.drops.length ? '机が消えて、定規が落ちました' : '机が1台消えました');
      break;
    case 'shot':
      app.waitingShot = false;
      startPlayback(m);
      break;
    case 'update':
      showUpdate();
      break;
    case 'reward':
      app.lastReward = m;
      account.setCoins(m.total);
      if (m.exp && app.me) app.me.exp = { ...(app.me.exp || {}), [m.exp.ruler]: m.exp.exp };
      if (showingResult()) renderGame();
      break;
    case 'left':
      if (app.code) store.del(tokenKey(app.code));
      leaveRoom('');
      break;
    case 'error':
      if (m.fatal) {
        app.fatal = true;
        if (app.code) store.del(tokenKey(app.code));
        if (m.login) { app.me = null; leaveRoom(m.text); return; }
        leaveRoom(m.text);
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
  app.startDeadline = st.startIn === null || st.startIn === undefined ? null : performance.now() + st.startIn;
  render();
}

// ---------------- 画面の描画 ----------------
// 自分が参加した対戦の結果を、まだ閉じていなければ見せる
function showingResult() {
  const st = app.state;
  return !!st && st.phase === 'lobby' && !!st.game?.result && !app.playing
    && st.game.id === app.playedGame && app.dismissedGame !== st.game.id;
}

function render() {
  const st = app.state;
  if (!st) return;
  const inGame = st.phase === 'aim' && app.you && st.game?.order.includes(app.you.id);
  if (inGame && app.playedGame !== st.game.id) {
    // 新しい対戦が始まった
    app.playedGame = st.game.id;
    app.lastReward = null;
    if (app.view === 'mypage') { app.view = 'room'; toast('対戦が始まりました'); }
  }
  if (app.view !== 'room') return;
  if (st.phase === 'aim' || showingResult()) {
    const wasHidden = $('game').hidden;
    show('game');
    board.setDesk(MODES[st.mode].desk);
    if (wasHidden) board.layout();
    renderGame();
  } else {
    show('lobby');
    renderLobby();
  }
}

function renderLobby() {
  const st = app.state;
  const mode = MODES[st.mode];
  const desk = DESKS[mode.desk];
  const practice = !!app.practice;
  $('roomMode').textContent = practice
    ? `コンピュータと練習（${app.practice.level.name}）・${mode.name}・${desk.name}`
    : `${mode.name}・${mode.min === mode.max ? mode.max + '人' : mode.min + '〜' + mode.max + '人'}・${desk.name}　部屋コード`;
  document.querySelector('.room-head').classList.toggle('practice-head', practice);
  $('seatNote').hidden = practice;
  $('leave').textContent = practice ? '練習をやめてホームへ' : '部屋を出てホームへ';
  $('roomCode').textContent = st.code;
  $('inviteUrl').value = `${location.origin}${location.pathname}?room=${st.code}`;
  const rows = [];
  for (let i = 0; i < mode.max; i++) {
    const m = st.members[i];
    const pl = PLAYERS[i];
    if (!m) { rows.push(`<li class="empty"><span class="seat" style="color:var(--seat-${i})">${pl.name}</span><span class="who">空き席</span><span></span></li>`); continue; }
    const badges = [
      app.you && m.id === app.you.id ? '<span class="badge you">あなた</span>' : '',
      m.connected ? '' : '<span class="badge off">接続待ち</span>',
    ].join('');
    const team = mode.teams ? `${TEAMS[teamOf(i)].name}・` : '';
    rows.push(`<li><span class="seat" style="color:var(--seat-${i})">${pl.name}</span>
      <span class="who">${esc(m.name)}${badges}<span class="sub">${team}${esc(ITEMS[m.loadout?.ruler]?.name || '')} Lv.${m.loadout?.level || 1}${m.loadout?.acc ? '・' + esc(accText(m.loadout.acc)) : ''}・${st.wins[m.id] || 0}勝</span></span>
      <span class="state${m.ready ? ' ok' : ''}">${m.ready ? '準備OK' : '準備中'}</span></li>`);
  }
  $('members').innerHTML = rows.join('');
  $('memberCount').textContent = `${st.members.length} / ${mode.max}人`;

  const me = memberById(app.you?.id);
  renderMyRuler(me);
  const ready = !!me?.ready;
  $('readyBtn').setAttribute('aria-pressed', String(ready));
  $('readyBtn').textContent = ready ? '準備OKを取り消す' : '準備OK';
  const waitingFor = st.members.filter((m) => !m.ready).length;
  $('readyNote').textContent = ready
    ? (waitingFor ? `ほかの${waitingFor}人の準備を待っています` : '')
    : '定規を決めたら押してください';
  updateCountdown();
}

// カウントダウンの表示（部屋と結果画面）
function updateCountdown() {
  const st = app.state;
  if (!st || st.phase !== 'lobby') return;
  const mode = MODES[st.mode];
  const need = mode.min - st.members.length;
  const left = app.startDeadline === null ? null : app.startDeadline - performance.now();
  const box = $('countdown');
  if (need > 0) {
    box.className = 'countdown waiting';
    $('cdText').textContent = `あと${need}人そろうと始められます（${mode.name}は${mode.min === mode.max ? mode.max + '人' : mode.min + '人から'}）。招待リンクを友だちに送りましょう。`;
  } else if (st.members.some((m) => !m.connected)) {
    box.className = 'countdown waiting';
    $('cdText').textContent = '接続が切れている人がいます。戻ってくるか、部屋から外れるのを待っています。';
  } else if (left !== null) {
    box.className = 'countdown' + (left < 10000 ? ' soon' : '');
    $('cdTime').textContent = mmss(left);
    $('cdText').textContent = '全員が準備OKになると、すぐに始まります。時間になると、準備中の人も一緒に始まります。';
  } else {
    box.className = 'countdown waiting';
    $('cdText').textContent = '全員が準備OKになると始まります。';
  }
  if (showingResult()) {
    $('resultNext').textContent = need > 0 ? '' : left !== null ? `次の対戦は ${mmss(left)} 後に自動で始まります（全員が準備OKならすぐ）` : '';
  }
}
setInterval(updateCountdown, 250);

// 部屋の「自分の定規」。持っている定規から選ぶ
function renderMyRuler(me) {
  if (!me) return;
  const lo = me.loadout;
  const ids = me.account && app.me ? app.me.owned.filter((id) => ITEMS[id]?.kind === 'ruler') : BASIC_RULERS;
  const ids2 = Object.keys(ITEMS).filter((id) => ids.includes(id)); // 定規ケースと同じ並び
  const opts = ids2.map((id) => `<option value="${id}">${esc(ITEMS[id].name)} Lv.${app.me && me.account ? levelOfRuler(app.me, id).level : 1}${ITEMS[id].rarity !== 'basic' ? ` [${ITEMS[id].rarity}]` : ''}</option>`).join('');
  if ($('myRuler').dataset.opts !== opts) { $('myRuler').innerHTML = opts; $('myRuler').dataset.opts = opts; }
  $('myRuler').value = lo.ruler;
  previewRuler($('lobbyPreview'), lo, Math.max(0, app.state.members.findIndex((m) => m.id === me.id)));
  const r = ITEMS[lo.ruler];
  $('rulerNote').innerHTML = `${matChip(r?.mat)} ${esc(r ? affinityText(r.mat) : '')}<br>${esc(skillText(lo.ruler))}${lo.acc ? `<br>アクセサリ：${esc(ITEMS[lo.acc].name)}（${esc(accText(lo.acc))}）` : ''}`;
  $('openCase').hidden = !(me.account && app.me);
}

function renderGame() {
  const st = app.state, g = st.game;
  if (!g) return;
  const teams = MODES[st.mode].teams;
  const over = showingResult();
  const box = $('players');
  box.dataset.n = g.n;
  box.innerHTML = g.order.map((mid, i) => {
    const m = memberById(mid), pl = PLAYERS[i], p = g.players[i];
    const turn = st.phase === 'aim' && !app.playing && g.turn === i;
    const won = over && g.result?.winners.includes(i);
    const status = won ? '勝ち' : !p.alive ? (p.selfOut ? '自滅' : '脱落') : st.phase === 'aim' && m && !m.connected ? '接続待ち' : '';
    const bits = [`<b>${st.wins[mid] || 0}</b>勝`];
    const body = g.bodies[i], mat = Physics.RULERS[body?.specKey]?.mat;
    if (mat) bits.push(`${MATERIAL_INFO[mat].name} Lv.${body.level || 1}`);
    if (teams) bits.push(TEAMS[teamOf(i)].name);
    if (status) bits.push(status);
    if (app.you && mid === app.you.id) bits.push('あなた');
    // 必殺技のゲージ
    const sk = skillOf(body), gv = g.gauge?.[i] ?? 0, full = gv >= GAUGE.max;
    const gauge = sk && g.gauge ? `<span class="sp${full ? ' full' : ''}" style="--sk:${SKILLS[sk].color}">
        <span class="gauge" role="img" aria-label="必殺技のゲージ ${Math.round(gv)}%"><i style="width:${Math.round((gv / GAUGE.max) * 100)}%"></i></span>
        <span class="sp-name">${SKILLS[sk].name}${full ? ' 使える' : ''}${body?.anchor ? '・発動中' : ''}</span></span>` : '';
    return `<div class="player${turn ? ' is-turn' : ''}${p.alive || won ? '' : ' is-out'}" style="--seat:var(--seat-${i})">
      <span class="seat" style="color:var(--seat-${i})">${pl.name}</span>
      <span class="who">${esc(m?.name || '（退出）')}</span>
      <span class="stat">${bits.join('・')}</span>${gauge}</div>`;
  }).join('');

  const msg = $('msg');
  const cur = g.turn, curMember = memberById(g.order[cur]);
  const mine = myTurn();
  if (app.playing || app.waitingShot) msg.textContent = '……';
  else if (st.phase === 'aim') {
    const first = (g.shots < g.n ? '<span class="first">1周目・落ちても戻る</span>' : '')
      + (g.vanish !== null && g.vanish !== undefined ? '<span class="vanish">この番が終わると、赤い斜線の机が消える</span>' : '');
    const tTag = teams ? `（${TEAMS[teamOf(cur)].name}）` : '';
    const sk = skillOf(g.bodies[cur]);
    const canSkill = mine && sk && !g.extra && (g.gauge?.[cur] ?? 0) >= GAUGE.max;
    if (!canSkill) app.skillArmed = false;
    const skillBtn = canSkill
      ? `<button type="button" class="skill-btn" id="skillBtn" aria-pressed="${!!app.skillArmed}" style="--sk:${SKILLS[sk].color}">${app.skillArmed ? `必殺技「${SKILLS[sk].name}」でうつ（もう一度押すとやめる）` : `必殺技「${SKILLS[sk].name}」を使う`}</button>`
      : '';
    const extra = g.extra ? `<span class="first" style="--sk:${SKILLS.double.color}">連打：もう1回はじける</span>` : '';
    if (mine) msg.innerHTML = `<b class="mine">あなたの番</b>${tTag}<span>自分の定規を押さえて、引っぱって離す</span>${extra}${first}${skillBtn}`;
    else msg.innerHTML = `<span><b style="color:var(--seat-${cur})">${esc(curMember?.name || '?')}</b>${tTag}の番です${curMember && !curMember.connected ? '（接続が切れています）' : ''}</span>${extra}${first}`;
  } else msg.textContent = '対戦終了';
  $('board').classList.toggle('can-aim', canAim());
  $('skip').hidden = !(isHost() && st.phase === 'aim' && !app.playing && curMember && !curMember.connected);
  $('quitPractice').hidden = !app.practice;

  $('result').hidden = !over;
  if (over) {
    const r = g.result;
    $('resultTitle').textContent = r.title;
    $('resultTitle').style.color = `var(--seat-${teams ? teamOf(r.winners[0]) : r.winners[0]})`;
    $('resultReason').textContent = r.reason;
    $('resultOrder').textContent = r.outOrder.length ? '脱落の順：' + r.outOrder.join(' → ') : '';
    const rw = app.lastReward;
    $('resultReward').hidden = !rw;
    if (rw) {
      const coins = rw.coins
        ? `${ECONOMY.currency} +${rw.coins}${ECONOMY.unit}（合計 ${rw.total}${ECONOMY.unit}）${rw.capped ? '　今日の対戦ぶんは上限に達しました' : ''}`
        : '今日の対戦でもらえるえんぴつは上限に達しました（記録は残ります）';
      const x = rw.exp;
      const exp = x ? `<small>${esc(ITEMS[x.ruler]?.name || '')}に経験値 +${x.gain}　${x.levelUp ? `<span class="lvup">レベルアップ！ Lv.${x.level}</span>` : `Lv.${x.level}${x.max ? '（最大）' : `・次のレベルまで あと${x.need - x.into}点`}`}</small>` : '';
      $('resultReward').innerHTML = esc(coins) + exp;
    }
    updateCountdown();
  }
}

// ---------------- 部屋の操作 ----------------
$('myRuler').addEventListener('change', () => send({ t: 'ruler', ruler: $('myRuler').value }));
$('readyBtn').addEventListener('click', () => {
  const me = memberById(app.you?.id);
  send({ t: 'ready', on: !me?.ready });
});
$('openCase').addEventListener('click', () => account.open('case'));
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
  if (!send({ t: 'leave' })) { if (app.code) store.del(tokenKey(app.code)); leaveRoom(''); }
});
$('backToRoom').addEventListener('click', () => {
  app.dismissedGame = app.state?.game?.id ?? null;
  render();
});
$('skip').addEventListener('click', () => send({ t: 'skip' }));
$('quitPractice').addEventListener('click', () => send({ t: 'leave' }));

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
  const spec = Physics.RULERS[b.specKey] || Physics.RULERS['straight30-acrylic'];
  const p = board.toWorld(e.clientX, e.clientY);
  const c = Math.cos(b.a), s = Math.sin(b.a);
  const dx = p.x - b.x, dy = p.y - b.y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const tol = Math.max(0.8, (e.pointerType === 'touch' ? 16 : 8) / board.scale);
  // 押さえた点を定規の上に収める（少しはみ出しても受け付ける）
  const near = Physics.nearestOnShape(spec.shape, lx, ly);
  if (near.dist > tol) {
    hint(`自分の定規（${PLAYERS[g.turn].name}）を押さえてから引っぱってください`);
    return;
  }
  app.aim = { b, lx: near.x, ly: near.y, px: p.x, py: p.y };
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
  send({ t: 'flick', lx: a.lx, ly: a.ly, dx: -dx / len, dy: -dy / len, power, skill: !!app.skillArmed });
  app.skillArmed = false;
  app.waitingShot = true;
  renderGame();
});
canvas.addEventListener('pointercancel', () => { app.aim = null; });

// ---------------- 動きの再生 ----------------
function startPlayback(m) {
  app.aim = null;
  app.pendingState = null;
  app.playing = {
    frames: m.frames, falls: m.falls, by: m.by, saved: m.saved, next: m.state, crit: m.crit, critDone: false,
    skill: m.skill || null, skillDone: false, wind: m.wind || null, windDone: false,
    vanished: m.vanished, vanishFx: false, desks: app.state?.game?.desks || null,
    looks: m.state.game.bodies.map((b) => ({ specKey: b.specKey, level: b.level, pattern: b.pattern, sticker: b.sticker, anchor: b.anchor })),
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
  // 動きが止まったあと、予告していた机が消える
  const vStart = last + 0.3 * FPS, vLen = 0.9 * FPS;
  const vt = p.vanished ? Math.max(0, Math.min(1, (t - vStart) / vLen)) : 0;
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
    } else if (vt > 0 && p.vanished.drops.includes(k)) {
      alpha = 1 - vt; scale = 1 - 0.38 * vt;
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
  // 必殺技：はじいた瞬間に技の名前（突風は風が起きたときに）
  if (p.skill && !p.skillDone && p.skill !== 'wind') {
    p.skillDone = true;
    const b0 = bodies.find((b) => b.owner === p.by);
    if (b0) app.fx.push({ x: b0.x, y: b0.y, t0: now, text: `${SKILLS[p.skill].name}！`, color: SKILLS[p.skill].color, big: true });
    if (!reducedMotion() && p.skill === 'power') app.shakeUntil = now + 200;
  }
  if (p.wind && !p.windDone && t >= p.wind.f) {
    p.windDone = true;
    app.fx.push({ x: p.wind.x, y: p.wind.y, t0: now, ring: p.wind.r, color: SKILLS.wind.color });
    app.fx.push({ x: p.wind.x, y: p.wind.y - 4, t0: now, text: '突風！', color: SKILLS.wind.color, big: true });
    if (!reducedMotion()) app.shakeUntil = now + 300;
  }
  // クリティカル：当たった瞬間に文字と光
  if (p.crit && !p.critDone && t >= p.crit.f) {
    p.critDone = true;
    app.fx.push({ x: p.crit.x, y: p.crit.y, t0: now, text: 'クリティカル！', color: '#ffd84a', big: true });
    app.fx.push({ x: p.crit.x, y: p.crit.y, t0: now, burst: true });
    if (!reducedMotion()) app.shakeUntil = now + 260;
  }
  if (p.vanished && !p.vanishFx && t >= vStart) {
    p.vanishFx = true;
    const tile = deskTiles(DESKS[MODES[app.state.mode].desk])[p.vanished.desk];
    const cx = (tile.x0 + tile.x1) / 2, cy = (tile.y0 + tile.y1) / 2;
    app.fx.push({ x: cx, y: cy, t0: now, text: '机が消えた！', color: '#ff8a7a' });
    p.vanished.drops.forEach((k, n) => app.fx.push({ x: cx, y: cy + 6 + n * 5, t0: now + 250, text: `${PLAYERS[k].name} 落ちた！`, color: PLAYERS[k].color }));
  }
  p.deskView = p.vanished && vt > 0 ? { left: (p.desks || []).filter((d) => d !== p.vanished.desk), fade: { i: p.vanished.desk, t: vt } } : null;
  const end = p.vanished ? vStart + vLen + 0.25 * FPS : last + 0.45 * FPS;
  if (t > end) finishPlayback();
  return bodies;
}
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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
      const sk = app.skillArmed ? skillOf(app.aim.b) : null;
      aim = { cx: cp.x, cy: cp.y, px: app.aim.px, py: app.aim.py, skill: sk && SKILLS[sk] };
    }
    app.fx = app.fx.filter((f) => now - f.t0 < 1600);
    const active = !app.playing && app.state.phase === 'aim' ? g.turn : -1;
    // 残っている机と、消える予告の机（再生中は、はじく前の状態のまま見せる）
    const desks = app.playing?.deskView || { left: g.desks || null, warn: app.state.phase === 'aim' ? g.vanish ?? null : null };
    board.draw({ bodies, active, aim, fx: app.fx, now, desks });
    // クリティカルの瞬間だけ、盤面を小さく揺らす
    const cv = $('board');
    if (app.shakeUntil && now < app.shakeUntil) cv.style.transform = `translate(${(Math.random() - 0.5) * 6}px, ${(Math.random() - 0.5) * 6}px)`;
    else if (cv.style.transform) { cv.style.transform = ''; app.shakeUntil = 0; }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------- 起動 ----------------
account = createAccount({
  app, $, esc, toast, show, send,
  render: () => render(),
  showHome: () => showHome(),
  onLogout: () => { if (app.state) { send({ t: 'leave' }); } app.me = null; leaveRoom(''); },
  onProfile: () => { if (!$('home').hidden) renderHome(); },
});
// 確認用：?debug を付けて開いたときだけ、今の状態を読めるようにする
if (new URLSearchParams(location.search).has('debug')) window.__jogiState = () => structuredClone(app.state);
await account.load();
if (app.config?.version && app.config.version !== VERSION) showUpdate();
if (!app.me) {
  showLogin();
} else if (roomParam()) {
  // 招待リンクから来た／部屋の途中で開き直した
  connect(roomParam());
  show('lobby');
} else {
  showHome();
}
window.addEventListener('resize', () => { if (!$('login').hidden) drawLoginArt(); });
document.fonts?.ready?.then(() => { if (!$('game').hidden) board.layout(); });
