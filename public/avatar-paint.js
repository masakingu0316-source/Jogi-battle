// アバターを描く（3頭身のデフォルメ）。パーツの形はここ、パーツの一覧と色は shared/avatar.js。
// 描く範囲は 横120 × 縦184（単位）。全身（full）・胸から上（bust）・顔（face）を切り出して使う。
import { partOf, avatarKey } from './shared/avatar.js';

const W = 120, H = 184;
const HX = 60, HY = 50, RX = 33, RY = 30; // 頭の中心と大きさ
export const VIEWS = {
  full: { x: 0, y: 0, w: W, h: H },
  bust: { x: 12, y: 6, w: 96, h: 104 },
  face: { x: 22, y: 14, w: 76, h: 76 },
};
const INK = '#2b2730';

// ---- 色 ----
function mix(hex, to, t) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const ch = (v, s) => (v >> s) & 255;
  const m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return `#${((1 << 24) | (m(16) << 16) | (m(8) << 8) | m(0)).toString(16).slice(1)}`;
}
const dark = (c, t = 0.38) => mix(c, '#140f14', t);
const light = (c, t = 0.3) => mix(c, '#ffffff', t);

function fs(ctx, fill, stroke = dark(fill), lw = 1.3) {
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function ell(ctx, x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); }
function poly(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath(); }

// パーツ（なければ null）。色は c1・c2
const pick = (av, slot) => partOf(slot, av?.[slot]);

// ================= 背景 =================
function drawBg(ctx, p) {
  const c1 = p.c1, c2 = p.c2 || '#ffffff';
  ctx.save();
  if (p.base === 'classroom') {
    ctx.fillStyle = c1; ctx.fillRect(0, 0, W, H);
    // 腰板
    ctx.fillStyle = mix(c1, '#8a6a48', 0.55); ctx.fillRect(0, 118, W, 34);
    ctx.strokeStyle = dark(mix(c1, '#8a6a48', 0.55), 0.2); ctx.lineWidth = 0.8;
    for (let x = 0; x <= W; x += 15) { ctx.beginPath(); ctx.moveTo(x, 118); ctx.lineTo(x, 152); ctx.stroke(); }
    // 窓
    rr(ctx, 10, 14, 100, 70, 2); fs(ctx, c2, dark(c1, 0.35), 2.2);
    const sky = ctx.createLinearGradient(0, 14, 0, 84); sky.addColorStop(0, c2); sky.addColorStop(1, light(c2, 0.5));
    ctx.fillStyle = sky; ctx.fillRect(11, 15, 98, 68);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ell(ctx, 30, 36, 10, 4); ctx.fill(); ell(ctx, 38, 33, 8, 5); ctx.fill(); ell(ctx, 88, 48, 9, 3.5); ctx.fill();
    ctx.strokeStyle = mix(c1, '#6b5a48', 0.5); ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(60, 14); ctx.lineTo(60, 84); ctx.moveTo(10, 50); ctx.lineTo(110, 50); ctx.stroke();
    // 床
    ctx.fillStyle = '#b48a5e'; ctx.fillRect(0, 152, W, H - 152);
    ctx.strokeStyle = 'rgba(80,50,30,.35)'; ctx.lineWidth = 0.7;
    for (let y = 160; y < H; y += 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  } else if (p.base === 'kokuban') {
    ctx.fillStyle = '#e9e0cb'; ctx.fillRect(0, 0, W, H);
    rr(ctx, 4, 12, 112, 88, 2); fs(ctx, '#8a6440', '#5e4229', 1.2);
    ctx.fillStyle = c1; ctx.fillRect(8, 16, 104, 78);
    // チョークの字と線
    ctx.fillStyle = c2; ctx.strokeStyle = c2; ctx.globalAlpha = 0.85;
    ctx.font = '700 15px "Yuji Boku", "Noto Serif CJK JP", serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('定規', 14, 22);
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(14, 44); ctx.lineTo(48, 44); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(84, 26); ctx.lineTo(104, 26); ctx.lineTo(84, 50); ctx.closePath(); ctx.stroke();
    for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(86 + k * 3, 26); ctx.lineTo(86 + k * 3, 29); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#7a5838'; ctx.fillRect(6, 94, 108, 4);
    ctx.fillStyle = '#fff'; ctx.fillRect(20, 92, 8, 2); ctx.fillStyle = '#f3c3c0'; ctx.fillRect(32, 92, 6, 2);
    ctx.fillStyle = '#c8ab84'; ctx.fillRect(0, 150, W, H - 150);
    ctx.fillStyle = 'rgba(80,50,30,.2)'; ctx.fillRect(0, 150, W, 2);
  } else if (p.base === 'dojo') {
    ctx.fillStyle = c1; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = dark(c1, 0.25); ctx.lineWidth = 0.8;
    for (let x = 0; x <= W; x += 12) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 148); ctx.stroke(); }
    ctx.fillStyle = dark(c1, 0.45); ctx.fillRect(0, 8, W, 4); ctx.fillRect(0, 144, W, 6);
    // 掛け軸
    ctx.fillStyle = '#6d5236'; ctx.fillRect(40, 14, 40, 3); ctx.fillRect(40, 101, 40, 4);
    rr(ctx, 43, 17, 34, 84, 1); fs(ctx, '#7b8a6a', '#4d5a42', 0.8);
    ctx.fillStyle = c2; ctx.fillRect(47, 22, 26, 74);
    ctx.fillStyle = INK; ctx.font = '700 22px "Yuji Boku", "Noto Serif CJK JP", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('心', 60, 46); ctx.font = '700 14px "Yuji Boku", "Noto Serif CJK JP", serif'; ctx.fillText('技', 60, 70);
    ctx.fillStyle = '#b8392d'; ctx.fillRect(64, 84, 5, 5);
    // 床（板）
    ctx.fillStyle = mix(c1, '#d9b98c', 0.4); ctx.fillRect(0, 150, W, H - 150);
    ctx.strokeStyle = 'rgba(90,60,30,.3)'; ctx.lineWidth = 0.7;
    for (let y = 156; y < H; y += 7) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  } else if (p.base === 'kotei') {
    const sky = ctx.createLinearGradient(0, 0, 0, 150); sky.addColorStop(0, c1); sky.addColorStop(1, light(c1, 0.6));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // 校舎
    ctx.fillStyle = '#efe7d6'; ctx.fillRect(56, 54, 70, 96); ctx.fillStyle = '#d9cdb5'; ctx.fillRect(56, 50, 70, 6);
    ctx.fillStyle = '#9fb8c8';
    for (let y = 66; y < 140; y += 20) for (let x = 64; x < 120; x += 16) ctx.fillRect(x, y, 10, 10);
    ctx.fillStyle = '#e6dcc8'; ctx.fillRect(80, 36, 14, 18); ctx.fillStyle = '#fff'; ell(ctx, 87, 44, 4.5, 4.5); ctx.fill();
    // 桜
    ctx.fillStyle = '#6b4e3a'; ctx.fillRect(18, 74, 6, 78);
    ctx.fillStyle = c2;
    for (const [x, y, r] of [[8, 54, 16], [26, 44, 18], [40, 60, 14], [14, 74, 12], [34, 78, 11]]) { ell(ctx, x, y, r, r * 0.85); ctx.fill(); }
    ctx.fillStyle = light(c2, 0.45);
    for (const [x, y] of [[18, 40], [34, 52], [8, 62], [44, 70], [26, 70]]) { ell(ctx, x, y, 3, 2.4); ctx.fill(); }
    ctx.fillStyle = '#d7c39b'; ctx.fillRect(0, 150, W, H - 150);
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    for (const [x, y] of [[50, 30], [70, 100], [100, 160], [30, 166], [110, 24]]) { ell(ctx, x, y, 1.6, 1.1, 0.6); ctx.fill(); }
  }
  ctx.restore();
}

// ================= 髪 =================
function hairBack(ctx, p, col) {
  const c = col, s = dark(col);
  if (p.base === 'long') {
    ctx.beginPath();
    ctx.moveTo(HX - 38, HY - 4);
    ctx.bezierCurveTo(HX - 46, HY + 40, HX - 44, HY + 64, HX - 34, HY + 72);
    ctx.lineTo(HX + 34, HY + 72);
    ctx.bezierCurveTo(HX + 44, HY + 64, HX + 46, HY + 40, HX + 38, HY - 4);
    ctx.closePath(); fs(ctx, c, s);
  } else if (p.base === 'bob') {
    ctx.beginPath();
    ctx.moveTo(HX - 38, HY - 4);
    ctx.bezierCurveTo(HX - 42, HY + 18, HX - 40, HY + 30, HX - 32, HY + 33);
    ctx.lineTo(HX + 32, HY + 33);
    ctx.bezierCurveTo(HX + 40, HY + 30, HX + 42, HY + 18, HX + 38, HY - 4);
    ctx.closePath(); fs(ctx, c, s);
  } else if (p.base === 'pony') {
    ctx.beginPath();
    ctx.moveTo(HX + 22, HY - 26);
    ctx.bezierCurveTo(HX + 52, HY - 30, HX + 56, HY + 8, HX + 46, HY + 36);
    ctx.bezierCurveTo(HX + 44, HY + 18, HX + 40, HY - 4, HX + 26, HY - 12);
    ctx.closePath(); fs(ctx, c, s);
  } else if (p.base === 'twin') {
    for (const sg of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(HX + sg * 30, HY - 18);
      ctx.bezierCurveTo(HX + sg * 54, HY - 14, HX + sg * 54, HY + 26, HX + sg * 44, HY + 50);
      ctx.bezierCurveTo(HX + sg * 42, HY + 30, HX + sg * 38, HY + 6, HX + sg * 30, HY - 4);
      ctx.closePath(); fs(ctx, c, s);
    }
  }
}
function hairFront(ctx, p, col) {
  const c = col, s = dark(col);
  const cap = (top = 16) => {
    ctx.beginPath();
    ctx.moveTo(HX - 36, HY + 6);
    ctx.bezierCurveTo(HX - 40, top - 22, HX + 40, top - 22, HX + 36, HY + 6);
  };
  ctx.save();
  if (p.base === 'spiky') {
    ctx.beginPath();
    ctx.moveTo(HX - 36, HY + 6);
    const spikes = [[-40, -6], [-44, -22], [-30, -26], [-34, -42], [-14, -34], [-8, -48], [6, -36], [18, -48], [22, -32], [40, -36], [34, -20], [44, -10], [36, 6]];
    for (const [x, y] of spikes) ctx.lineTo(HX + x, HY + y);
    // 前髪
    for (const [x, y] of [[28, -6], [20, -14], [14, -4], [4, -16], [-6, -4], [-14, -16], [-22, -6], [-30, -12]]) ctx.lineTo(HX + x, HY + y);
    ctx.closePath(); fs(ctx, c, s);
  } else if (p.base === 'mage') {
    // ちょんまげ：横と後ろは短く、上に髷
    cap(18);
    for (const [x, y] of [[30, -8], [22, -16], [0, -20], [-22, -16], [-30, -8]]) ctx.lineTo(HX + x, HY + y);
    ctx.closePath(); fs(ctx, c, s);
    ctx.fillStyle = light(c, 0.14); ell(ctx, HX, HY - 24, 20, 5); ctx.fill();
    rr(ctx, HX - 4, HY - 46, 8, 18, 3); fs(ctx, c, s);
    ell(ctx, HX, HY - 47, 6, 3.2); fs(ctx, c, s);
    ctx.fillStyle = '#f2efe6'; ctx.fillRect(HX - 4.5, HY - 33, 9, 2.4);
  } else {
    cap(p.base === 'bun' ? 18 : 16);
    // 前髪（髪型ごと）
    const fringe = {
      short: [[34, -2], [26, -14], [18, -6], [10, -18], [0, -8], [-8, -18], [-16, -8], [-24, -16], [-32, -2]],
      bob: [[34, 2], [24, -8], [12, -8], [0, -8], [-12, -8], [-24, -8], [-34, 2]],
      long: [[34, 4], [22, -12], [12, -2], [2, -16], [-10, -4], [-20, -14], [-34, 4]],
      pony: [[34, -2], [22, -16], [10, -6], [0, -18], [-12, -6], [-24, -16], [-34, -2]],
      bun: [[34, -2], [24, -12], [12, -6], [0, -14], [-12, -6], [-24, -12], [-34, -2]],
      twin: [[34, 0], [24, -10], [12, -4], [2, -14], [-10, -4], [-22, -10], [-34, 0]],
    }[p.base] || [[34, 0], [0, -14], [-34, 0]];
    for (const [x, y] of fringe) ctx.lineTo(HX + x, HY + y);
    ctx.closePath(); fs(ctx, c, s);
    // 横の髪（ボブ・ロングは顔の横に垂らす）
    if (p.base === 'bob' || p.base === 'long') {
      const len = p.base === 'long' ? 44 : 30;
      for (const sg of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(HX + sg * 36, HY - 2);
        ctx.bezierCurveTo(HX + sg * 38, HY + len * 0.5, HX + sg * 37, HY + len * 0.8, HX + sg * 32, HY + len);
        ctx.lineTo(HX + sg * 27, HY + len - 4);
        ctx.bezierCurveTo(HX + sg * 29, HY + len * 0.5, HX + sg * 29, HY + 10, HX + sg * 27, HY - 2);
        ctx.closePath(); fs(ctx, c, s);
      }
    }
    if (p.base === 'bun') {
      ell(ctx, HX, HY - 34, 11, 10); fs(ctx, c, s);
      ctx.strokeStyle = light(c, 0.25); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(HX, HY - 34, 6, Math.PI * 1.1, Math.PI * 1.7); ctx.stroke();
      rr(ctx, HX - 8, HY - 26, 16, 3.4, 1.4); fs(ctx, p.c2 || '#c7a14a');
    }
    if (p.base === 'pony') { ell(ctx, HX + 26, HY - 20, 4.2, 3.4, 0.4); fs(ctx, p.c2 || '#9c3b30'); }
    if (p.base === 'twin') for (const sg of [-1, 1]) { ell(ctx, HX + sg * 32, HY - 16, 4, 3.4); fs(ctx, p.c2 || '#9c3b30'); }
  }
  // つや
  ctx.strokeStyle = light(c, 0.32); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(HX - 6, HY - 6, 26, Math.PI * 1.22, Math.PI * 1.42); ctx.stroke();
  ctx.restore();
}

// ================= 顔 =================
function drawEyes(ctx, p) {
  const ex = [HX - 12, HX + 12], ey = HY + 7;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const dot = (x, y, w = 3.6, h = 4.8) => {
    ell(ctx, x, y, w, h); ctx.fillStyle = INK; ctx.fill();
    ctx.fillStyle = '#fff'; ell(ctx, x - 1.1, y - 1.6, 1.2, 1.4); ctx.fill();
  };
  const arc = (x, y, up = true) => {
    ctx.strokeStyle = INK; ctx.lineWidth = 1.8;
    ctx.beginPath(); up ? ctx.arc(x, y + 2, 4, Math.PI * 1.15, Math.PI * 1.85) : ctx.arc(x, y - 2, 4, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
  };
  const brow = (x, y, tilt) => {
    ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x - 4, y + tilt); ctx.lineTo(x + 4, y - tilt); ctx.stroke();
  };
  switch (p.base) {
    case 'nikko': arc(ex[0], ey); arc(ex[1], ey); break;
    case 'kiri':
      for (const [i, x] of ex.entries()) {
        const sg = i ? 1 : -1;
        ctx.beginPath(); ctx.moveTo(x - 4.2, ey + 0.5); ctx.quadraticCurveTo(x, ey - 4.6, x + 4.2, ey - 0.5 * sg); ctx.quadraticCurveTo(x, ey + 3.6, x - 4.2, ey + 0.5);
        ctx.fillStyle = INK; ctx.fill();
        ctx.fillStyle = '#fff'; ell(ctx, x - 1, ey - 1.2, 1, 1); ctx.fill();
        brow(x, ey - 8, sg * -1.6 * (i ? -1 : 1));
      }
      break;
    case 'tare':
      for (const [i, x] of ex.entries()) {
        dot(x, ey + 0.5, 3.4, 4.2);
        ctx.strokeStyle = INK; ctx.lineWidth = 1.3;
        const sg = i ? 1 : -1;
        ctx.beginPath(); ctx.moveTo(x - 4.5 * sg, ey - 5); ctx.quadraticCurveTo(x, ey - 6.5, x + 4.5 * sg, ey - 3.5); ctx.stroke();
      }
      break;
    case 'jito':
      for (const x of ex) {
        ell(ctx, x, ey + 1.5, 3.4, 3); ctx.fillStyle = INK; ctx.fill();
        ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - 4.6, ey - 0.4); ctx.lineTo(x + 4.6, ey - 0.4); ctx.stroke();
      }
      break;
    case 'kira':
      for (const x of ex) {
        ell(ctx, x, ey, 4.2, 5.4); ctx.fillStyle = INK; ctx.fill();
        ctx.fillStyle = '#6a5a8a'; ell(ctx, x, ey + 1.8, 3, 2.6); ctx.fill();
        ctx.fillStyle = '#fff'; ell(ctx, x - 1.3, ey - 2, 1.6, 1.8); ctx.fill(); ell(ctx, x + 1.6, ey + 2, 0.8, 0.8); ctx.fill();
        ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + 3.6, ey - 4.4); ctx.lineTo(x + 5.6, ey - 6); ctx.stroke();
      }
      break;
    case 'wink':
      dot(ex[0], ey);
      ctx.strokeStyle = INK; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(ex[1] - 4, ey - 2.5); ctx.lineTo(ex[1] + 3, ey); ctx.lineTo(ex[1] - 4, ey + 2.5); ctx.stroke();
      break;
    default: dot(ex[0], ey); dot(ex[1], ey);
  }
  ctx.restore();
}
function drawMouth(ctx, eyes) {
  ctx.save();
  ctx.strokeStyle = '#7a3b30'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
  const y = HY + 18;
  if (eyes === 'nikko' || eyes === 'kira') {
    ctx.beginPath(); ctx.moveTo(HX - 4, y - 1); ctx.quadraticCurveTo(HX, y + 5, HX + 4, y - 1); ctx.closePath();
    ctx.fillStyle = '#b5574a'; ctx.fill(); ctx.stroke();
  } else if (eyes === 'jito') {
    ctx.beginPath(); ctx.moveTo(HX - 3, y + 1); ctx.lineTo(HX + 3, y + 1); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(HX - 3.5, y); ctx.quadraticCurveTo(HX, y + 3, HX + 3.5, y); ctx.stroke();
  }
  ctx.restore();
}

// ================= 体と服 =================
const SHOE = '#3a2c25';
function legs(ctx, skin, { sock = null, sockTop = 152, shoe = SHOE, bare = true } = {}) {
  for (const x of [HX - 8, HX + 8]) {
    if (bare) { rr(ctx, x - 5, 118, 10, 46, 4); fs(ctx, skin); }
    if (sock) { rr(ctx, x - 5.2, sockTop, 10.4, 164 - sockTop, 3); fs(ctx, sock); }
    ell(ctx, x + (x < HX ? -1.5 : 1.5), 166, 7.4, 4.2); fs(ctx, shoe);
  }
}
function pants(ctx, col, bottom = 164) {
  for (const x of [HX - 8, HX + 8]) { rr(ctx, x - 6.2, 118, 12.4, bottom - 118, 3); fs(ctx, col); }
  ctx.fillStyle = col; ctx.fillRect(HX - 13.5, 116, 27, 10);
  ctx.strokeStyle = dark(col); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(HX, 120); ctx.lineTo(HX, 130); ctx.stroke();
}
function torsoPath(ctx, top = 82, bottom = 124, sh = 22, hip = 19) {
  ctx.beginPath();
  ctx.moveTo(HX - sh + 4, top);
  ctx.quadraticCurveTo(HX - sh, top + 1, HX - sh, top + 7);
  ctx.lineTo(HX - hip, bottom);
  ctx.lineTo(HX + hip, bottom);
  ctx.lineTo(HX + sh, top + 7);
  ctx.quadraticCurveTo(HX + sh, top + 1, HX + sh - 4, top);
  ctx.closePath();
}
// 腕（袖の色・袖の長さ）と手
function arms(ctx, skin, sleeve, { short = false, wide = false } = {}) {
  for (const sg of [-1, 1]) {
    const sx = HX + sg * 20, hx = HX + sg * 27;
    if (wide) {
      ctx.beginPath(); ctx.moveTo(sx, 84); ctx.lineTo(hx + sg * 8, 112); ctx.lineTo(hx + sg * 6, 120); ctx.lineTo(hx - sg * 6, 116); ctx.lineTo(sx - sg * 4, 96); ctx.closePath();
      fs(ctx, sleeve);
    } else {
      ctx.beginPath(); ctx.moveTo(sx - sg * 1, 84); ctx.lineTo(hx + sg * 4, short ? 100 : 114); ctx.lineTo(hx - sg * 4.5, short ? 102 : 116); ctx.lineTo(sx - sg * 7, 94); ctx.closePath();
      fs(ctx, short ? skin : sleeve);
      if (short) { ctx.beginPath(); ctx.moveTo(sx - sg * 1, 84); ctx.lineTo(sx + sg * 5, 96); ctx.lineTo(sx - sg * 5, 99); ctx.lineTo(sx - sg * 7, 92); ctx.closePath(); fs(ctx, sleeve); }
    }
    ell(ctx, hx, 119, 4.6, 4.8); fs(ctx, skin);
  }
}

function drawOutfit(ctx, p, skin, jacket) {
  const c1 = p.c1, c2 = p.c2 || '#ffffff';
  const sleeve = jacket ? null : undefined;
  switch (p.base) {
    case 'gakuran': {
      legs(ctx, skin, { bare: false }); pants(ctx, c1);
      torsoPath(ctx); fs(ctx, c1);
      if (!jacket) arms(ctx, skin, c1);
      rr(ctx, HX - 7, 79, 14, 7, 2); fs(ctx, light(c1, 0.08));
      ctx.strokeStyle = dark(c1, 0.5); ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(HX, 86); ctx.lineTo(HX, 124); ctx.stroke();
      for (const y of [91, 100, 109, 118]) { ell(ctx, HX + 0.1, y, 1.8, 1.8); fs(ctx, c2, dark(c2), 0.6); }
      break;
    }
    case 'sailor': {
      legs(ctx, skin, { sock: c1, sockTop: 148 });
      // スカート
      ctx.beginPath(); ctx.moveTo(HX - 17, 114); ctx.lineTo(HX - 23, 140); ctx.lineTo(HX + 23, 140); ctx.lineTo(HX + 17, 114); ctx.closePath(); fs(ctx, c1);
      ctx.strokeStyle = dark(c1, 0.45); ctx.lineWidth = 0.8;
      for (const x of [-12, -4, 4, 12]) { ctx.beginPath(); ctx.moveTo(HX + x * 0.8, 116); ctx.lineTo(HX + x * 1.2, 139); ctx.stroke(); }
      torsoPath(ctx, 82, 118); fs(ctx, '#f3f0e8');
      if (!jacket) arms(ctx, skin, '#f3f0e8');
      // えり（肩から胸のV）
      poly(ctx, [HX - 21, 85, HX - 12, 82, HX, 102, HX + 12, 82, HX + 21, 85, HX + 15, 95, HX, 106, HX - 15, 95]); fs(ctx, c1);
      ctx.strokeStyle = '#f3f0e8'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(HX - 18, 87); ctx.lineTo(HX, 104); ctx.lineTo(HX + 18, 87); ctx.stroke();
      // スカーフ
      poly(ctx, [HX - 5, 99, HX + 5, 99, HX + 2, 104, HX - 2, 104]); fs(ctx, c2);
      poly(ctx, [HX - 2, 103, HX - 5, 114, HX - 1, 112]); fs(ctx, c2);
      poly(ctx, [HX + 2, 103, HX + 5, 114, HX + 1, 112]); fs(ctx, c2);
      break;
    }
    case 'blazer': {
      legs(ctx, skin, { bare: false }); pants(ctx, '#6c707a');
      torsoPath(ctx); fs(ctx, '#f4f2ec');
      // ネクタイ
      poly(ctx, [HX - 2.6, 84, HX + 2.6, 84, HX + 3.8, 104, HX, 108, HX - 3.8, 104]); fs(ctx, c2);
      // ブレザー（前が開いている）
      ctx.beginPath(); ctx.moveTo(HX - 18, 82); ctx.quadraticCurveTo(HX - 22, 83, HX - 22, 89); ctx.lineTo(HX - 19, 124); ctx.lineTo(HX - 3, 124); ctx.lineTo(HX - 4, 108); ctx.lineTo(HX - 9, 84); ctx.closePath(); fs(ctx, c1);
      ctx.beginPath(); ctx.moveTo(HX + 18, 82); ctx.quadraticCurveTo(HX + 22, 83, HX + 22, 89); ctx.lineTo(HX + 19, 124); ctx.lineTo(HX + 3, 124); ctx.lineTo(HX + 4, 108); ctx.lineTo(HX + 9, 84); ctx.closePath(); fs(ctx, c1);
      // えり
      poly(ctx, [HX - 9, 84, HX - 4, 104, HX - 8, 96, HX - 13, 86]); fs(ctx, dark(c1, 0.18));
      poly(ctx, [HX + 9, 84, HX + 4, 104, HX + 8, 96, HX + 13, 86]); fs(ctx, dark(c1, 0.18));
      ell(ctx, HX - 13, 100, 2.6, 2.6); fs(ctx, '#c9a64a', '#8a6d2a', 0.6);
      ell(ctx, HX - 3.6, 114, 1.4, 1.4); fs(ctx, light(c1, 0.3), null);
      if (!jacket) arms(ctx, skin, c1);
      break;
    }
    case 'gym': {
      legs(ctx, skin, { sock: '#f4f2ec', sockTop: 154, shoe: '#f1efe9' });
      for (const x of [HX - 8, HX + 8]) { ctx.strokeStyle = c1; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 5, 166); ctx.lineTo(x + 5, 166); ctx.stroke(); }
      // 短パン
      ctx.beginPath(); ctx.moveTo(HX - 17, 114); ctx.lineTo(HX - 19, 134); ctx.lineTo(HX - 1, 134); ctx.lineTo(HX, 128); ctx.lineTo(HX + 1, 134); ctx.lineTo(HX + 19, 134); ctx.lineTo(HX + 17, 114); ctx.closePath(); fs(ctx, c2);
      torsoPath(ctx, 82, 120); fs(ctx, '#f6f4ef');
      if (!jacket) arms(ctx, skin, '#f6f4ef', { short: true });
      ctx.strokeStyle = c1; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(HX, 80, 8, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
      // ゼッケン
      rr(ctx, HX - 9, 96, 18, 12, 1.5); fs(ctx, '#ffffff', c1, 1);
      ctx.fillStyle = c1; ctx.font = '700 7px "BIZ UDPGothic", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('1-2', HX, 102.4);
      break;
    }
    case 'hakama': {
      // 足袋
      for (const x of [HX - 9, HX + 9]) { ell(ctx, x + (x < HX ? -1.5 : 1.5), 166, 7, 4); fs(ctx, '#f4f2ec'); }
      // 袴（すそ広がり）
      ctx.beginPath(); ctx.moveTo(HX - 18, 108); ctx.lineTo(HX - 27, 164); ctx.lineTo(HX - 2, 164); ctx.lineTo(HX, 140); ctx.lineTo(HX + 2, 164); ctx.lineTo(HX + 27, 164); ctx.lineTo(HX + 18, 108); ctx.closePath(); fs(ctx, c1);
      ctx.strokeStyle = dark(c1, 0.45); ctx.lineWidth = 0.8;
      for (const x of [-13, -7, 7, 13]) { ctx.beginPath(); ctx.moveTo(HX + x * 0.7, 112); ctx.lineTo(HX + x * 1.4, 163); ctx.stroke(); }
      torsoPath(ctx, 82, 112, 22, 19); fs(ctx, c2);
      if (!jacket) arms(ctx, skin, c2, { wide: true });
      // 合わせ（右前）
      ctx.strokeStyle = '#2b2a33'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(HX - 9, 82); ctx.lineTo(HX + 5, 108); ctx.stroke();
      ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(HX + 9, 82); ctx.lineTo(HX + 1, 96); ctx.stroke();
      // ひも
      ctx.fillStyle = dark(c1, 0.15); ctx.fillRect(HX - 18, 106, 36, 5);
      break;
    }
    case 'jinbei': {
      legs(ctx, skin, { shoe: '#7a5a3c' });
      ctx.beginPath(); ctx.moveTo(HX - 17, 114); ctx.lineTo(HX - 19, 140); ctx.lineTo(HX - 1, 140); ctx.lineTo(HX, 130); ctx.lineTo(HX + 1, 140); ctx.lineTo(HX + 19, 140); ctx.lineTo(HX + 17, 114); ctx.closePath(); fs(ctx, c1);
      torsoPath(ctx, 82, 122); fs(ctx, c1);
      if (!jacket) arms(ctx, skin, c1, { short: true });
      ctx.strokeStyle = c2; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(HX - 9, 82); ctx.lineTo(HX + 4, 106); ctx.moveTo(HX + 9, 82); ctx.lineTo(HX + 1, 96); ctx.stroke();
      // 麻の葉ふうの模様
      ctx.strokeStyle = light(c1, 0.25); ctx.lineWidth = 0.6;
      for (let y = 90; y < 120; y += 7) for (let x = HX - 16; x < HX + 18; x += 8) { ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.lineTo(x + 2, y); ctx.moveTo(x, y - 2); ctx.lineTo(x, y + 2); ctx.stroke(); }
      ctx.fillStyle = c2; ctx.fillRect(HX + 6, 104, 6, 2);
      break;
    }
    case 'jersey': {
      // ジャージ（上下）：ズボンと袖に白いライン、前はファスナー
      legs(ctx, skin, { bare: false, shoe: '#f1efe9' }); pants(ctx, c1);
      ctx.strokeStyle = c2; ctx.lineWidth = 1.5;
      for (const x of [HX - 13.2, HX + 13.2]) { ctx.beginPath(); ctx.moveTo(x, 121); ctx.lineTo(x + (x < HX ? 0.4 : -0.4), 162); ctx.stroke(); }
      torsoPath(ctx); fs(ctx, c1);
      if (!jacket) {
        arms(ctx, skin, c1);
        ctx.strokeStyle = c2; ctx.lineWidth = 1.4;
        for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(HX + sg * 21.5, 86); ctx.lineTo(HX + sg * 30, 113); ctx.stroke(); }
      }
      rr(ctx, HX - 8, 77, 16, 8, 2.5); fs(ctx, c1);
      ctx.strokeStyle = c2; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(HX, 80); ctx.lineTo(HX, 124); ctx.stroke();
      rr(ctx, HX - 1.3, 88, 2.6, 4, 0.8); fs(ctx, c2, dark(c2, 0.3), 0.5);
      ctx.fillStyle = c2; ctx.fillRect(HX + 6, 94, 9, 1.6);
      break;
    }
    default: {
      legs(ctx, skin); torsoPath(ctx); fs(ctx, '#d8d2c2'); if (!jacket) arms(ctx, skin, '#d8d2c2');
    }
  }
  return sleeve;
}

function jacketBack(ctx, p) {
  if (p.base === 'parka') {
    // フード（首の後ろ）
    ctx.beginPath(); ctx.moveTo(HX - 24, 84); ctx.quadraticCurveTo(HX - 30, 66, HX, 66); ctx.quadraticCurveTo(HX + 30, 66, HX + 24, 84); ctx.closePath(); fs(ctx, dark(p.c1, 0.12));
  }
}
// 前が開いた上着（袖も上着の色になる）。ほかの上着（マフラー・ゼッケン・腕章・たすき）は服の上に重ねるだけ
const COATS = new Set(['cardigan', 'parka', 'haori', 'hanten', 'chalkcoat', 'hakui']);
const isCoat = (p) => !!p && COATS.has(p.base);
function drawJacket(ctx, p, skin) {
  const c1 = p.c1, c2 = p.c2 || '#ffffff';
  if (!isCoat(p)) { drawWearOn(ctx, p); return; }
  const len = p.base === 'haori' ? 142 : p.base === 'hakui' ? 146 : p.base === 'cardigan' || p.base === 'chalkcoat' ? 126 : 124;
  const gap = p.base === 'haori' ? 7 : p.base === 'hakui' ? 6 : 5;
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(HX + sg * 19, 82); ctx.quadraticCurveTo(HX + sg * 23, 83, HX + sg * 23, 89);
    ctx.lineTo(HX + sg * (p.base === 'haori' ? 24 : 21), len);
    ctx.lineTo(HX + sg * gap, len); ctx.lineTo(HX + sg * gap, 96); ctx.lineTo(HX + sg * 8, 82);
    ctx.closePath(); fs(ctx, c1);
  }
  if (p.base === 'cardigan') {
    for (const y of [98, 106, 114, 121]) { ell(ctx, HX - 6.8, y, 1.3, 1.3); fs(ctx, '#efe7d5', dark(c1), 0.5); }
    ctx.strokeStyle = dark(c1, 0.25); ctx.lineWidth = 0.7;
    for (const sg of [-1, 1]) for (let x = 8; x <= 20; x += 3) { ctx.beginPath(); ctx.moveTo(HX + sg * x, 121); ctx.lineTo(HX + sg * x, 126); ctx.stroke(); }
    arms(ctx, skin, c1);
  } else if (p.base === 'parka') {
    ctx.strokeStyle = c2; ctx.lineWidth = 1.1;
    for (const x of [HX - 6, HX + 6]) { ctx.beginPath(); ctx.moveTo(x, 86); ctx.lineTo(x + (x < HX ? -1 : 1), 104); ctx.stroke(); ell(ctx, x + (x < HX ? -1 : 1), 105, 1.1, 1.1); fs(ctx, c2, null); }
    ctx.strokeStyle = dark(c1, 0.3); ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(HX - 16, 112); ctx.lineTo(HX - 6, 112); ctx.moveTo(HX + 6, 112); ctx.lineTo(HX + 16, 112); ctx.stroke();
    arms(ctx, skin, c1);
  } else if (p.base === 'haori') {
    for (const sg of [-1, 1]) { ell(ctx, HX + sg * 14, 92, 2.8, 2.8); fs(ctx, c2, null); ctx.strokeStyle = c1; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.arc(HX + sg * 14, 92, 1.6, 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = '#f2efe6'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(HX - 7, 104); ctx.quadraticCurveTo(HX, 108, HX + 7, 104); ctx.stroke();
    ell(ctx, HX, 106, 1.8, 1.8); fs(ctx, '#f2efe6', null);
    arms(ctx, skin, c1, { wide: true });
  } else if (p.base === 'hanten') {
    for (const sg of [-1, 1]) { ctx.strokeStyle = c2; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(HX + sg * 9, 83); ctx.lineTo(HX + sg * 5.6, 98); ctx.lineTo(HX + sg * 5.6, 123); ctx.stroke(); }
    ctx.strokeStyle = light(c1, 0.2); ctx.lineWidth = 0.6;
    for (let y = 92; y < 124; y += 6) { ctx.beginPath(); ctx.moveTo(HX - 20, y); ctx.lineTo(HX - 8, y + 2); ctx.moveTo(HX + 8, y + 2); ctx.lineTo(HX + 20, y); ctx.stroke(); }
    arms(ctx, skin, c1, { wide: true });
  } else if (p.base === 'chalkcoat') {
    // チョークの粉が付いた上着：袖と前にうっすら白い粉
    for (const y of [99, 110]) { ell(ctx, HX - 7, y, 1.3, 1.3); fs(ctx, light(c1, 0.35), dark(c1), 0.5); }
    arms(ctx, skin, c1);
    ctx.fillStyle = c2;
    let r = 7; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    for (const [cx, cy, w] of [[HX - 25, 108, 7], [HX + 26, 104, 6], [HX - 13, 116, 6], [HX + 13, 96, 5]]) {
      ctx.globalAlpha = 0.5; ell(ctx, cx, cy, w, w * 0.45, -0.5); ctx.fill();
      ctx.globalAlpha = 0.8; for (let k = 0; k < 6; k++) { ell(ctx, cx + (rnd() - 0.5) * w * 1.6, cy + (rnd() - 0.5) * w * 0.8, 0.5, 0.5); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  } else if (p.base === 'hakui') {
    // 白衣：長い丈と、えり・胸ポケットにペン
    for (const sg of [-1, 1]) { poly(ctx, [HX + sg * 8, 82, HX + sg * 14, 84, HX + sg * 10, 98, HX + sg * 6, 98]); fs(ctx, dark(c1, 0.06), dark(c1, 0.3), 0.8); }
    rr(ctx, HX + 10, 98, 9, 8, 1); fs(ctx, null, c2, 0.9);
    ctx.fillStyle = '#2f5f8f'; ctx.fillRect(HX + 12, 95, 1.6, 6); ctx.fillStyle = '#c83a2f'; ctx.fillRect(HX + 15, 96, 1.6, 5);
    for (const y of [108, 118, 130]) { ell(ctx, HX - 6.5, y, 1.2, 1.2); fs(ctx, '#ffffff', dark(c1, 0.35), 0.5); }
    arms(ctx, skin, c1);
  }
}

// 服の上に重ねるもの（マフラーは首のあとで描く）
function drawWearOn(ctx, p) {
  const c1 = p.c1, c2 = p.c2 || '#ffffff';
  ctx.save();
  if (p.base === 'zekken') {
    // ゼッケン：胸に番号の布、四すみに安全ピン
    rr(ctx, HX - 13, 92, 26, 19, 1.5); fs(ctx, c1, dark(c1, 0.3), 0.9);
    ctx.fillStyle = c2; ctx.font = '700 12px "BIZ UDPGothic", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('18', HX, 102.5);
    ctx.strokeStyle = '#a7adb5'; ctx.lineWidth = 0.7;
    for (const [x, y] of [[HX - 11, 94], [HX + 11, 94], [HX - 11, 109], [HX + 11, 109]]) { ctx.beginPath(); ctx.moveTo(x - 1.6, y); ctx.lineTo(x + 1.6, y); ctx.stroke(); }
  } else if (p.base === 'wanshou') {
    // 腕章：左の腕（見て左）に赤い帯と字
    poly(ctx, [HX - 22.5, 90, HX - 12.5, 92.4, HX - 13.2, 100.5, HX - 25, 99]); fs(ctx, c1, dark(c1, 0.35), 0.8);
    ctx.fillStyle = c2; ctx.font = '700 5.2px "BIZ UDPGothic", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save(); ctx.translate(HX - 18.6, 95.6); ctx.rotate(0.12); ctx.fillText('委員長', 0, 0); ctx.restore();
  } else if (p.base === 'tasuki') {
    // たすき：左の肩から右の腰へ、金の帯に「学年最強」
    ctx.save();
    torsoPath(ctx); ctx.clip();
    ctx.translate(HX, 103); ctx.rotate(0.78);
    rr(ctx, -34, -4.6, 68, 9.2, 1); fs(ctx, c1, dark(c1, 0.35), 0.9);
    ctx.strokeStyle = light(c1, 0.45); ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-34, -3.2); ctx.lineTo(34, -3.2); ctx.moveTo(-34, 3.2); ctx.lineTo(34, 3.2); ctx.stroke();
    ctx.fillStyle = c2; ctx.font = '700 6px "Yuji Boku", "Noto Serif CJK JP", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('学年最強', 0, 0.4);
    ctx.restore();
  }
  ctx.restore();
}
// マフラー（首に巻いて、片方を前に垂らす）。首を描いたあとに重ねる
function drawMuffler(ctx, p) {
  const c1 = p.c1, c2 = p.c2 || '#ffffff';
  ctx.save();
  ctx.beginPath(); ctx.moveTo(HX - 19, 81); ctx.quadraticCurveTo(HX, 74, HX + 19, 81); ctx.quadraticCurveTo(HX + 20, 89, HX + 14, 91); ctx.quadraticCurveTo(HX, 86, HX - 14, 91); ctx.quadraticCurveTo(HX - 20, 89, HX - 19, 81); ctx.closePath();
  fs(ctx, c1, dark(c1, 0.3), 1);
  // 垂れた先
  poly(ctx, [HX - 13, 86, HX - 4, 87, HX - 3, 116, HX - 13, 114]); fs(ctx, c1, dark(c1, 0.3), 1);
  ctx.strokeStyle = c2; ctx.lineWidth = 1.6;
  for (const y of [96, 102, 108]) { ctx.beginPath(); ctx.moveTo(HX - 13, y); ctx.lineTo(HX - 3.5, y + 0.5); ctx.stroke(); }
  ctx.strokeStyle = dark(c1, 0.15); ctx.lineWidth = 0.9;
  for (let x = HX - 12; x <= HX - 4; x += 2) { ctx.beginPath(); ctx.moveTo(x, 115); ctx.lineTo(x, 119); ctx.stroke(); }
  ctx.strokeStyle = light(c1, 0.2); ctx.lineWidth = 0.6;
  for (let x = HX - 14; x <= HX + 14; x += 3.5) { ctx.beginPath(); ctx.moveTo(x, 80 + Math.abs(x - HX) * 0.1); ctx.lineTo(x + 1, 88); ctx.stroke(); }
  ctx.restore();
}

// ================= 持ち物 =================
function itemBack(ctx, p) {
  if (p.base === 'randoseru') {
    rr(ctx, HX - 26, 84, 52, 36, 7); fs(ctx, p.c1);
    ctx.fillStyle = dark(p.c1, 0.15); ctx.fillRect(HX - 26, 90, 4, 26); ctx.fillRect(HX + 22, 90, 4, 26);
  } else if (p.base === 'shinaibukuro') {
    // 竹刀袋：背中にななめにしょう（右の肩の上と、左の足もとに見える）
    ctx.save();
    ctx.translate(HX + 4, 112); ctx.rotate(0.62);
    rr(ctx, -4, -72, 8, 128, 3.6); fs(ctx, p.c1, dark(p.c1, 0.4), 1);
    ctx.strokeStyle = p.c2 || '#c9a64a'; ctx.lineWidth = 1.4;
    for (const y of [-64, -60]) { ctx.beginPath(); ctx.moveTo(-4, y); ctx.lineTo(4, y + 1); ctx.stroke(); }
    ctx.fillStyle = light(p.c1, 0.2); ctx.fillRect(-1, -68, 2, 118);
    ctx.restore();
  }
}
function itemFront(ctx, p) {
  const c1 = p.c1, c2 = p.c2 || '#ffffff';
  ctx.save();
  if (p.base === 'fudebako') {
    ctx.translate(HX + 27, 116); ctx.rotate(-0.18);
    rr(ctx, -4, -5, 24, 10, 3); fs(ctx, c1);
    ctx.strokeStyle = c2; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-2, -1); ctx.lineTo(18, -1); ctx.stroke();
    ctx.fillStyle = '#e8c45a'; ctx.fillRect(14, -9, 2.4, 6); ctx.fillStyle = '#f0a99a'; ctx.fillRect(14, -10.5, 2.4, 1.6);
    ell(ctx, 0, 0, 4.4, 4.6); fs(ctx, null, null);
  } else if (p.base === 'randoseru') {
    for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(HX + sg * 15, 82); ctx.lineTo(HX + sg * 17, 112); ctx.lineTo(HX + sg * 13, 112); ctx.lineTo(HX + sg * 11, 83); ctx.closePath(); fs(ctx, dark(c1, 0.12)); }
    for (const sg of [-1, 1]) { rr(ctx, HX + sg * 15 - 2.4, 104, 4.8, 4, 1); fs(ctx, c2, dark(c2), 0.6); }
  } else if (p.base === 'shinai') {
    ctx.translate(HX + 27, 119); ctx.rotate(-0.5);
    rr(ctx, -2.2, -78, 4.4, 70, 2); fs(ctx, c1, dark(c1, 0.3), 0.8);
    ctx.strokeStyle = dark(c1, 0.35); ctx.lineWidth = 0.6;
    for (const y of [-66, -50, -34, -20]) { ctx.beginPath(); ctx.moveTo(-2.2, y); ctx.lineTo(2.2, y); ctx.stroke(); }
    ctx.fillStyle = '#f2efe6'; ctx.fillRect(-2.4, -8, 4.8, 14);
    ell(ctx, 0, -9, 5, 1.6); fs(ctx, c2);
    ctx.strokeStyle = '#3a2f28'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(0, -78); ctx.lineTo(0, -8); ctx.stroke();
  } else if (p.base === 'kingyo') {
    // 金魚の袋：左手にぶら下げる
    ctx.strokeStyle = '#d8d2c2'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(HX - 27, 120); ctx.lineTo(HX - 29, 129); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(HX - 32, 128); ctx.quadraticCurveTo(HX - 40, 136, HX - 38, 145); ctx.quadraticCurveTo(HX - 29, 152, HX - 20, 145); ctx.quadraticCurveTo(HX - 18, 136, HX - 26, 128); ctx.closePath();
    ctx.fillStyle = `${c2}aa`; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ell(ctx, HX - 34, 138, 1.4, 4, 0.3); ctx.fill();
    // 金魚
    ell(ctx, HX - 28.5, 141, 3.6, 2.4, -0.2); fs(ctx, c1, dark(c1, 0.3), 0.5);
    poly(ctx, [HX - 25.6, 140, HX - 22.4, 137.6, HX - 22.8, 143]); fs(ctx, c1, dark(c1, 0.3), 0.5);
    ell(ctx, HX - 30.6, 140.4, 0.5, 0.5); ctx.fillStyle = INK; ctx.fill();
    ctx.fillStyle = '#c94f3d'; ctx.fillRect(HX - 32, 126.6, 6, 2);
  } else if (p.base === 'whistle') {
    // ホイッスル：首からひもで下げる
    ctx.strokeStyle = c2; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(HX - 8, 83); ctx.lineTo(HX - 1, 103); ctx.moveTo(HX + 8, 83); ctx.lineTo(HX + 1, 103); ctx.stroke();
    rr(ctx, HX - 4.5, 102, 9, 6, 2.6); fs(ctx, c1, dark(c1, 0.4), 0.8);
    rr(ctx, HX + 3, 103, 5, 3, 0.8); fs(ctx, c1, dark(c1, 0.4), 0.8);
    ell(ctx, HX - 1.2, 105, 1.4, 1.4); ctx.fillStyle = dark(c1, 0.5); ctx.fill();
  } else if (p.base === 'recorder') {
    // リコーダー：右手で持つ
    ctx.translate(HX + 27, 119); ctx.rotate(-0.42);
    rr(ctx, -2.3, -50, 4.6, 54, 2); fs(ctx, c1, dark(c1, 0.3), 0.8);
    rr(ctx, -2.7, -52, 5.4, 7, 1.5); fs(ctx, c2, dark(c2, 0.3), 0.6);
    ctx.fillStyle = c2; ctx.fillRect(-2.6, -22, 5.2, 1.4);
    for (const y of [-40, -35, -30, -16, -11, -6]) { ell(ctx, 0, y, 1, 1); ctx.fillStyle = dark(c2, 0.2); ctx.fill(); }
    ell(ctx, 0, 4, 3.4, 1.6); fs(ctx, c1, dark(c1, 0.3), 0.8);
  } else if (p.base === 'stopwatch') {
    // ストップウォッチ：右手に
    ctx.strokeStyle = c2; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(HX + 27, 116); ctx.quadraticCurveTo(HX + 34, 110, HX + 32, 104); ctx.stroke();
    ell(ctx, HX + 31, 112, 7, 7); fs(ctx, c1, dark(c1, 0.4), 1);
    ell(ctx, HX + 31, 112, 5, 5); fs(ctx, '#ffffff', dark(c1, 0.3), 0.6);
    rr(ctx, HX + 29.5, 102.6, 3, 2.6, 0.6); fs(ctx, c1, dark(c1, 0.4), 0.6);
    ctx.strokeStyle = '#c83a2f'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(HX + 31, 112); ctx.lineTo(HX + 33.4, 108.6); ctx.stroke();
    ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(HX + 31, 112); ctx.lineTo(HX + 31, 115.4); ctx.stroke();
  } else if (p.base === 'racket') {
    // 卓球のラケット：右手に
    ctx.translate(HX + 27, 119); ctx.rotate(0.35);
    rr(ctx, -1.8, -12, 3.6, 13, 1.2); fs(ctx, c2, dark(c2, 0.35), 0.8);
    ell(ctx, 0, -20, 8.6, 9.6); fs(ctx, c1, dark(c1, 0.4), 1);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ell(ctx, -2.6, -23, 3, 3.4, -0.4); ctx.fill();
  } else if (p.base === 'bunko') {
    // 文庫本：左手に
    ctx.translate(HX - 30, 112); ctx.rotate(0.18);
    rr(ctx, -6.5, -9, 13, 18, 1); fs(ctx, c1, dark(c1, 0.35), 0.9);
    ctx.fillStyle = dark(c1, 0.2); ctx.fillRect(-6.5, -9, 2.2, 18);
    ctx.fillStyle = c2; ctx.fillRect(-1, -6, 5.6, 1.2); ctx.fillRect(-1, -3.6, 4, 1.2);
    ctx.strokeStyle = c2; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(2, 9); ctx.quadraticCurveTo(3.2, 13, 1.4, 16); ctx.stroke();
  } else if (p.base === 'compass') {
    // コンパス：右手のそば
    ctx.translate(HX + 31, 100);
    ctx.strokeStyle = c1; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-6, 26); ctx.moveTo(0, 0); ctx.lineTo(6, 26); ctx.stroke();
    ctx.strokeStyle = dark(c1, 0.45); ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-6, 26); ctx.moveTo(0, 0); ctx.lineTo(6, 26); ctx.stroke();
    ctx.fillStyle = '#3a3430'; ctx.fillRect(5.2, 22, 1.6, 5);
    rr(ctx, -2, -7, 4, 7, 1.4); fs(ctx, c2, dark(c2, 0.3), 0.6);
    ell(ctx, 0, 0.6, 2.2, 2.2); fs(ctx, c1, dark(c1, 0.4), 0.6);
  } else if (p.base === 'sensu') {
    // 扇子：右手で開いて持つ
    const cx = HX + 27, cy = 120, R = 24, a0 = -1.95, a1 = -0.62;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath(); fs(ctx, c1, dark(c1, 0.35), 0.9);
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.42, a0, a1); ctx.lineTo(cx, cy); ctx.closePath(); fs(ctx, c2, dark(c2, 0.3), 0.6);
    ctx.strokeStyle = dark(c1, 0.25); ctx.lineWidth = 0.5;
    for (let k = 1; k < 9; k++) { const a = a0 + (a1 - a0) * (k / 9); ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.42, cy + Math.sin(a) * R * 0.42); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke(); }
    ctx.strokeStyle = '#7c2f33'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, R * 0.72, -1.55, -1.1); ctx.stroke();
  } else if (p.base === 'camera') {
    // 首から下げたカメラ
    ctx.strokeStyle = c2; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(HX - 10, 83); ctx.lineTo(HX - 9, 104); ctx.moveTo(HX + 10, 83); ctx.lineTo(HX + 9, 104); ctx.stroke();
    rr(ctx, HX - 11, 101, 22, 14, 2.4); fs(ctx, c1, dark(c1, 0.5), 1);
    rr(ctx, HX - 8, 98.6, 6, 3, 0.8); fs(ctx, c1, dark(c1, 0.5), 0.6);
    ell(ctx, HX + 1, 108, 5, 5); fs(ctx, '#55606e', '#1a1c22', 1);
    ell(ctx, HX + 1, 108, 2.6, 2.6); fs(ctx, '#2a3340', null);
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ell(ctx, HX - 0.2, 106.8, 0.9, 0.9); ctx.fill();
    ell(ctx, HX + 8, 104, 1, 1); ctx.fillStyle = c2; ctx.fill();
  } else if (p.base === 'ball') {
    // サッカーボール：足もと
    const bx = HX + 27, by = 159, r = 9;
    ell(ctx, bx, by, r, r); fs(ctx, c1, '#3a3a40', 1);
    const pent = (x, y, rr2, rot) => { ctx.beginPath(); for (let k = 0; k < 5; k++) { const a = rot + k * Math.PI * 2 / 5; ctx.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); } ctx.closePath(); ctx.fillStyle = c2; ctx.fill(); };
    pent(bx, by, 3.4, -Math.PI / 2);
    ctx.save(); ell(ctx, bx, by, r - 0.4, r - 0.4); ctx.clip();
    for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + Math.PI / 5 + k * Math.PI * 2 / 5; pent(bx + Math.cos(a) * 8.6, by + Math.sin(a) * 8.6, 3, a); }
    ctx.restore();
  } else if (p.base === 'shinaibukuro') {
    // 竹刀袋：肩にかけるひも
    ctx.strokeStyle = p.c2 || '#c9a64a'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(HX + 14, 83); ctx.lineTo(HX - 12, 122); ctx.stroke();
  } else if (p.base === 'shusseki') {
    // 出席簿：左のわきにかかえる
    ctx.translate(HX - 30, 108); ctx.rotate(0.12);
    rr(ctx, -8, -12, 16, 23, 1.2); fs(ctx, c1, dark(c1, 0.4), 1);
    rr(ctx, -4.5, -9, 9, 13, 0.6); fs(ctx, c2, dark(c2, 0.3), 0.5);
    ctx.fillStyle = INK; ctx.font = '700 3.6px "BIZ UDPGothic", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [k, ch] of ['出', '席', '簿'].entries()) ctx.fillText(ch, 0, -6 + k * 3.8);
    ctx.fillStyle = dark(c1, 0.25); ctx.fillRect(-8, -12, 2, 23);
  } else if (p.base === 'sankaku') {
    ctx.translate(HX - 34, 104); ctx.rotate(0.12);
    ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(0, 24); ctx.lineTo(26, 24); ctx.closePath();
    ctx.fillStyle = `${c1}cc`; ctx.fill(); ctx.strokeStyle = dark(c1, 0.35); ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(5, 19); ctx.lineTo(14, 19); ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill(); ctx.stroke();
    ctx.strokeStyle = dark(c1, 0.5); ctx.lineWidth = 0.5;
    for (let y = -26; y < 24; y += 3) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(y % 15 === 1 ? 3 : 1.8, y); ctx.stroke(); }
  }
  ctx.restore();
}

// ================= 頭・顔の飾り =================
function drawFaceAcc(ctx, p) {
  const c1 = p.c1;
  ctx.save();
  if (p.base === 'glasses') {
    ctx.strokeStyle = c1; ctx.lineWidth = 1.4;
    for (const x of [HX - 12, HX + 12]) { ctx.beginPath(); ctx.arc(x, HY + 7, 6.6, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(HX - 5.4, HY + 6); ctx.quadraticCurveTo(HX, HY + 3.5, HX + 5.4, HY + 6); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ell(ctx, HX - 14, HY + 4.5, 2, 1.2, -0.5); ctx.fill(); ell(ctx, HX + 10, HY + 4.5, 2, 1.2, -0.5); ctx.fill();
  } else if (p.base === 'bandage') {
    ctx.translate(HX + 18, HY + 16); ctx.rotate(-0.5);
    rr(ctx, -6, -2.4, 12, 4.8, 2); fs(ctx, c1, dark(c1, 0.25), 0.7);
    ctx.fillStyle = dark(c1, 0.15); ctx.fillRect(-2, -1.6, 4, 3.2);
  } else if (p.base === 'sumi') {
    ctx.strokeStyle = c1; ctx.lineCap = 'round'; ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(HX - 24, HY + 14); ctx.quadraticCurveTo(HX - 18, HY + 12, HX - 13, HY + 17); ctx.stroke();
    ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(HX - 22, HY + 19); ctx.lineTo(HX - 16, HY + 20); ctx.stroke();
    ell(ctx, HX - 26, HY + 18, 1, 1); ctx.fillStyle = c1; ctx.fill();
  } else if (p.base === 'bandagex') {
    // ばってんのばんそうこう（ほっぺ）
    for (const rot of [-0.6, 0.6]) {
      ctx.save(); ctx.translate(HX + 18, HY + 15); ctx.rotate(rot);
      rr(ctx, -6.4, -2.4, 12.8, 4.8, 2); fs(ctx, c1, dark(c1, 0.25), 0.7);
      ctx.fillStyle = dark(c1, 0.12); ctx.fillRect(-2, -1.6, 4, 3.2);
      ctx.restore();
    }
  } else if (p.base === 'marumegane') {
    // 丸メガネ：大きな丸いレンズ、細い金のふち
    ctx.fillStyle = 'rgba(200,225,240,.18)';
    for (const x of [HX - 12.5, HX + 12.5]) { ell(ctx, x, HY + 7, 8.4, 8.4); ctx.fill(); }
    ctx.strokeStyle = c1; ctx.lineWidth = 1.1;
    for (const x of [HX - 12.5, HX + 12.5]) { ctx.beginPath(); ctx.arc(x, HY + 7, 8.4, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(HX - 4.2, HY + 6); ctx.quadraticCurveTo(HX, HY + 3, HX + 4.2, HY + 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(HX - 20.8, HY + 5); ctx.lineTo(HX - 31, HY + 4); ctx.moveTo(HX + 20.8, HY + 5); ctx.lineTo(HX + 31, HY + 4); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ell(ctx, HX - 15, HY + 3.4, 2.2, 1.2, -0.6); ctx.fill(); ell(ctx, HX + 10, HY + 3.4, 2.2, 1.2, -0.6); ctx.fill();
  } else if (p.base === 'mask') {
    ctx.beginPath(); ctx.moveTo(HX - 15, HY + 10); ctx.quadraticCurveTo(HX, HY + 6, HX + 15, HY + 10); ctx.lineTo(HX + 13, HY + 24); ctx.quadraticCurveTo(HX, HY + 29, HX - 13, HY + 24); ctx.closePath();
    fs(ctx, c1, dark(c1, 0.22), 0.8);
    ctx.strokeStyle = dark(c1, 0.15); ctx.lineWidth = 0.6;
    for (const y of [15, 19]) { ctx.beginPath(); ctx.moveTo(HX - 13, HY + y); ctx.quadraticCurveTo(HX, HY + y - 2, HX + 13, HY + y); ctx.stroke(); }
    ctx.strokeStyle = '#efece4'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(HX - 15, HY + 11); ctx.lineTo(HX - 31, HY + 6); ctx.moveTo(HX + 15, HY + 11); ctx.lineTo(HX + 31, HY + 6); ctx.stroke();
  }
  ctx.restore();
}
function drawHeadAcc(ctx, p) {
  const c1 = p.c1, c2 = p.c2 || '#ffffff';
  ctx.save();
  if (p.base === 'hachimaki') {
    // 後ろに流れるはし
    ctx.beginPath(); ctx.moveTo(HX + 32, HY - 12); ctx.quadraticCurveTo(HX + 46, HY - 10, HX + 52, HY + 4); ctx.lineTo(HX + 46, HY + 2); ctx.quadraticCurveTo(HX + 42, HY - 6, HX + 32, HY - 6); ctx.closePath(); fs(ctx, c1);
    ctx.beginPath(); ctx.moveTo(HX + 32, HY - 10); ctx.quadraticCurveTo(HX + 50, HY - 16, HX + 58, HY - 8); ctx.lineTo(HX + 52, HY - 6); ctx.quadraticCurveTo(HX + 44, HY - 10, HX + 32, HY - 6); ctx.closePath(); fs(ctx, c1);
    ctx.beginPath(); ctx.moveTo(HX - 35, HY - 8); ctx.quadraticCurveTo(HX, HY - 22, HX + 35, HY - 8); ctx.lineTo(HX + 35, HY - 1); ctx.quadraticCurveTo(HX, HY - 15, HX - 35, HY - 1); ctx.closePath(); fs(ctx, c1);
    ell(ctx, HX, HY - 11.5, 3.6, 3.2); fs(ctx, c2, null);
  } else if (p.base === 'gakubou') {
    ctx.beginPath(); ctx.moveTo(HX - 34, HY - 10); ctx.bezierCurveTo(HX - 36, HY - 40, HX + 36, HY - 40, HX + 34, HY - 10); ctx.closePath(); fs(ctx, c1);
    ctx.fillStyle = dark(c1, 0.25); ctx.fillRect(HX - 34, HY - 14, 68, 5);
    ctx.beginPath(); ctx.moveTo(HX - 26, HY - 10); ctx.quadraticCurveTo(HX, HY, HX + 26, HY - 10); ctx.quadraticCurveTo(HX, HY - 4, HX - 26, HY - 10); ctx.closePath(); fs(ctx, '#1a1a20');
    ell(ctx, HX, HY - 22, 3.4, 3.4); fs(ctx, c2, dark(c2), 0.6);
  } else if (p.base === 'kitsune') {
    ctx.translate(HX + 24, HY - 22); ctx.rotate(0.45);
    poly(ctx, [-10, -6, -8, -16, -3, -8]); fs(ctx, c1); poly(ctx, [10, -6, 8, -16, 3, -8]); fs(ctx, c1);
    ctx.beginPath(); ctx.moveTo(-11, -6); ctx.quadraticCurveTo(0, -11, 11, -6); ctx.quadraticCurveTo(12, 6, 0, 14); ctx.quadraticCurveTo(-12, 6, -11, -6); ctx.closePath(); fs(ctx, c1, dark(c1, 0.3), 1);
    ctx.strokeStyle = c2; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-7, -1); ctx.lineTo(-2.5, 1); ctx.moveTo(7, -1); ctx.lineTo(2.5, 1); ctx.stroke();
    ctx.fillStyle = c2; ell(ctx, 0, -6, 1.2, 2.4); ctx.fill(); ell(ctx, 0, 11, 1.4, 1); ctx.fillStyle = INK; ctx.fill();
  } else if (p.base === 'kyushoku') {
    // 給食帽：ふんわりした白い帽子
    ctx.beginPath(); ctx.moveTo(HX - 36, HY - 4); ctx.bezierCurveTo(HX - 44, HY - 50, HX + 44, HY - 50, HX + 36, HY - 4);
    ctx.quadraticCurveTo(HX, HY - 12, HX - 36, HY - 4); ctx.closePath(); fs(ctx, c1, dark(c1, 0.25), 1.1);
    ctx.strokeStyle = dark(c1, 0.12); ctx.lineWidth = 0.8;
    for (const x of [-20, -6, 8, 22]) { ctx.beginPath(); ctx.moveTo(HX + x, HY - 34 + Math.abs(x) * 0.3); ctx.quadraticCurveTo(HX + x * 1.1, HY - 20, HX + x * 1.15, HY - 9); ctx.stroke(); }
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(HX - 35, HY - 8); ctx.quadraticCurveTo(HX, HY - 17, HX + 35, HY - 8); ctx.stroke();
  } else if (p.base === 'gabyo') {
    // 画びょうの髪留め（2つ）
    for (const [x, y, r] of [[HX + 20, HY - 22, 4.2], [HX + 28, HY - 12, 3.4]]) {
      ell(ctx, x + 0.8, y + 1, r, r); ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fill();
      ell(ctx, x, y, r, r); fs(ctx, c1, dark(c1, 0.35), 0.8);
      ell(ctx, x, y, r * 0.45, r * 0.45); fs(ctx, light(c1, 0.25), null);
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ell(ctx, x - r * 0.35, y - r * 0.35, r * 0.25, r * 0.18, -0.6); ctx.fill();
    }
  } else if (p.base === 'akashiro') {
    // 赤白帽（赤の面）
    ctx.beginPath(); ctx.moveTo(HX - 35, HY - 6); ctx.bezierCurveTo(HX - 38, HY - 44, HX + 38, HY - 44, HX + 35, HY - 6); ctx.closePath(); fs(ctx, c1, dark(c1, 0.35), 1.1);
    ctx.strokeStyle = c2; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(HX - 35, HY - 7); ctx.lineTo(HX + 35, HY - 7); ctx.stroke();
    ctx.strokeStyle = dark(c1, 0.25); ctx.lineWidth = 0.7;
    for (const x of [-14, 0, 14]) { ctx.beginPath(); ctx.moveTo(HX + x * 0.2, HY - 35); ctx.quadraticCurveTo(HX + x * 1.2, HY - 26, HX + x * 1.7, HY - 8); ctx.stroke(); }
    ell(ctx, HX, HY - 35, 2, 1.4); fs(ctx, c1, dark(c1, 0.35), 0.6);
    // あごのゴム
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(HX - 33, HY - 4); ctx.quadraticCurveTo(HX - 30, HY + 28, HX, HY + 31); ctx.quadraticCurveTo(HX + 30, HY + 28, HX + 33, HY - 4); ctx.stroke();
  } else if (p.base === 'headphone') {
    ctx.strokeStyle = c1; ctx.lineWidth = 4.2; ctx.beginPath(); ctx.moveTo(HX - 35, HY + 2); ctx.bezierCurveTo(HX - 40, HY - 46, HX + 40, HY - 46, HX + 35, HY + 2); ctx.stroke();
    ctx.strokeStyle = light(c1, 0.3); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(HX - 30, HY - 18); ctx.bezierCurveTo(HX - 30, HY - 38, HX + 30, HY - 38, HX + 30, HY - 18); ctx.stroke();
    for (const sg of [-1, 1]) { rr(ctx, HX + sg * 35 - 5, HY - 2, 10, 15, 4); fs(ctx, c1, dark(c1, 0.4), 1); rr(ctx, HX + sg * 35 - (sg < 0 ? -2 : 5), HY, 3, 11, 1.4); fs(ctx, c2, null); }
  } else if (p.base === 'sankakukin') {
    // 三角巾：頭をおおって、後ろで結ぶ
    ctx.beginPath(); ctx.moveTo(HX - 36, HY - 5); ctx.bezierCurveTo(HX - 40, HY - 44, HX + 40, HY - 44, HX + 36, HY - 5); ctx.quadraticCurveTo(HX, HY - 13, HX - 36, HY - 5); ctx.closePath();
    fs(ctx, c1, dark(c1, 0.25), 1);
    ctx.save(); ctx.clip(); ctx.strokeStyle = c2; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.7;
    for (let y = HY - 38; y < HY; y += 5) { ctx.beginPath(); ctx.moveTo(HX - 40, y); ctx.lineTo(HX + 40, y); ctx.stroke(); }
    ctx.restore();
    poly(ctx, [HX + 34, HY - 12, HX + 46, HY - 18, HX + 43, HY - 8]); fs(ctx, c1, dark(c1, 0.25), 0.8);
    poly(ctx, [HX + 34, HY - 10, HX + 44, HY - 2, HX + 38, HY]); fs(ctx, c1, dark(c1, 0.25), 0.8);
  } else if (p.base === 'enpitsu') {
    // 耳にはさんだ鉛筆
    ctx.translate(HX + 34, HY + 1); ctx.rotate(-0.42);
    rr(ctx, -13, -1.8, 22, 3.6, 0.6); fs(ctx, c1, dark(c1, 0.35), 0.7);
    ctx.fillStyle = dark(c1, 0.12); ctx.fillRect(-13, -0.4, 22, 0.8);
    poly(ctx, [9, -1.8, 14, 0, 9, 1.8]); fs(ctx, '#e8cfa6', '#a58a62', 0.6);
    poly(ctx, [12.4, -0.6, 14, 0, 12.4, 0.6]); fs(ctx, '#3a3430', null);
    rr(ctx, -16.4, -1.9, 3.6, 3.8, 0.8); fs(ctx, c2, dark(c2, 0.3), 0.6);
  } else if (p.base === 'hoshipin') {
    // 星のヘアピン
    const star5 = (x, y, r) => { ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr2 = k % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); } ctx.closePath(); };
    ctx.strokeStyle = '#b9bec6'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(HX - 30, HY - 10); ctx.lineTo(HX - 14, HY - 22); ctx.stroke();
    star5(HX - 20, HY - 18, 6); fs(ctx, c1, dark(c1, 0.35), 0.8);
    star5(HX - 29, HY - 8, 3.2); fs(ctx, light(c1, 0.2), dark(c1, 0.35), 0.6);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ell(ctx, HX - 21.6, HY - 19.6, 1.2, 0.8, -0.5); ctx.fill();
  } else if (p.base === 'oendan') {
    // 応援団のはちまき：長いはしをなびかせて、正面に「必勝」
    ctx.beginPath(); ctx.moveTo(HX + 31, HY - 12); ctx.bezierCurveTo(HX + 50, HY - 14, HX + 54, HY + 10, HX + 50, HY + 40); ctx.lineTo(HX + 44, HY + 38); ctx.bezierCurveTo(HX + 47, HY + 12, HX + 44, HY - 4, HX + 31, HY - 6); ctx.closePath(); fs(ctx, c1, dark(c1, 0.25), 1);
    ctx.beginPath(); ctx.moveTo(HX + 32, HY - 10); ctx.bezierCurveTo(HX + 56, HY - 22, HX + 62, HY, HX + 58, HY + 26); ctx.lineTo(HX + 53, HY + 22); ctx.bezierCurveTo(HX + 55, HY + 2, HX + 48, HY - 10, HX + 32, HY - 5); ctx.closePath(); fs(ctx, c1, dark(c1, 0.25), 1);
    ctx.beginPath(); ctx.moveTo(HX - 35, HY - 9); ctx.quadraticCurveTo(HX, HY - 23, HX + 35, HY - 9); ctx.lineTo(HX + 35, HY - 1); ctx.quadraticCurveTo(HX, HY - 15, HX - 35, HY - 1); ctx.closePath(); fs(ctx, c1, dark(c1, 0.25), 1);
    ctx.fillStyle = c2; ctx.font = '700 7px "Yuji Boku", "Noto Serif CJK JP", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('必勝', HX, HY - 11);
  } else if (p.base === 'beret') {
    ctx.save(); ctx.translate(HX + 4, HY - 24); ctx.rotate(-0.14);
    ell(ctx, 0, 0, 37, 14); fs(ctx, c1, dark(c1, 0.35), 1.1);
    ctx.fillStyle = light(c1, 0.12); ell(ctx, -6, -3, 24, 7); ctx.fill();
    rr(ctx, -1.6, -17, 3.2, 5, 1.4); fs(ctx, c1, dark(c1, 0.35), 0.8);
    ctx.restore();
  } else if (p.base === 'kanzashi') {
    // 和柄の髪かざり：花と、下がる飾り
    ctx.strokeStyle = p.c2 || '#e9c46a'; ctx.lineWidth = 0.8;
    for (const dx of [2, 7]) { ctx.beginPath(); ctx.moveTo(HX + 26 + dx * 0.3, HY - 14); ctx.lineTo(HX + 26 + dx, HY + 2); ctx.stroke(); ell(ctx, HX + 26 + dx, HY + 3.4, 1.4, 1.4); fs(ctx, c1, null); }
    for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * Math.PI * 2 / 5; ell(ctx, HX + 25 + Math.cos(a) * 4.4, HY - 19 + Math.sin(a) * 4.4, 3.4, 3.4); fs(ctx, c1, dark(c1, 0.3), 0.7); }
    ell(ctx, HX + 25, HY - 19, 2.2, 2.2); fs(ctx, c2, dark(c2, 0.3), 0.6);
  } else if (p.base === 'mugiwara') {
    ell(ctx, HX, HY - 18, 50, 11); fs(ctx, c1);
    ctx.beginPath(); ctx.moveTo(HX - 26, HY - 18); ctx.bezierCurveTo(HX - 26, HY - 46, HX + 26, HY - 46, HX + 26, HY - 18); ctx.closePath(); fs(ctx, c1);
    ctx.fillStyle = c2; ctx.fillRect(HX - 26, HY - 25, 52, 6);
    ctx.strokeStyle = dark(c1, 0.25); ctx.lineWidth = 0.5;
    for (let a = 0; a < Math.PI * 2; a += 0.35) { ctx.beginPath(); ctx.moveTo(HX + Math.cos(a) * 30, HY - 18 + Math.sin(a) * 6.6); ctx.lineTo(HX + Math.cos(a) * 48, HY - 18 + Math.sin(a) * 10.5); ctx.stroke(); }
  }
  ctx.restore();
}

// ================= ぜんぶ =================
// av：{ skin, hair, hairColor, eyes, outfit, jacket, head, face, item, bg }
// opt：x, y, w, h（描く場所）、view（full / bust / face）、bg（背景を描くか）
export function drawAvatar(ctx, av, { x = 0, y = 0, w = 120, h = 184, view = 'full', bg = true, align = 'bottom' } = {}) {
  const v = VIEWS[view] || VIEWS.full;
  const k = Math.min(w / v.w, h / v.h);
  const ox = x + (w - v.w * k) / 2, oy = y + (align === 'center' ? (h - v.h * k) / 2 : h - v.h * k);
  const skin = pick(av, 'skin')?.c1 || '#eecaa8';
  const hairP = pick(av, 'hair'), hairCol = pick(av, 'hairColor')?.c1 || '#26252b';
  const outfit = pick(av, 'outfit'), jacket = pick(av, 'jacket'), head = pick(av, 'head'), face = pick(av, 'face'), item = pick(av, 'item'), bgP = pick(av, 'bg');
  ctx.save();
  ctx.beginPath(); ctx.rect(ox, oy, v.w * k, v.h * k); ctx.clip();
  ctx.translate(ox, oy); ctx.scale(k, k); ctx.translate(-v.x, -v.y);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (bg && bgP) drawBg(ctx, bgP);
  // 足もとの影
  ctx.fillStyle = 'rgba(30,20,20,.18)'; ell(ctx, HX, 170, 26, 4); ctx.fill();
  if (hairP) hairBack(ctx, hairP, hairCol);
  if (item) itemBack(ctx, item);
  if (jacket) jacketBack(ctx, jacket);
  const coat = isCoat(jacket) ? jacket : null;
  if (outfit) drawOutfit(ctx, outfit, skin, coat);
  else { legs(ctx, skin); torsoPath(ctx); fs(ctx, '#d8d2c2'); if (!coat) arms(ctx, skin, '#d8d2c2'); }
  if (jacket && jacket.base !== 'muffler') drawJacket(ctx, jacket, skin);
  if (item) itemFront(ctx, item);
  // 首と頭
  rr(ctx, HX - 6, 72, 12, 12, 3); fs(ctx, dark(skin, 0.06), dark(skin, 0.3), 1);
  if (jacket?.base === 'muffler') drawMuffler(ctx, jacket);
  for (const sg of [-1, 1]) { ell(ctx, HX + sg * 32, HY + 8, 5, 6.5); fs(ctx, skin, dark(skin, 0.3), 1.1); }
  ell(ctx, HX, HY + 2, RX, RY); fs(ctx, skin, dark(skin, 0.3), 1.3);
  // ほお
  ctx.fillStyle = 'rgba(226,120,110,.28)'; ell(ctx, HX - 20, HY + 16, 5, 3); ctx.fill(); ell(ctx, HX + 20, HY + 16, 5, 3); ctx.fill();
  const eyes = pick(av, 'eyes');
  if (eyes) drawEyes(ctx, eyes);
  drawMouth(ctx, eyes?.base);
  if (face) drawFaceAcc(ctx, face);
  if (hairP) hairFront(ctx, hairP, hairCol);
  if (head) drawHeadAcc(ctx, head);
  ctx.restore();
}

// 背景だけを、決めた四角いっぱいに描く（はみ出す分は切る）。背景が「なし」なら false
export function drawAvatarBg(ctx, av, { x, y, w, h }) {
  const p = pick(av, 'bg');
  if (!p) return false;
  const k = Math.max(w / W, h / H);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.translate(x + (w - W * k) / 2, y - 4 * k); ctx.scale(k, k);
  drawBg(ctx, p);
  ctx.restore();
  return true;
}

// 画像（data URL）にして使い回す。HTML の <img> で使う
const cache = new Map();
export function avatarImage(av, { view = 'face', size = 64, bg = false, ratio = null } = {}) {
  const v = VIEWS[view] || VIEWS.full;
  const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 2);
  const w = size, h = Math.round(size * (ratio ?? v.h / v.w));
  const key = `${avatarKey(av)}|${view}|${w}x${h}|${bg}|${dpr}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  drawAvatar(ctx, av, { x: 0, y: 0, w, h, view, bg, align: view === 'face' ? 'center' : 'bottom' });
  const url = c.toDataURL('image/png');
  if (cache.size > 300) cache.clear();
  cache.set(key, url);
  return url;
}
