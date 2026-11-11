// 画面の切り替え・サーバーとの通信・はじく操作・動きの再生
// 流れ：ログイン → ホーム（部屋を作る／入る／定規の編集） → 部屋（全員が準備OKか1分で開始） → 対戦 → 部屋に戻る
import Physics from './shared/physics.js';
import { DESKS, MODES, PLAYERS, TEAMS, teamOf, deskTiles, SKILLS, skillFor, GAUGE } from './shared/rules.js';
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
// 盤面の下に残す高さ（ボタンの列と、画面の下の余白）
const board = createBoard($('board'), $('boardWrap'), {
  below: () => $('controls').offsetHeight + 8 + (parseFloat(getComputedStyle(document.body).paddingBottom) || 0),
});
let account; // 下で作る（画面の関数を渡すため）

// ---------------- 共通 ----------------
let toastTimer = 0;
// ---------------- 必殺技 ----------------
const skillOf = (body) => (!body ? null : SKILLS[body.skill] ? body.skill : skillFor(body.specKey, app.game?.skills));
// 円ゲージを描く（SVG）。gv: 0〜100
function ring(gv, sk, { size = 24, label = '', full = false, anchor = false, svgOnly = false } = {}) {
  const r = 25, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(1, gv / GAUGE.max));
  const svg = `<svg viewBox="0 0 60 60" width="${size}" height="${size}" aria-hidden="true">
    <circle class="ring-bg" cx="30" cy="30" r="${r}"></circle>
    <circle class="ring-fg" cx="30" cy="30" r="${r}" stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 30 30)"></circle>
    ${size >= 30 ? `<text x="30" y="${label ? 28 : 34}" text-anchor="middle" class="ring-num">${full ? 'MAX' : Math.round(pct * 100)}</text>` : ''}
    ${label && size >= 30 ? `<text x="30" y="43" text-anchor="middle" class="ring-name">${label}</text>` : ''}
  </svg>`;
  if (svgOnly) return svg;
  return `<span class="ring${full ? ' full' : ''}${anchor ? ' anchor' : ''}" style="--sk:${sk.color}" role="img" aria-label="必殺技「${sk.name}」${full ? '使える' : Math.round(pct * 100) + '%'}">${svg}</span>`;
}
$('skillBtn').addEventListener('click', () => {
  if ($('skillBtn').disabled) return;
  const sk = skillOf(app.state?.game?.bodies[app.state.game.turn]);
  if (!sk) return;
  // その場で効く技は、1回目で説明、2回目（3秒以内）で発動。構える技は、押すたびに構える／やめる
  if (SKILLS[sk].mode === 'now') {
    if (app.skillArmed) { app.skillArmed = false; send({ t: 'skill' }); }
    else {
      app.skillArmed = true;
      hint(`必殺技「${SKILLS[sk].name}」：${SKILLS[sk].desc}。もう一度押すと使います`);
      clearTimeout(app.skillTimer);
      app.skillTimer = setTimeout(() => { app.skillArmed = false; renderGame(); }, 3000);
    }
  } else {
    app.skillArmed = !app.skillArmed;
    if (app.skillArmed) hint(`必殺技「${SKILLS[sk].name}」：${SKILLS[sk].desc}`);
  }
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
  // 対戦中は見出しや足もとを畳んで、盤面とゲージを1画面に収める
  document.body.classList.toggle('in-game', screen === 'game');
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
    cfg: app.game,
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
  // 場のイベントが始まったら、盤面に大きく知らせる
  const ev = st.game?.event;
  const evKey = ev ? `${st.game.id}:${ev.id}` : null;
  if (ev && st.phase === 'aim' && evKey !== app.seenEvent && app.seenGame === st.game.id) {
    const d = DESKS[MODES[st.mode].desk];
    app.fx.push({ x: 0, y: -d.h / 4, t0: performance.now(), text: ev.type === 'ice' ? '机が凍った！' : '椅子が並んだ！', color: ev.type === 'ice' ? '#8fd8ff' : '#f2c14e', big: true });
  }
  // 必殺技などの出来事（回復・ワープ・インクのダメージ…）
  if (st.game?.fx && app.seenGame === st.game.id) {
    for (const f of st.game.fx) {
      if (f.id <= (app.seenFx || 0)) continue;
      // その場で使う必殺技は、カットインを出してから効果の文字
      const instant = ['heal', 'sub', 'counter', 'warp', 'chair', 'blizzard'].includes(f.kind);
      if (instant) showCutin(f.owner, f.kind);
      const t0 = performance.now() + (instant ? CUTIN_MS - 200 : 0);
      const text = { heal: `保健室！ +${f.amount}`, sub: '身代わり！', subUsed: '身代わり発動！', counter: '反撃の構え！', warp: 'ワープ！', chair: 'いす召喚！', blizzard: '吹雪！', ink: `インク -${f.amount}` }[f.kind];
      const col = f.kind === 'subUsed' ? SKILLS.sub.color : f.kind === 'ink' ? SKILLS.ink.color : SKILLS[f.kind]?.color || '#fff';
      if (f.kind === 'warp' && f.from) app.fx.push({ x: f.from.x, y: f.from.y, t0, ring: 8, color: col, inward: true });
      if (text) app.fx.push({ x: f.x, y: f.y - 4, t0, text, color: col, big: f.kind !== 'ink', small: f.kind === 'ink' });
    }
  }
  if (st.game) {
    const last = st.game.fx?.at(-1)?.id || 0;
    app.seenFx = app.seenGame === st.game.id ? Math.max(app.seenFx || 0, last) : last;
    app.seenEvent = evKey ?? app.seenEvent; app.seenGame = st.game.id;
  }
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
    if (wasHidden) window.scrollTo(0, 0);
    renderGame();
    board.setDesk(MODES[st.mode].desk);
    if (wasHidden) board.layout();
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
  // ログインしている人（練習ではいつも）は、持っている定規から選べる
  const acct = !!((me.account || app.practice) && app.me);
  const ids = acct ? app.me.owned.filter((id) => ITEMS[id]?.kind === 'ruler') : BASIC_RULERS;
  const ids2 = Object.keys(ITEMS).filter((id) => ids.includes(id)); // 定規ケースと同じ並び
  const opts = ids2.map((id) => `<option value="${id}">${esc(ITEMS[id].name)} Lv.${acct ? levelOfRuler(app.me, id).level : 1}${ITEMS[id].rarity !== 'basic' ? ` [${ITEMS[id].rarity}]` : ''}</option>`).join('');
  if ($('myRuler').dataset.opts !== opts) { $('myRuler').innerHTML = opts; $('myRuler').dataset.opts = opts; }
  $('myRuler').value = lo.ruler;
  previewRuler($('lobbyPreview'), lo, Math.max(0, app.state.members.findIndex((m) => m.id === me.id)));
  const r = ITEMS[lo.ruler];
  $('rulerNote').innerHTML = `${matChip(r?.mat)} ${esc(r ? affinityText(r.mat) : '')}<br>${esc(skillText(lo.ruler, app.game))}${lo.acc ? `<br>アクセサリ：${esc(ITEMS[lo.acc].name)}（${esc(accText(lo.acc))}）` : ''}`;
  $('openCase').hidden = !acct;
}

function renderGame() {
  const st = app.state, g = st.game;
  if (!g) return;
  const teams = MODES[st.mode].teams;
  const over = showingResult();
  // ---- 画面上：自分以外（番の人は大きく）／画面下：自分（体力を大きく、左下に必殺技の円ゲージ） ----
  const meIdx = app.you ? g.order.indexOf(app.you.id) : -1;
  const info = (i) => {
    const mid = g.order[i], m = memberById(mid), p = g.players[i], body = g.bodies[i];
    const won = over && g.result?.winners.includes(i);
    const status = won ? '勝ち' : !p.alive ? (p.selfOut ? '自滅' : '脱落') : st.phase === 'aim' && m && !m.connected ? '接続待ち' : '';
    const mat = Physics.RULERS[body?.specKey]?.mat;
    const hp = Math.max(0, Math.round(body?.hp ?? 100));
    const sk = skillOf(body), gv = Math.min(GAUGE.max, g.gauge?.[i] ?? 0);
    return {
      i, m, p, body, won, status, hp, sk, gv, full: gv >= GAUGE.max,
      hpCls: hp > 60 ? 'ok' : hp > 30 ? 'mid' : 'low',
      turn: st.phase === 'aim' && g.turn === i, // 再生中も、はじいた人を大きいままにする（行の高さを変えない）
      sub: [mat ? `${MATERIAL_INFO[mat].name} Lv.${body.level || 1}` : '', teams ? TEAMS[teamOf(i)].name : '', `${st.wins[mid] || 0}勝`].filter(Boolean).join('・'),
      // 続いている必殺技の効果
      fxs: [body?.anchor && '不動', body?.counter && '反撃の構え', body?.sub && '身代わり', body?.ink > 0 && `インク あと${body.ink}`].filter(Boolean),
    };
  };
  const hpBar = (x) => `<span class="hpbar ${x.hpCls}" role="img" aria-label="体力 ${x.hp}"><i style="width:${x.hp}%"></i><b>${x.hp}</b></span>`;
  const others = g.order.map((_, i) => i).filter((i) => i !== meIdx);
  const box = $('players');
  box.dataset.n = others.length;
  box.style.setProperty('--n', Math.max(1, others.length));
  box.innerHTML = others.map((i) => {
    const x = info(i);
    const sk = x.sk && SKILLS[x.sk];
    return `<div class="orow${x.turn ? ' is-turn' : ''}${x.p.alive || x.won ? '' : ' is-out'}" style="--seat:var(--seat-${i})">
      <span class="seat">${PLAYERS[i].name}</span>
      <span class="who">${esc(x.m?.name || '（退出）')}${x.fxs.map((t) => `<em class="fx-chip">${esc(t)}</em>`).join('')}<small>${esc(x.sub)}${x.status ? '・' + x.status : ''}</small></span>
      ${hpBar(x)}
      ${sk ? ring(x.gv, sk, { size: x.turn ? 34 : 20, label: x.turn ? sk.name : '', full: x.full, anchor: x.body?.anchor }) : ''}
    </div>`;
  }).join('');
  // 自分
  const mePanel = $('mePanel');
  if (meIdx >= 0) {
    const x = info(meIdx);
    const sk = x.sk && SKILLS[x.sk];
    mePanel.hidden = false;
    mePanel.className = `me-panel${x.turn ? ' is-turn' : ''}${x.p.alive || x.won ? '' : ' is-out'}`;
    mePanel.style.setProperty('--seat', `var(--seat-${meIdx})`);
    mePanel.innerHTML = `<div class="me-line"><span class="seat">${PLAYERS[meIdx].name}</span><span class="who">${esc(x.m?.name || 'あなた')}</span>
        ${x.fxs.map((t) => `<em class="fx-chip">${esc(t)}</em>`).join('')}<small>${esc(x.sub)}${x.status ? '・' + x.status : ''}</small></div>
      <div class="me-hp">${hpBar(x)}</div>`;
    $('skillBtn').hidden = !sk;
    if (sk) {
      $('skillBtn').style.setProperty('--sk', sk.color);
      $('skillRing').innerHTML = ring(x.gv, sk, { size: 64, label: sk.name, full: x.full, svgOnly: true });
    }
  } else {
    mePanel.hidden = true;
    $('skillBtn').hidden = true;
  }

  const msg = $('msg');
  const cur = g.turn, curMember = memberById(g.order[cur]);
  const mine = myTurn();
  let tags = '', canSkill = false;
  if (app.playing || app.waitingShot) msg.textContent = '……';
  else if (st.phase === 'aim') {
    const first = (g.shots < g.n ? '<span class="first">1周目・落ちても戻る</span>' : '')
      + (g.vanish !== null && g.vanish !== undefined
        ? `<span class="vanish">${vanishText(g)}</span>` : '');
    const tTag = teams ? `（${TEAMS[teamOf(cur)].name}）` : '';
    const sk = skillOf(g.bodies[cur]);
    canSkill = !!(mine && sk && !g.extra && (g.gauge?.[cur] ?? 0) >= GAUGE.max);
    if (!canSkill) app.skillArmed = false;
    const extra = g.extra ? `<span class="first">連打：もう1回はじける</span>` : '';
    if (mine) msg.innerHTML = `<b class="mine">あなたの番</b>${tTag}<span class="sub">自分の定規を押さえて、引っぱって離す</span>`;
    else msg.innerHTML = `<span class="who-turn"><b style="color:var(--seat-${cur})">${esc(curMember?.name || '?')}</b>${tTag}の番です${curMember && !curMember.connected ? '（接続が切れています）' : ''}</span>`;
    const ev = g.event;
    const evTag = ev?.type === 'ice' ? `<span class="ev ice">こおり：この番は机がよくすべる</span>`
      : ev?.type === 'chair' ? `<span class="ev chair">いす：${ev.left <= 1 ? 'この番まで' : `あと${ev.left}回`}、椅子の辺からは落ちない</span>` : '';
    const skTags = (g.icy > 0 ? `<span class="ev ice">吹雪：この番は机がよくすべる</span>` : g.icyNext ? `<span class="ev ice">吹雪：次の番は机が凍る</span>` : '')
      + (g.walls?.length ? `<span class="ev chair">いす召喚：${g.walls[0].left <= 1 ? 'この番まで' : `あと${g.walls[0].left}回`}、椅子の辺から落ちない</span>` : '');
    tags = evTag + skTags + extra + first;
  } else msg.textContent = '対戦終了';
  $('tags').innerHTML = tags;
  // 左下の円ゲージ：満タンで自分の番なら押せる（押すと必殺技を構える）
  const sb = $('skillBtn');
  sb.disabled = !canSkill;
  sb.setAttribute('aria-pressed', String(!!app.skillArmed));
  sb.classList.toggle('ready', canSkill);
  const skName = SKILLS[skillOf(g.bodies[meIdx])]?.name || '';
  const skNow = SKILLS[skillOf(g.bodies[meIdx])]?.mode === 'now';
  $('skillCap').textContent = canSkill ? (app.skillArmed ? (skNow ? 'もう一度で発動' : '構え中') : 'タップ') : '';
  sb.setAttribute('aria-label', canSkill ? `必殺技「${skName}」${app.skillArmed ? 'を構えています。もう一度押すとやめる' : 'を使う'}` : `必殺技「${skName}」のゲージ`);
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
// ---------------- 必殺技のカットイン（全員の画面に出す） ----------------
const CUTIN_MS = 1150;
function showCutin(owner, skill) {
  const g = app.state?.game;
  const sk = SKILLS[skill];
  if (!g || !sk) return;
  const m = memberById(g.order[owner]);
  const body = g.bodies[owner];
  const el = $('cutin');
  el.style.setProperty('--seat', PLAYERS[owner].color);
  el.style.setProperty('--sk', sk.color);
  $('cutinWho').textContent = `${PLAYERS[owner].name}　${m?.name || ''} の必殺技`;
  $('cutinName').textContent = sk.name;
  $('cutinDesc').textContent = sk.desc;
  el.hidden = false;
  el.classList.remove('play');
  void el.offsetWidth; // アニメーションを最初から
  el.classList.add('play');
  if (body) previewRuler($('cutinRuler'), { specKey: body.specKey, level: body.level, pattern: body.pattern, sticker: body.sticker }, owner);
  clearTimeout(app.cutinTimer);
  app.cutinTimer = setTimeout(() => { el.hidden = true; el.classList.remove('play'); }, CUTIN_MS);
}

// 机が消える予告の文。予告のあと、残った全員が1回ずつ番を終えたら消える
function vanishText(g) {
  const wait = g.vanishWait || [];
  if (wait.length <= 1 && (wait.length === 0 || wait[0] === g.turn)) return 'この番が終わると、赤い斜線の机が消える';
  return `${wait.map((i) => PLAYERS[i].name).join('・')}の番が終わると、赤い斜線の机が消える`;
}

function startPlayback(m) {
  app.aim = null;
  app.pendingState = null;
  // 必殺技を使った1打は、カットインのあとで動き出す
  const delay = m.skill ? CUTIN_MS - 150 : 0;
  if (m.skill) showCutin(m.by, m.skill);
  app.playing = {
    frames: m.frames, falls: m.falls, by: m.by, saved: m.saved, next: m.state, crit: m.crit, critDone: false,
    skill: m.skill || null, skillDone: false, blast: m.blast || null, blastDone: false, hits: m.hits || [], hitDone: 0,
    hpNow: (app.state?.game?.bodies || m.state.game.bodies).map((b) => b.hp ?? 100),
    vanished: m.vanished, vanishFx: false, desks: app.state?.game?.desks || null,
    looks: m.state.game.bodies.map((b, k) => ({ specKey: b.specKey, level: b.level, pattern: b.pattern, sticker: b.sticker, anchor: b.anchor, counter: b.counter, sub: b.sub, ink: b.ink, hp: app.state?.game?.bodies[k]?.hp ?? b.hp })),
    start: performance.now() + delay, fallStart: {}, fxDone: 0,
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
    bodies.push({ owner: k, ...p.looks[k], hp: p.hpNow?.[k] ?? p.looks[k].hp, x: lerp(0) / 100, y: lerp(1) / 100, a: lerp(2) / 1000, alpha, scale });
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
  // 剛腕は、はじいた瞬間に盤面を揺らす（技の名前はカットインで出している）
  if (p.skill && !p.skillDone && t >= 0) {
    p.skillDone = true;
    if (!reducedMotion() && p.skill === 'power') app.shakeUntil = now + 200;
  }
  if (p.blast && !p.blastDone && t >= p.blast.f) {
    p.blastDone = true;
    const k = p.blast.kind, col = SKILLS[k].color;
    app.fx.push({ x: p.blast.x, y: p.blast.y, t0: now, ring: p.blast.r, color: col, inward: k === 'magnet' });
    if (k === 'bomb') app.fx.push({ x: p.blast.x, y: p.blast.y, t0: now, burst: true });
    app.fx.push({ x: p.blast.x, y: p.blast.y - 4, t0: now, text: `${SKILLS[k].name}！`, color: col, big: true });
    if (!reducedMotion() && k !== 'magnet') app.shakeUntil = now + 300;
  }
  // ダメージの数字
  if (p.hits) {
    // 同じ瞬間に重なったら、少しずつずらして出す
    let n = 0;
    while (p.hitDone < p.hits.length && t >= p.hits[p.hitDone].f) {
      const h = p.hits[p.hitDone++];
      if (p.hpNow[h.target] !== undefined) p.hpNow[h.target] = Math.max(0, p.hpNow[h.target] - h.dmg);
      if (h.dmg < 2) continue;
      const tb = bodies.find((b) => b.owner === h.target);
      const bx = tb ? tb.x : h.x, by = tb ? tb.y : h.y;
      app.fx.push({ x: bx + n * 3, y: by - 4 - n * 4, t0: now + n * 120, text: h.kind === 'counter' ? `反撃 -${Math.round(h.dmg)}` : `-${Math.round(h.dmg)}`, color: h.kind === 'crit' ? '#ffd84a' : h.kind === 'counter' ? '#fd9644' : '#ff7a6b', small: true });
      n++;
    }
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
      aim = { cx: cp.x, cy: cp.y, px: app.aim.px, py: app.aim.py, skill: sk && SKILLS[sk], owner: app.aim.b.owner };
    }
    app.fx = app.fx.filter((f) => now - f.t0 < 1600);
    const active = !app.playing && app.state.phase === 'aim' ? g.turn : -1;
    // 残っている机と、消える予告の机（再生中は、はじく前の状態のまま見せる）
    const desks = app.playing?.deskView || { left: g.desks || null, warn: app.state.phase === 'aim' ? g.vanish ?? null : null, warnIn: g.vanishIn ?? 1 };
    desks.event = app.state.phase === 'aim' ? g.event : null;
    desks.icy = app.state.phase === 'aim' && g.icy > 0;
    desks.walls = app.state.phase === 'aim' ? (g.walls || []).map((w) => w.wall) : [];
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
// 盤面に筆で書く字（クリティカル・必殺技の名前など）は、先に読み込んでおく（その字の分だけ）
try {
  const brush = ['クリティカル！机が消えた落ちた自滅セーフ', ...Object.values(SKILLS).map((s) => s.name), ...PLAYERS.map((p) => p.name)].join('');
  document.fonts?.load?.('30px "Yuji Mai"', brush).catch(() => {});
} catch { /* 読み込めなくても、ほかの字で書く */ }
// 名前の札などの高さが変わったら、盤面の大きさを合わせ直す
if (window.ResizeObserver) new ResizeObserver(() => { if (!$('game').hidden) board.layout(); }).observe($('players'));
