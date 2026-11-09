// 盤面（机・定規・狙いの矢印・落下の文字）を canvas に描く
import Physics from './shared/physics.js';
import { DESKS, PLAYERS } from './shared/rules.js';

const MARGIN = 9; // 机のまわりに見せる床（cm）
export const MAX_DRAG = 11; // これ以上引っぱっても力は最大のまま（cm）

export function createBoard(canvas, wrap) {
  const ctx = canvas.getContext('2d');
  const view = { s: 10, rot: false, cx: 0, cy: 0, w: 0, h: 0, dpr: 1 };
  let desk = DESKS.pair;
  let panels = [];

  function setDesk(key) {
    const d = DESKS[key] || DESKS.pair;
    if (d === desk && panels.length) return;
    desk = d;
    layout();
  }

  // 縦長の画面では机を90°回して表示する
  function layout() {
    const cssW = wrap.clientWidth || 360;
    const rot = window.innerHeight > window.innerWidth * 1.05;
    const vw = (rot ? desk.h : desk.w) + MARGIN * 2;
    const vh = (rot ? desk.w : desk.h) + MARGIN * 2;
    const maxH = Math.max(260, window.innerHeight - 220);
    const s = Math.min(cssW / vw, maxH / vh);
    const cssH = Math.round(vh * s);
    canvas.style.height = cssH + 'px';
    view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(cssW * view.dpr);
    canvas.height = Math.round(cssH * view.dpr);
    Object.assign(view, { s, rot, cx: cssW / 2, cy: cssH / 2, w: cssW, h: cssH });
    buildGrain();
  }

  // 机1台ごとに、長い辺に沿った木目を持たせる（毎回同じ模様）
  function buildGrain() {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    panels = [];
    const pw = desk.w / desk.cols, ph = desk.h / desk.rows;
    for (let r = 0; r < desk.rows; r++) for (let c = 0; c < desk.cols; c++) {
      const along = pw >= ph ? 'x' : 'y';
      const span = along === 'x' ? ph : pw;
      const lines = [];
      for (let i = 0; i < 42; i++) {
        lines.push({ o: rnd() * span, amp: 0.2 + rnd() * 0.7, freq: 0.04 + rnd() * 0.09, ph: rnd() * 6.28, a: 0.05 + rnd() * 0.09, wd: 0.05 + rnd() * 0.14 });
      }
      panels.push({ x: -desk.w / 2 + c * pw, y: -desk.h / 2 + r * ph, w: pw, h: ph, along, lines });
    }
  }

  function setWorldTransform() {
    const { s, rot, cx, cy, dpr } = view;
    if (rot) ctx.setTransform(0, s * dpr, -s * dpr, 0, cx * dpr, cy * dpr);
    else ctx.setTransform(s * dpr, 0, 0, s * dpr, cx * dpr, cy * dpr);
  }
  function toScreen(x, y) {
    return view.rot ? { x: view.cx - view.s * y, y: view.cy + view.s * x } : { x: view.cx + view.s * x, y: view.cy + view.s * y };
  }
  function toWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const sx = clientX - r.left, sy = clientY - r.top;
    return view.rot ? { x: (sy - view.cy) / view.s, y: (view.cx - sx) / view.s } : { x: (sx - view.cx) / view.s, y: (sy - view.cy) / view.s };
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // bodies: [{ owner, specKey, x, y, a, alpha, scale }]
  function draw({ bodies, active, aim, fx, now }) {
    const { dpr } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#2f2823';
    ctx.fillRect(0, 0, view.w, view.h);
    setWorldTransform();
    const px = view.s;

    // 床板
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1.2 / px;
    for (let x = -120; x <= 120; x += 9.5) { ctx.beginPath(); ctx.moveTo(x, -120); ctx.lineTo(x, 120); ctx.stroke(); }

    // 天板（くっつけた机は1台ずつ描き、継ぎ目を見せる）
    const dw = desk.w, dh = desk.h;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 18 * dpr;
    ctx.shadowOffsetY = 6 * dpr;
    roundRect(-dw / 2, -dh / 2, dw, dh, 1.4);
    ctx.fillStyle = '#d9bb8f';
    ctx.fill();
    ctx.restore();
    for (const pn of panels) {
      ctx.save();
      roundRect(pn.x, pn.y, pn.w, pn.h, 1.4);
      ctx.clip();
      for (const g of pn.lines) {
        ctx.strokeStyle = `rgba(122, 78, 38, ${g.a})`;
        ctx.lineWidth = g.wd;
        ctx.beginPath();
        const len = pn.along === 'x' ? pn.w : pn.h;
        for (let t = 0; t <= len + 1.5; t += 1.5) {
          const off = g.o + Math.sin(t * g.freq + g.ph) * g.amp;
          const x = pn.along === 'x' ? pn.x + t : pn.x + off;
          const y = pn.along === 'x' ? pn.y + off : pn.y + t;
          if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
      roundRect(pn.x + 0.35, pn.y + 0.35, pn.w - 0.7, pn.h - 0.7, 1.1);
      ctx.strokeStyle = 'rgba(110, 72, 40, 0.55)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    // 寸法線
    const dimY = dh / 2 + 3.2;
    ctx.strokeStyle = 'rgba(241, 239, 230, 0.55)';
    ctx.lineWidth = 1.2 / px;
    ctx.beginPath();
    ctx.moveTo(-dw / 2, dimY); ctx.lineTo(dw / 2, dimY);
    ctx.moveTo(-dw / 2, dimY - 0.9); ctx.lineTo(-dw / 2, dimY + 0.9);
    ctx.moveTo(dw / 2, dimY - 0.9); ctx.lineTo(dw / 2, dimY + 0.9);
    ctx.stroke();

    for (const b of bodies) {
      if (b.alpha <= 0) continue;
      drawRuler(b, px, b.owner === active && !aim, now);
    }
    if (aim) drawAim(aim, px);

    // 画面座標で描く文字
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lp = toScreen(0, dimY);
    const label = `机${desk.name}　${desk.w} × ${desk.h} cm`;
    ctx.font = '500 12px "Zen Kaku Gothic New", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width + 10;
    ctx.save();
    ctx.translate(lp.x, lp.y);
    if (view.rot) ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#2f2823'; ctx.fillRect(-tw / 2, -8, tw, 16);
    ctx.fillStyle = 'rgba(241, 239, 230, 0.8)'; ctx.fillText(label, 0, 0);
    ctx.restore();

    for (const f of fx) {
      const t = (now - f.t0) / 1600;
      if (t < 0 || t > 1) continue;
      const p = toScreen(f.x, f.y);
      const x = Math.max(60, Math.min(view.w - 60, p.x));
      const y = Math.max(24, Math.min(view.h - 24, p.y)) - t * 18;
      ctx.globalAlpha = 1 - t * t;
      ctx.font = '28px "Yusei Magic", "Zen Kaku Gothic New", sans-serif';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(30, 24, 20, 0.85)';
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.color; ctx.fillText(f.text, x, y);
      ctx.globalAlpha = 1;
    }
  }

  function drawRuler(b, px, active, now) {
    const s = Physics.RULERS[b.specKey], pl = PLAYERS[b.owner];
    const scale = b.scale ?? 1;
    const hx = s.length / 2 * scale, hy = s.width / 2 * scale;
    ctx.save();
    ctx.globalAlpha = b.alpha ?? 1;
    ctx.translate(b.x, b.y);
    ctx.rotate(b.a);
    ctx.fillStyle = 'rgba(40, 22, 8, 0.28)';
    roundRect(-hx + 0.25, -hy + 0.45, hx * 2, hy * 2, 0.25);
    ctx.fill();
    roundRect(-hx, -hy, hx * 2, hy * 2, s.kind === 'steel' ? 0.12 : 0.3);
    if (s.kind === 'plastic') ctx.fillStyle = pl.tint;
    else if (s.kind === 'bamboo') ctx.fillStyle = '#e8cf8c';
    else {
      const g = ctx.createLinearGradient(0, -hy, 0, hy);
      g.addColorStop(0, '#e9ecef'); g.addColorStop(0.5, '#b7bec6'); g.addColorStop(1, '#d4d9de');
      ctx.fillStyle = g;
    }
    ctx.fill();
    ctx.lineWidth = Math.max(0.06, 1.3 / px);
    ctx.strokeStyle = s.kind === 'plastic' ? pl.edge : 'rgba(60, 50, 40, 0.75)';
    ctx.stroke();
    if (s.kind === 'bamboo') {
      ctx.strokeStyle = 'rgba(150, 110, 40, 0.35)';
      ctx.lineWidth = 0.05;
      for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(-hx + 0.3, k * hy * 0.3); ctx.lineTo(hx - 0.3, k * hy * 0.3 + 0.05); ctx.stroke(); }
    }
    // 目盛り
    const W = hy * 2, L = hx * 2;
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
      const len = cm ? W * 0.32 : half ? W * 0.22 : W * 0.13;
      ctx.moveTo(x, -hy); ctx.lineTo(x, -hy + len);
    }
    ctx.stroke();
    const every = ppcm >= 13 ? 1 : 5;
    const fs = W * 0.25 * px;
    if (fs >= 6) {
      ctx.save();
      ctx.scale(1 / px, 1 / px);
      ctx.font = `600 ${fs.toFixed(1)}px "Zen Kaku Gothic New", system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = ink;
      for (let c = 0; c <= s.nominal; c += every) ctx.fillText(String(c), (x0 + c * scale) * px, (-hy + W * 0.34) * px);
      ctx.restore();
    }
    // 名前シール
    const sw = Math.min(3.0, L * 0.12), sh = W * 0.42;
    const sx = hx - sw - Math.min(1.2, L * 0.05), sy = hy - sh - W * 0.1;
    roundRect(sx, sy, sw, sh, sh * 0.25);
    ctx.fillStyle = pl.sticker; ctx.fill();
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
      roundRect(-hx - 0.7, -hy - 0.7, hx * 2 + 1.4, hy * 2 + 1.4, 0.8);
      ctx.setLineDash([0.8, 0.6]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(0.12, 2 / px);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // aim: { cx, cy（はじく点）, px, py（指の位置） }
  function drawAim(a, px) {
    const dx = a.px - a.cx, dy = a.py - a.cy;
    const len = Math.hypot(dx, dy);
    ctx.setLineDash([0.6, 0.5]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = Math.max(0.08, 1.5 / px);
    ctx.beginPath(); ctx.moveTo(a.cx, a.cy); ctx.lineTo(a.px, a.py); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(a.cx, a.cy, Math.max(0.35, 4 / px), 0, Math.PI * 2); ctx.fill();
    if (len < 0.8) return;
    const power = Math.min(len, MAX_DRAG) / MAX_DRAG;
    const ux = -dx / len, uy = -dy / len;
    const al = 3 + power * 14;
    const ex = a.cx + ux * al, ey = a.cy + uy * al;
    const col = `hsl(${50 - power * 45}, 95%, 62%)`;
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.lineWidth = Math.max(0.3, 4 / px);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.cx, a.cy); ctx.lineTo(ex - ux * 1.2, ey - uy * 1.2); ctx.stroke();
    const hw = Math.max(0.9, 9 / px);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ux * hw * 1.5 - uy * hw, ey - uy * hw * 1.5 + ux * hw);
    ctx.lineTo(ex - ux * hw * 1.5 + uy * hw, ey - uy * hw * 1.5 - ux * hw);
    ctx.closePath(); ctx.fill();
    ctx.lineCap = 'butt';
    const sp = toScreen(a.px, a.py);
    ctx.save();
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.font = '700 14px "Zen Kaku Gothic New", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const txt = `力 ${Math.round(power * 100)}%`;
    const ty = Math.max(20, sp.y - 26);
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(30,24,20,0.85)';
    ctx.strokeText(txt, sp.x, ty);
    ctx.fillStyle = col; ctx.fillText(txt, sp.x, ty);
    ctx.restore();
  }

  window.addEventListener('resize', layout);
  layout();
  return { setDesk, layout, draw, toWorld, get scale() { return view.s; } };
}
