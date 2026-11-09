// 定規1本を描く（盤面と、定規ケースのプレビューで共用）
// 座標は cm。px は 1cm あたりの画面ピクセル数（目盛りや文字の出し分けに使う）
import Physics from './shared/physics.js';
import { PLAYERS } from './shared/rules.js';

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// b: { owner, specKey, x, y, a, pattern, sticker, alpha, scale }
export function paintRuler(ctx, b, px, active = false, now = 0) {
  const s = Physics.RULERS[b.specKey] || Physics.RULERS.plastic30;
  const pl = PLAYERS[b.owner] || PLAYERS[0];
  const scale = b.scale ?? 1;
  const hx = s.length / 2 * scale, hy = s.width / 2 * scale;
  const W = hy * 2, L = hx * 2;
  ctx.save();
  ctx.globalAlpha = b.alpha ?? 1;
  ctx.translate(b.x, b.y);
  ctx.rotate(b.a);
  // 影
  ctx.fillStyle = 'rgba(40, 22, 8, 0.28)';
  roundRect(ctx, -hx + 0.25, -hy + 0.45, hx * 2, hy * 2, 0.25);
  ctx.fill();
  // 本体
  roundRect(ctx, -hx, -hy, hx * 2, hy * 2, s.kind === 'steel' ? 0.12 : 0.3);
  if (s.kind === 'plastic') ctx.fillStyle = pl.tint;
  else if (s.kind === 'bamboo') ctx.fillStyle = '#e8cf8c';
  else {
    const g = ctx.createLinearGradient(0, -hy, 0, hy);
    g.addColorStop(0, '#e9ecef'); g.addColorStop(0.5, '#b7bec6'); g.addColorStop(1, '#d4d9de');
    ctx.fillStyle = g;
  }
  ctx.fill();

  // 柄（本体の形で切り抜いて重ねる）
  ctx.save();
  roundRect(ctx, -hx, -hy, hx * 2, hy * 2, 0.3);
  ctx.clip();
  if (s.kind === 'bamboo') {
    ctx.strokeStyle = 'rgba(150, 110, 40, 0.35)';
    ctx.lineWidth = 0.05;
    for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(-hx + 0.3, k * hy * 0.3); ctx.lineTo(hx - 0.3, k * hy * 0.3 + 0.05); ctx.stroke(); }
  }
  if (s.grid) {
    ctx.strokeStyle = 'rgba(20, 60, 120, 0.25)';
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    for (let x = -hx; x <= hx; x += 0.5 * scale) { ctx.moveTo(x, -hy); ctx.lineTo(x, hy); }
    for (let y = -hy; y <= hy; y += 0.5 * scale) { ctx.moveTo(-hx, y); ctx.lineTo(hx, y); }
    ctx.stroke();
  }
  if (b.pattern) paintPattern(ctx, b.pattern, hx, hy, scale);
  ctx.restore();

  ctx.lineWidth = Math.max(0.06, 1.3 / px);
  ctx.strokeStyle = s.kind === 'plastic' ? pl.edge : 'rgba(60, 50, 40, 0.75)';
  roundRect(ctx, -hx, -hy, hx * 2, hy * 2, s.kind === 'steel' ? 0.12 : 0.3);
  ctx.stroke();

  // 目盛り
  const x0 = -hx + (L - s.nominal * scale) / 2;
  const ppcm = px * scale;
  const showMm = ppcm >= 7, showHalf = ppcm >= 3.5;
  const ink = s.kind === 'plastic' ? 'rgba(20, 20, 30, 0.85)' : 'rgba(25, 20, 15, 0.9)';
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.03, 0.8 / px);
  ctx.beginPath();
  for (let i = 0; i <= s.nominal * 10; i++) {
    const cm = i % 10 === 0, half = i % 5 === 0;
    if (!cm && !(half && showHalf) && !showMm) continue;
    const x = x0 + i * 0.1 * scale;
    const len = Math.min(cm ? 1.1 : half ? 0.75 : 0.45, cm ? W * 0.32 : half ? W * 0.22 : W * 0.13) * (cm ? 1 : 1);
    ctx.moveTo(x, -hy); ctx.lineTo(x, -hy + len);
  }
  ctx.stroke();
  const every = ppcm >= 13 ? 1 : 5;
  const fs = Math.min(W * 0.25, 0.9 * scale) * px;
  if (fs >= 6) {
    ctx.save();
    ctx.scale(1 / px, 1 / px);
    ctx.font = `600 ${fs.toFixed(1)}px "Zen Kaku Gothic New", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = ink;
    const ty = -hy + Math.min(W * 0.34, 1.2 * scale);
    for (let c = 0; c <= s.nominal; c += every) ctx.fillText(String(c), (x0 + c * scale) * px, ty * px);
    ctx.restore();
  }

  // シール（飾り）
  if (b.sticker) {
    const size = Math.min(W * 0.62, 2.4 * scale);
    paintSticker(ctx, b.sticker, -hx + L * 0.22, hy - size * 0.62, size);
  }

  // 名前シール（席の色。飾りがあっても必ず見えるように最後に描く）
  const sw = Math.min(3.0, L * 0.12), sh = Math.min(W * 0.42, 1.4 * scale);
  const sx = hx - sw - Math.min(1.2, L * 0.05), sy = hy - sh - Math.min(W * 0.1, 0.35);
  roundRect(ctx, sx, sy, sw, sh, sh * 0.25);
  ctx.fillStyle = pl.sticker; ctx.fill();
  ctx.lineWidth = Math.max(0.04, 0.8 / px);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.stroke();
  if (sh * px >= 9) {
    ctx.save();
    ctx.translate(sx + sw / 2, sy + sh / 2);
    ctx.scale(1 / px, 1 / px);
    ctx.font = `700 ${(sh * px * 0.72).toFixed(1)}px "Zen Kaku Gothic New", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = pl.ink;
    ctx.fillText(pl.name, 0, 0.5);
    ctx.restore();
  }

  // 手番の定規はチョークの点線で囲む
  if (active) {
    ctx.globalAlpha = (b.alpha ?? 1) * (0.55 + 0.45 * Math.sin(now / 260));
    roundRect(ctx, -hx - 0.7, -hy - 0.7, hx * 2 + 1.4, hy * 2 + 1.4, 0.8);
    ctx.setLineDash([0.8, 0.6]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(0.12, 2 / px);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function paintPattern(ctx, id, hx, hy, k) {
  const L = hx * 2, W = hy * 2;
  switch (id) {
    case 'pattern:stripe': {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
      ctx.lineWidth = 0.35 * k;
      ctx.beginPath();
      for (let x = -hx - W; x < hx + W; x += 1.0 * k) { ctx.moveTo(x, hy); ctx.lineTo(x + W, -hy); }
      ctx.stroke();
      break;
    }
    case 'pattern:dots': {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      const step = 0.9 * k;
      let row = 0;
      for (let y = -hy + step / 2; y < hy; y += step, row++) {
        for (let x = -hx + (row % 2 ? step : step / 2); x < hx; x += step) {
          ctx.beginPath(); ctx.arc(x, y, 0.2 * k, 0, Math.PI * 2); ctx.fill();
        }
      }
      break;
    }
    case 'pattern:check': {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      const c = Math.max(0.6, W / 4);
      let i = 0;
      for (let x = -hx; x < hx; x += c, i++) {
        let j = 0;
        for (let y = -hy; y < hy; y += c, j++) if ((i + j) % 2 === 0) ctx.fillRect(x, y, c, c);
      }
      break;
    }
    case 'pattern:wave': {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 0.12 * k;
      for (let y = -hy + 0.5 * k; y < hy; y += 0.8 * k) {
        ctx.beginPath();
        for (let x = -hx; x <= hx; x += 0.2) {
          const yy = y + Math.sin(x * 2.2 / k) * 0.18 * k;
          if (x === -hx) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      break;
    }
    case 'pattern:stars': {
      ctx.fillStyle = 'rgba(20, 24, 70, 0.45)';
      ctx.fillRect(-hx, -hy, L, W);
      let seed = 11;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      ctx.fillStyle = 'rgba(255, 250, 220, 0.95)';
      const n = Math.round(L * W * 0.9);
      for (let i = 0; i < n; i++) {
        const x = -hx + rnd() * L, y = -hy + rnd() * W, r = (0.05 + rnd() * 0.1) * k;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'pattern:rainbow': {
      const g = ctx.createLinearGradient(-hx, 0, hx, 0);
      ['#ff6b6b', '#ffb84d', '#ffe14d', '#6be07a', '#5ab8ff', '#9b7bff'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
      ctx.globalAlpha *= 0.55;
      ctx.fillStyle = g;
      ctx.fillRect(-hx, -hy, L, W);
      break;
    }
  }
}

function star(ctx, cx, cy, r, points = 5, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const t = -Math.PI / 2 + i * Math.PI / points;
    ctx.lineTo(cx + rr * Math.cos(t), cy + rr * Math.sin(t));
  }
  ctx.closePath();
}

export function paintSticker(ctx, id, cx, cy, size) {
  const r = size / 2;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.07;
  ctx.strokeStyle = 'rgba(40, 25, 10, 0.75)';
  switch (id) {
    case 'sticker:star':
      star(ctx, cx, cy, r);
      ctx.fillStyle = '#ffd84a'; ctx.fill(); ctx.stroke();
      break;
    case 'sticker:heart':
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.85);
      ctx.bezierCurveTo(cx - r * 1.3, cy, cx - r * 0.6, cy - r * 1.1, cx, cy - r * 0.35);
      ctx.bezierCurveTo(cx + r * 0.6, cy - r * 1.1, cx + r * 1.3, cy, cx, cy + r * 0.85);
      ctx.fillStyle = '#ff7aa8'; ctx.fill(); ctx.stroke();
      break;
    case 'sticker:bolt':
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.2, cy - r);
      ctx.lineTo(cx - r * 0.55, cy + r * 0.1);
      ctx.lineTo(cx - r * 0.05, cy + r * 0.1);
      ctx.lineTo(cx - r * 0.3, cy + r);
      ctx.lineTo(cx + r * 0.6, cy - r * 0.2);
      ctx.lineTo(cx + r * 0.08, cy - r * 0.2);
      ctx.closePath();
      ctx.fillStyle = '#ffe14d'; ctx.fill(); ctx.stroke();
      break;
    case 'sticker:note':
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.25, cy + r * 0.55, r * 0.38, r * 0.28, -0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#2b2b3a'; ctx.fill();
      ctx.lineWidth = size * 0.1; ctx.strokeStyle = '#2b2b3a';
      ctx.beginPath(); ctx.moveTo(cx + r * 0.1, cy + r * 0.5); ctx.lineTo(cx + r * 0.1, cy - r * 0.9);
      ctx.quadraticCurveTo(cx + r * 0.7, cy - r * 0.6, cx + r * 0.65, cy - r * 0.1); ctx.stroke();
      break;
    case 'sticker:crown':
      ctx.beginPath();
      ctx.moveTo(cx - r, cy + r * 0.6);
      ctx.lineTo(cx - r, cy - r * 0.5);
      ctx.lineTo(cx - r * 0.5, cy);
      ctx.lineTo(cx, cy - r * 0.8);
      ctx.lineTo(cx + r * 0.5, cy);
      ctx.lineTo(cx + r, cy - r * 0.5);
      ctx.lineTo(cx + r, cy + r * 0.6);
      ctx.closePath();
      ctx.fillStyle = '#f2c230'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e8483c';
      ctx.beginPath(); ctx.arc(cx, cy + r * 0.2, r * 0.17, 0, Math.PI * 2); ctx.fill();
      break;
    case 'sticker:hanamaru': {
      // 先生の赤ペンの「はなまる」：うずまきと花びら
      ctx.strokeStyle = '#e23b30';
      ctx.lineWidth = size * 0.08;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let t = 0; t < Math.PI * 4.2; t += 0.15) {
        const rr = r * 0.12 + r * 0.42 * (t / (Math.PI * 4.2));
        const x = cx + rr * Math.cos(t), y = cy + rr * Math.sin(t);
        if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const t = i * Math.PI / 3;
        ctx.beginPath();
        ctx.arc(cx + r * 0.75 * Math.cos(t), cy + r * 0.75 * Math.sin(t), r * 0.24, t - Math.PI * 0.75, t + Math.PI * 0.75);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

// 定規ケース用のプレビュー（横向きに1本）
export function previewRuler(canvas, look, owner = 0) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cssW = canvas.clientWidth || 300, cssH = canvas.clientHeight || 60;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const s = Physics.RULERS[look.specKey] || Physics.RULERS.plastic30;
  const px = Math.min((cssW - 12) / s.length, (cssH - 10) / s.width, 22);
  ctx.setTransform(px * dpr, 0, 0, px * dpr, cssW / 2 * dpr, cssH / 2 * dpr);
  ctx.clearRect(-1e3, -1e3, 2e3, 2e3);
  paintRuler(ctx, { owner, specKey: look.specKey, x: 0, y: 0, a: 0, pattern: look.pattern, sticker: look.sticker }, px);
}
