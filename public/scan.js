// カメラで QRコードを読む（部屋に入るため）。
// 読み取りは、ブラウザに BarcodeDetector（Android の Chrome など）があればそれを使い、
// なければ jsQR（Apache License 2.0）をそのときだけ読み込んで使う（iPhone の Safari など）。
const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const CODE_RE = /^[A-Z0-9]{5}$/;

// 読み取った文字から部屋コードを取り出す。{ code } か { error }
// ・このサイトの招待リンク（…/?room=ABCDE）
// ・5文字の部屋コードそのもの
export function roomFromScan(text, origin = location.origin) {
  const t = String(text || '').trim();
  if (CODE_RE.test(t.toUpperCase()) && !t.includes('/')) return { code: t.toUpperCase() };
  let url;
  try { url = new URL(t); } catch { return { error: '定規バトルの招待QRではありません' }; }
  if (url.origin !== origin) return { error: '定規バトルの招待QRではありません（ほかのサイトのQRです）' };
  const code = (url.searchParams.get('room') || '').toUpperCase();
  if (!CODE_RE.test(code)) return { error: 'QRに部屋コードが入っていません' };
  return { code };
}

let jsqrLoading = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  jsqrLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSQR_URL;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error('jsQR')));
    s.onerror = () => { jsqrLoading = null; reject(new Error('jsQR')); };
    document.head.appendChild(s);
  });
  return jsqrLoading;
}

// 映像の1コマから QR の中身を読む関数を用意する
async function makeDecoder() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats?.();
      if (!formats || formats.includes('qr_code')) {
        const det = new window.BarcodeDetector({ formats: ['qr_code'] });
        return async (video) => (await det.detect(video))[0]?.rawValue || null;
      }
    } catch { /* 使えなければ jsQR へ */ }
  }
  const jsQR = await loadJsQR();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    const k = Math.min(1, 720 / Math.max(w, h)); // 大きすぎる映像は縮めて読む（速さのため）
    canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' })?.data || null;
  };
}

// video に背面カメラを映し、QR が読めたら onCode(text) を呼ぶ。
// うまくいかないときは Error（kind：denied＝許可されなかった／nocamera／unsupported／decoder＝読み取りの準備ができない）
export function createScanner(video) {
  let stream = null, timer = 0, running = false;

  async function start(onCode) {
    stop();
    running = true;
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { kind: 'unsupported' });
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      running = false;
      const kind = e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied'
        : e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError' ? 'nocamera' : 'unsupported';
      throw Object.assign(new Error(kind), { kind });
    }
    if (!running) { stop(); return; }
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    try { await video.play(); } catch { /* 自動再生できなくても、コマは読める */ }
    let decode;
    try { decode = await makeDecoder(); } catch {
      stop();
      throw Object.assign(new Error('decoder'), { kind: 'decoder' });
    }
    const tick = async () => {
      if (!running) return;
      let text = null;
      try { text = await decode(video); } catch { text = null; }
      if (!running) return;
      if (text && onCode(text) !== false) { stop(); return; }
      timer = setTimeout(tick, 140);
    };
    tick();
  }

  function stop() {
    running = false;
    clearTimeout(timer);
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
    try { video.pause(); } catch { /* 止まっていればよい */ }
    video.srcObject = null;
  }

  return { start, stop, get running() { return running; } };
}
