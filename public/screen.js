// 画面の固定（拡大・引っぱって更新を止める）と、ホーム画面に追加して全画面で遊ぶための準備
const TIP_KEY = 'jogi:installTip';

// ホーム画面に追加したアイコンから開いているか（アドレスバーのない全画面）
export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches
    || navigator.standalone === true;
}
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = () => window.matchMedia?.('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;

function store(k, v) {
  try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; }
  return null;
}

// opt.canShowTip(): いま案内を出してよいか（ホームにいて、ほかの窓が開いていないとき）
export function setupScreen({ canShowTip = () => true } = {}) {
  const root = document.documentElement;
  root.classList.toggle('standalone', !!isStandalone());

  // いま見えている高さ（アドレスバーの出入りやキーボードで変わる）を CSS に渡す
  const setH = () => root.style.setProperty('--app-h', `${Math.round(window.visualViewport?.height || window.innerHeight)}px`);
  setH();
  window.addEventListener('resize', setH);
  window.visualViewport?.addEventListener('resize', setH);

  // ページ全体の拡大を止める（iPhone の Safari は viewport の指定を無視するので、ジェスチャーを止める）
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  // 2本指の操作は、盤面（手元カメラ）の上でだけ使う
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 && !e.target.closest?.('#board')) e.preventDefault();
  }, { passive: false });
  // ダブルタップでの拡大（古い端末向け。新しい端末は CSS の touch-action で止まる）
  let lastTap = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 320 && e.changedTouches.length === 1 && !e.target.closest?.('input, select, textarea, #board')) e.preventDefault();
    lastTap = now;
  }, { passive: false });

  // 縦向きに固定（ホーム画面のアプリとして開いたときだけ効く端末がある）
  if (isStandalone()) screen.orientation?.lock?.('portrait').catch(() => {});

  // サービスワーカー（ホーム画面に追加できるようにするため。ページは保存しない）
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // ---- 「ホーム画面に追加すると全画面で遊べます」の案内（ブラウザで遊んでいる人に1回だけ） ----
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
  window.addEventListener('appinstalled', () => { hideTip(); store(TIP_KEY, 'installed'); });
  const tip = document.getElementById('installTip');
  function hideTip() { if (tip) tip.hidden = true; }
  document.getElementById('installClose')?.addEventListener('click', hideTip);
  document.getElementById('installBtn')?.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch { /* 閉じられても何もしない */ }
    deferred = null;
    hideTip();
  });
  function showTip() {
    if (!tip) return;
    const steps = document.getElementById('installSteps');
    const btn = document.getElementById('installBtn');
    if (deferred) {
      steps.textContent = 'アドレスバーのない画面で、すぐに遊び始められます。';
      btn.hidden = false;
    } else if (isIOS()) {
      steps.innerHTML = '画面の<b>共有ボタン</b>（四角から上向きの矢印 <span class="ios-share" aria-hidden="true"></span>）を押し、<b>「ホーム画面に追加」</b>→<b>「追加」</b>の順に押してください。';
      btn.hidden = true;
    } else {
      steps.innerHTML = 'ブラウザのメニュー（︙）から<b>「ホーム画面に追加」</b>（または「アプリをインストール」）を選んでください。';
      btn.hidden = true;
    }
    tip.hidden = false;
    store(TIP_KEY, 'shown');
  }
  if (!isStandalone() && isMobile() && !store(TIP_KEY)) {
    // ホームを少し見てから、1回だけ出す
    let ok = 0;
    const timer = setInterval(() => {
      if (store(TIP_KEY)) { clearInterval(timer); return; }
      ok = canShowTip() ? ok + 1 : 0;
      if (ok >= 2) { clearInterval(timer); showTip(); }
    }, 1000);
  }
  return { showTip, hideTip };
}
