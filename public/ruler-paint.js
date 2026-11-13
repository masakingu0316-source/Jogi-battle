// 定規1本を描く（盤面と、定規ケースのプレビューで共用）
// 座標は cm。px は 1cm あたりの画面ピクセル数（目盛りや文字の出し分けに使う）
// 形（まっすぐ・三角定規・分度器）× 素材（アクリル・メタル・ラバー）、レベルに応じたオーラ
import Physics from './shared/physics.js';
import { PLAYERS } from './shared/rules.js';
import { MATERIAL_INFO } from './shared/catalog.js';

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- 形の下ごしらえ（形ごとに1回だけ計算） ----
// 描くときは、形を定義したときの座標（三角定規なら直角の角が原点）で描く
const geoCache = new Map();
function geometry(shapeKey) {
  if (geoCache.has(shapeKey)) return geoCache.get(shapeKey);
  const sh = Physics.SHAPES[shapeKey] || Physics.SHAPES.straight30;
  const off = sh.offset;
  let outer = sh.verts.map((p) => ({ x: p.x + off.x, y: p.y + off.y }));
  let normals = sh.normals;
  // へこんだ形（部品の組み合わせ）：雲形定規は部品をつないだ外形、はさみ・磁石は部品ごとに描く
  let multi = null;
  if (sh.parts) {
    const parts = sh.parts.map((q) => q.verts.map((p) => ({ x: p.x + off.x, y: p.y + off.y })));
    if (sh.kind === 'cloud') {
      outer = unionOutline(sh.parts, off);
      normals = outer.map((p, i) => {
        const q = outer[(i + 1) % outer.length];
        const ex = q.x - p.x, ey = q.y - p.y, l = Math.hypot(ex, ey) || 1;
        return outer.cw ? { x: -ey / l, y: ex / l } : { x: ey / l, y: -ex / l };
      });
    } else multi = parts;
  }
  const hole = sh.hole ? insetPolygon(outer, normals, sh.hole) : null;
  const xs = outer.map((p) => p.x), ys = outer.map((p) => p.y);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  // 周の長さ（オーラの粒を周に沿って置く）
  const lens = outer.map((p, i) => Math.hypot(outer[(i + 1) % outer.length].x - p.x, outer[(i + 1) % outer.length].y - p.y));
  const perim = lens.reduce((a, b) => a + b, 0);
  const g = { sh, off, outer, normals, hole, box, lens, perim, multi, outset: new Map() };
  geoCache.set(shapeKey, g);
  return g;
}
// 部品（凸多角形）を合わせた外形を、細かいマス目でなぞって1本の線にする（形ごとに1回だけ）
function unionOutline(parts, off) {
  const step = 0.12;
  const inPart = (q, x, y) => q.verts.every((v, i) => q.normals[i].x * (x - v.x) + q.normals[i].y * (y - v.y) <= 0);
  const inside = (x, y) => parts.some((q) => inPart(q, x, y));
  const all = parts.flatMap((q) => q.verts);
  const x0 = Math.min(...all.map((p) => p.x)) - step * 2, y0 = Math.min(...all.map((p) => p.y)) - step * 2;
  const nx = Math.ceil((Math.max(...all.map((p) => p.x)) - x0) / step) + 3, ny = Math.ceil((Math.max(...all.map((p) => p.y)) - y0) / step) + 3;
  const grid = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) grid[j * nx + i] = inside(x0 + i * step, y0 + j * step) ? 1 : 0;
  const at = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny ? grid[j * nx + i] : 0);
  // 左上から最初の中のマス → 外周をたどる（ムーア近傍）
  let si = -1, sj = -1;
  for (let j = 0; j < ny && si < 0; j++) for (let i = 0; i < nx; i++) if (grid[j * nx + i]) { si = i; sj = j; break; }
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const pts = [];
  let ci = si, cj = sj, d = 6;
  for (let guard = 0; guard < nx * ny; guard++) {
    pts.push({ x: x0 + ci * step + off.x, y: y0 + cj * step + off.y });
    let found = false;
    for (let k = 0; k < 8; k++) {
      const dd = (d + 6 + k) % 8;
      const ni = ci + dirs[dd][0], nj = cj + dirs[dd][1];
      if (at(ni, nj)) { ci = ni; cj = nj; d = dd; found = true; break; }
    }
    if (!found || (ci === si && cj === sj)) break;
  }
  // なめらかにして、点を減らす
  const sm = pts.map((_, i) => {
    let sx = 0, sy = 0;
    for (let k = -3; k <= 3; k++) { const q = pts[(i + k + pts.length) % pts.length]; sx += q.x; sy += q.y; }
    return { x: sx / 7, y: sy / 7 };
  });
  const out = sm.filter((_, i) => i % 3 === 0);
  let area = 0;
  for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length]; area += a.x * b.y - b.x * a.y; }
  out.cw = area < 0;
  return out;
}
// 各辺を内側に d だけずらした多角形（凸多角形なので、となりの辺どうしの交点を取ればよい）
function insetPolygon(v, n, d) {
  const out = [];
  for (let i = 0; i < v.length; i++) {
    const j = (i - 1 + v.length) % v.length;
    const a1 = n[j].x, b1 = n[j].y, c1 = n[j].x * v[j].x + n[j].y * v[j].y - d;
    const a2 = n[i].x, b2 = n[i].y, c2 = n[i].x * v[i].x + n[i].y * v[i].y - d;
    const det = a1 * b2 - a2 * b1;
    out.push(Math.abs(det) < 1e-9 ? { x: v[i].x - n[i].x * d, y: v[i].y - n[i].y * d } : { x: (c1 * b2 - c2 * b1) / det, y: (a1 * c2 - a2 * c1) / det });
  }
  return out;
}
// 外側に d だけふくらませた形（角は丸くする）
function outsetPolygon(g, d) {
  const key = d.toFixed(3);
  if (g.outset.has(key)) return g.outset.get(key);
  const { outer: v, normals: n } = g;
  const out = [];
  for (let i = 0; i < v.length; i++) {
    const a = n[(i - 1 + v.length) % v.length], b = n[i];
    const t0 = Math.atan2(a.y, a.x);
    let dt = Math.atan2(b.y, b.x) - t0;
    while (dt > Math.PI) dt -= 2 * Math.PI;
    while (dt < -Math.PI) dt += 2 * Math.PI;
    const steps = Math.max(1, Math.ceil(Math.abs(dt) / 0.3));
    for (let k = 0; k <= steps; k++) {
      const t = t0 + (dt * k) / steps;
      out.push({ x: v[i].x + Math.cos(t) * d, y: v[i].y + Math.sin(t) * d });
    }
  }
  g.outset.set(key, out);
  return out;
}
function addPoly(ctx, pts) {
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}
// 本体の形（中抜きは穴をあける。evenodd で塗る）
function bodyPath(ctx, g) {
  ctx.beginPath();
  if (g.multi) { for (const q of g.multi) addPoly(ctx, q); return; }
  addPoly(ctx, g.outer);
  if (g.hole) addPoly(ctx, g.hole);
}
function perimeterPoint(g, u) {
  let d = ((u % 1) + 1) % 1 * g.perim;
  for (let i = 0; i < g.outer.length; i++) {
    if (d <= g.lens[i] || i === g.outer.length - 1) {
      const a = g.outer[i], b = g.outer[(i + 1) % g.outer.length], t = Math.min(1, d / g.lens[i]);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, n: g.normals[i] };
    }
    d -= g.lens[i];
  }
  return { x: g.outer[0].x, y: g.outer[0].y, n: g.normals[0] };
}

// ---- オーラ（Lv.3から。Lv.6から粒が立ちのぼり、Lv.10は金色の輪が回る） ----
export const AURA_FROM = 3;
function paintAura(ctx, g, mat, level, P, now, seed) {
  if (level < AURA_FROM) return;
  const col = MATERIAL_INFO[mat]?.aura || '#ffffff';
  const strength = (level - AURA_FROM + 1) / (10 - AURA_FROM + 1); // 0.125〜1
  const pulse = 0.78 + 0.22 * Math.sin(now / 380 + seed * 1.7);
  ctx.save();
  // ぼんやり光る輪を3枚重ねる
  const layers = [0.3, 0.75, 1.25].map((d) => d * (0.7 + 0.6 * strength));
  for (let i = layers.length - 1; i >= 0; i--) {
    ctx.beginPath();
    addPoly(ctx, outsetPolygon(g, layers[i]));
    addPoly(ctx, g.outer);
    ctx.fillStyle = level >= 10 && i === layers.length - 1 ? '#ffd36b' : col;
    ctx.globalAlpha = (0.2 + 0.22 * strength) * pulse * (i === 0 ? 1.5 : 1);
    ctx.fill('evenodd');
  }
  // 色がはっきり見えるよう、ふちのすぐ外に細い光の線
  ctx.beginPath();
  addPoly(ctx, outsetPolygon(g, 0.2));
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(0.08, 1.8 / P);
  ctx.globalAlpha = (0.55 + 0.4 * strength) * pulse;
  ctx.stroke();
  // 立ちのぼる粒
  if (level >= 6) {
    const n = 2 + (level - 5) * 2;
    for (let i = 0; i < n; i++) {
      const cyc = now / 1700 + i * 0.618 + seed * 0.37;
      const phase = cyc % 1;
      const p = perimeterPoint(g, i / n + Math.floor(cyc) * 0.273 + seed * 0.1);
      const out = 0.25 + phase * (1.2 + strength);
      const x = p.x + p.n.x * out, y = p.y + p.n.y * out;
      const r = 0.12 + 0.2 * (1 - phase);
      ctx.globalAlpha = Math.min(1, (1 - phase) * 1.2) * 0.95;
      ctx.fillStyle = level >= 10 && i % 2 ? '#fff6c8' : col;
      sparkle(ctx, x, y, r);
      ctx.fill();
    }
  }
  // Lv.10：金色の点線の輪がゆっくり回る
  if (level >= 10) {
    ctx.beginPath();
    addPoly(ctx, outsetPolygon(g, 0.55));
    ctx.setLineDash([0.45, 0.8]);
    ctx.lineDashOffset = -now / 90;
    ctx.lineWidth = Math.max(0.1, 2 / P);
    ctx.strokeStyle = '#fff1b0';
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
function sparkle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.6);
  ctx.quadraticCurveTo(x, y, x + r * 1.6, y);
  ctx.quadraticCurveTo(x, y, x, y + r * 1.6);
  ctx.quadraticCurveTo(x, y, x - r * 1.6, y);
  ctx.quadraticCurveTo(x, y, x, y - r * 1.6);
  ctx.closePath();
}

// ---- 素材ごとの塗り ----
function paintMaterial(ctx, g, mat, pl, P) {
  const { box } = g;
  bodyPath(ctx, g);
  if (mat === 'metal') {
    const gr = ctx.createLinearGradient(box.x0, box.y0, box.x0 + (box.y1 - box.y0) * 0.6, box.y1);
    gr.addColorStop(0, '#f1f3f5'); gr.addColorStop(0.45, '#b9c0c8'); gr.addColorStop(0.55, '#c9cfd5'); gr.addColorStop(1, '#e3e7eb');
    ctx.fillStyle = gr;
    ctx.fill('evenodd');
  } else if (mat === 'rubber') {
    ctx.fillStyle = pl.sticker;
    ctx.fill('evenodd');
    ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.fill('evenodd');
  } else {
    ctx.fillStyle = pl.tint;
    ctx.fill('evenodd');
  }
  // 質感（本体の形で切り抜いて重ねる）
  ctx.save();
  bodyPath(ctx, g);
  ctx.clip('evenodd');
  if (mat === 'metal' && P >= 5) {
    // ヘアライン（細い筋）
    ctx.lineWidth = Math.max(0.015, 0.6 / P);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let y = box.y0; y < box.y1; y += 0.16) {
      ctx.strokeStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(60,70,80,0.08)';
      ctx.beginPath(); ctx.moveTo(box.x0, y); ctx.lineTo(box.x1, y + 0.02); ctx.stroke();
    }
  } else if (mat === 'rubber' && P >= 4) {
    // つぶつぶ
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.07)';
    const n = Math.round((box.x1 - box.x0) * (box.y1 - box.y0) * 2.2);
    for (let i = 0; i < n; i++) ctx.fillRect(box.x0 + rnd() * (box.x1 - box.x0), box.y0 + rnd() * (box.y1 - box.y0), 0.09, 0.09);
  } else if (mat === 'acrylic') {
    // つやの帯
    const gr = ctx.createLinearGradient(box.x0, box.y0, box.x1, box.y1);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.32, 'rgba(255,255,255,0)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.42)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  }
  ctx.restore();
}

const inkOf = (mat) => (mat === 'gold' ? 'rgba(255, 222, 140, 0.95)' : mat === 'rubber' ? 'rgba(40, 20, 25, 0.82)' : mat === 'metal' ? 'rgba(25, 28, 34, 0.88)' : 'rgba(20, 20, 30, 0.85)');
const fontOf = (size) => `600 ${size.toFixed(1)}px "BIZ UDPGothic", system-ui, sans-serif`;

// ---- 目盛り ----
function paintScale(ctx, g, mat, P) {
  const sh = g.sh;
  const ink = inkOf(mat);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = Math.max(0.03, 0.8 / P);
  if (sh.kind === 'cloud') {
    // 雲形定規：目盛りの代わりに、ふちに沿った細い線（曲線をなぞる定規）
    ctx.save();
    ctx.globalAlpha *= 0.5;
    ctx.beginPath();
    addPoly(ctx, g.outer.map((p, i) => ({ x: p.x - g.normals[i].x * 0.55, y: p.y - g.normals[i].y * 0.55 })));
    ctx.setLineDash([0.12, 0.38]);
    ctx.lineWidth = Math.max(0.03, 1.4 / P);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (sh.kind === 'protractor') {
    const R = sh.R;
    ctx.beginPath();
    for (let d = 0; d <= 180; d++) {
      const ten = d % 10 === 0, five = d % 5 === 0;
      if (!ten && !(five && P >= 5) && P < 11) continue;
      const len = ten ? 0.75 : five ? 0.5 : 0.3;
      const t = (-d * Math.PI) / 180;
      ctx.moveTo(Math.cos(t) * R, Math.sin(t) * R);
      ctx.lineTo(Math.cos(t) * (R - len), Math.sin(t) * (R - len));
    }
    // 基線と中心
    ctx.moveTo(-R + 0.35, 0); ctx.lineTo(R - 0.35, 0);
    ctx.moveTo(0, 0); ctx.lineTo(0, -0.55);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 0.12, 0, Math.PI * 2); ctx.stroke();
    const fs = 0.5 * P;
    if (fs >= 6) {
      const every = P >= 16 ? 10 : 30;
      ctx.save();
      ctx.scale(1 / P, 1 / P);
      ctx.font = fontOf(fs);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let d = 0; d <= 180; d += every) {
        const t = (-d * Math.PI) / 180, r = R - 1.15;
        ctx.save();
        ctx.translate(Math.cos(t) * r * P, Math.sin(t) * r * P);
        ctx.rotate(t + Math.PI / 2);
        ctx.fillText(String(d), 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }
    return;
  }
  // まっすぐな定規は上の辺、三角定規は下の辺（直角をはさむ長い辺）に目盛り
  let x0, edgeY, dir, room;
  // 折りたたみ定規はたたんだ長さの分だけ（目盛りが形からはみ出さないように）
  const nom = sh.kind === 'rect' ? Math.min(sh.nominal, Math.floor(sh.L - 1.2)) : sh.nominal;
  if (sh.kind === 'rect') { x0 = -nom / 2; edgeY = -sh.W / 2; dir = 1; room = sh.W; }
  else { x0 = 0.8; edgeY = 0; dir = -1; room = sh.hole; }
  const showMm = P >= 7, showHalf = P >= 3.5;
  ctx.beginPath();
  for (let i = 0; i <= nom * 10; i++) {
    const cm = i % 10 === 0, half = i % 5 === 0;
    if (!cm && !(half && showHalf) && !showMm) continue;
    const x = x0 + i * 0.1;
    const len = Math.min(cm ? 1.1 : half ? 0.75 : 0.45, room * (cm ? 0.32 : half ? 0.22 : 0.13));
    ctx.moveTo(x, edgeY); ctx.lineTo(x, edgeY + dir * len);
  }
  ctx.stroke();
  const every = P >= 13 ? 1 : 5;
  const fs = Math.min(room * 0.25, 0.9) * P;
  if (fs >= 6) {
    ctx.save();
    ctx.scale(1 / P, 1 / P);
    ctx.font = fontOf(fs);
    ctx.textAlign = 'center'; ctx.textBaseline = dir > 0 ? 'top' : 'bottom';
    const ty = edgeY + dir * Math.min(room * 0.34, 1.2);
    for (let c = 0; c <= nom; c += every) ctx.fillText(String(c), (x0 + c) * P, ty * P);
    ctx.restore();
  }
}

// ヒビ：体力が減るほど増える（70未満で1本、50未満で2本、30未満で3本）
function paintCracks(ctx, g, hp, P, seed) {
  const n = hp < 30 ? 3 : hp < 50 ? 2 : 1;
  let r = 97 + seed * 31;
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const cx = (g.box.x0 + g.box.x1) / 2, cy = (g.box.y0 + g.box.y1) / 2;
  ctx.save();
  bodyPath(ctx, g);
  ctx.clip('evenodd');
  ctx.lineJoin = 'miter';
  for (let k = 0; k < n; k++) {
    // 外周の1点から、内側へジグザグに走る
    const v = g.outer[Math.floor(rnd() * g.outer.length)];
    const a = g.outer[(g.outer.indexOf(v) + 1) % g.outer.length];
    const t = 0.2 + rnd() * 0.6;
    let x = v.x + (a.x - v.x) * t, y = v.y + (a.y - v.y) * t;
    const dx = cx - x, dy = cy - y, len = Math.hypot(dx, dy) || 1;
    const reach = Math.min(len * 0.9, 2.5 + rnd() * 3);
    const pts = [[x, y]];
    for (let j = 1; j <= 5; j++) {
      const f = (reach * j) / 5;
      const side = (rnd() - 0.5) * 1.2;
      pts.push([x + (dx / len) * f - (dy / len) * side, y + (dy / len) * f + (dx / len) * side]);
    }
    for (const [col, w, off] of [['rgba(255,255,255,0.55)', 1.8, 0.06], ['rgba(35,25,25,0.75)', 1.2, 0]]) {
      ctx.beginPath();
      pts.forEach(([px, py], j) => (j ? ctx.lineTo(px + off, py + off) : ctx.moveTo(px + off, py + off)));
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(0.04, w / P);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// シールと名前シールを貼る場所（形を定義した座標。rot は名前シールの向き）
function stickerSpots(sh) {
  if (sh.kind === 'rect') {
    const L = sh.L, W = sh.W;
    const sw = Math.min(3.0, L * 0.12), shh = Math.min(W * 0.42, 1.4);
    const size = Math.min(W * 0.62, 2.4);
    return {
      name: { cx: L / 2 - sw / 2 - Math.min(1.2, L * 0.05), cy: W / 2 - shh / 2 - Math.min(W * 0.1, 0.35), w: sw, h: shh, rot: 0 },
      deco: { cx: -L / 2 + L * 0.22, cy: W / 2 - size * 0.62, size },
    };
  }
  if (sh.kind === 'tri') {
    const band = sh.hole, sw = 3.0, shh = Math.min(band * 0.6, 1.4), size = Math.min(band * 0.8, 2.0);
    return {
      name: { cx: band / 2, cy: -(band + 0.4 + sw / 2), w: sw, h: shh, rot: -Math.PI / 2 },
      deco: { cx: band / 2, cy: -(band + 0.4 + sw + 0.5 + size / 2), size },
    };
  }
  return {
    name: { cx: 2.7, cy: 0.05, w: 2.4, h: 1.05, rot: 0 },
    deco: { cx: -2.7, cy: 0.05, size: 1.3 },
  };
}

// b: { owner, specKey, level, x, y, a, pattern, sticker, alpha, scale }
// b.shapeKey：形の変わる定規のいまの形（無ければ体力から決める）。b.pl：席の色の代わり（ステージの敵の定規）
export function paintRuler(ctx, b, px, active = false, now = 0) {
  const s = Physics.RULERS[b.specKey] || Physics.RULERS['straight30-acrylic'];
  const g = geometry(b.shapeKey || Physics.shapeOf(b.specKey, b.hp, b.maxHp));
  const pl = b.pl || PLAYERS[b.owner] || PLAYERS[0];
  if (s.enemy && !s.forms) { paintEnemy(ctx, b, s, g, px, active, now); return; }
  const k = b.scale ?? 1;
  const P = px * k; // この定規の1cmあたりのピクセル数
  const level = b.level || 1;
  ctx.save();
  ctx.globalAlpha = b.alpha ?? 1;
  ctx.translate(b.x, b.y);
  ctx.rotate(b.a);
  ctx.scale(k, k);
  ctx.translate(-g.off.x, -g.off.y);
  ctx.lineJoin = 'round';

  paintAura(ctx, g, s.mat, level, P, now, b.owner || 0);
  // 影
  ctx.save();
  ctx.translate(0.25, 0.45);
  bodyPath(ctx, g);
  ctx.fillStyle = 'rgba(40, 22, 8, 0.28)';
  ctx.fill('evenodd');
  ctx.restore();
  // 本体（SSR・一部のSRは、絵柄で地の色から塗りかえる）
  paintMaterial(ctx, g, s.mat, pl, P);
  const art = ART_PAINT[b.art] ? b.art : 'plain';
  if (art !== 'plain') {
    ctx.save();
    bodyPath(ctx, g);
    ctx.clip('evenodd');
    ART_PAINT[art](ctx, g, P, now, pl);
    ctx.restore();
  }
  // 柄
  if (b.pattern) {
    ctx.save();
    bodyPath(ctx, g);
    ctx.clip('evenodd');
    const { box } = g;
    ctx.translate((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
    paintPattern(ctx, b.pattern, (box.x1 - box.x0) / 2, (box.y1 - box.y0) / 2, 1);
    ctx.restore();
  }
  // ふち
  bodyPath(ctx, g);
  ctx.lineWidth = Math.max(0.06, 1.3 / P);
  ctx.strokeStyle = s.mat === 'acrylic' ? pl.edge : s.mat === 'metal' ? 'rgba(70, 78, 88, 0.85)' : 'rgba(60, 25, 30, 0.6)';
  if (ART_BASE.has(art)) ctx.strokeStyle = art === 'steel' ? 'rgba(60, 66, 76, 0.9)' : 'rgba(20, 12, 8, 0.85)';
  ctx.stroke();
  if (s.mat !== 'acrylic' || ART_BASE.has(art)) {
    // 席の色がわかるよう、外のふちを席の色でなぞる
    ctx.beginPath(); addPoly(ctx, g.outer);
    ctx.lineWidth = Math.max(0.1, 2.2 / P);
    ctx.strokeStyle = pl.edge;
    ctx.stroke();
  }

  paintScale(ctx, g, ART_INK[art] || s.mat, P);
  if (g.sh.folds) paintHinges(ctx, g, P);
  const hpPct = ((b.hp ?? 100) / (b.maxHp || 100)) * 100;
  if (hpPct < 70) paintCracks(ctx, g, hpPct, P, b.owner || 0);

  const spots = stickerSpots(g.sh);
  if (b.sticker) paintSticker(ctx, b.sticker, spots.deco.cx, spots.deco.cy, spots.deco.size);
  // 名前シール（席の色。飾りがあっても必ず見えるように最後に描く）
  const n = spots.name;
  ctx.save();
  ctx.translate(n.cx, n.cy);
  ctx.rotate(n.rot);
  roundRect(ctx, -n.w / 2, -n.h / 2, n.w, n.h, n.h * 0.25);
  ctx.fillStyle = pl.sticker; ctx.fill();
  ctx.lineWidth = Math.max(0.04, 0.8 / P);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.stroke();
  if (n.h * P >= 9) {
    ctx.scale(1 / P, 1 / P);
    ctx.font = `700 ${(n.h * P * 0.72).toFixed(1)}px "BIZ UDPGothic", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = pl.ink;
    ctx.fillText(pl.name, 0, 0.5);
  }
  ctx.restore();

  // 不動：重くなっている間は、紫の太い輪郭と重りの印
  if (b.anchor) {
    ctx.save();
    ctx.beginPath();
    addPoly(ctx, outsetPolygon(g, 0.35));
    ctx.strokeStyle = '#8a5cf0';
    ctx.globalAlpha = (b.alpha ?? 1) * 0.9;
    ctx.lineWidth = Math.max(0.3, 4 / P);
    ctx.stroke();
    ctx.beginPath();
    addPoly(ctx, outsetPolygon(g, 0.9));
    ctx.globalAlpha = (b.alpha ?? 1) * 0.35;
    ctx.lineWidth = Math.max(0.15, 2 / P);
    ctx.stroke();
    ctx.restore();
  }

  // 反撃の構え：オレンジの点線／身代わり：白い光の輪
  if (b.counter || b.sub) {
    ctx.save();
    ctx.beginPath();
    addPoly(ctx, outsetPolygon(g, b.counter ? 0.5 : 0.8));
    ctx.strokeStyle = b.counter ? '#fd9644' : 'rgba(255, 255, 255, 0.95)'; // 身代わりは白い光
    ctx.lineWidth = Math.max(0.2, 3 / P);
    if (b.counter) ctx.setLineDash([0.7, 0.45]);
    ctx.globalAlpha = (b.alpha ?? 1) * (0.7 + 0.3 * Math.sin(now / 250));
    ctx.stroke();
    ctx.restore();
  }
  // インク漏れ：紫のしみ
  if (b.ink > 0) {
    ctx.save();
    bodyPath(ctx, g);
    ctx.clip('evenodd');
    let r = 11 + (b.owner || 0) * 7;
    const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    ctx.fillStyle = 'rgba(80, 50, 170, 0.55)';
    const { box } = g;
    for (let k = 0; k < 3 + b.ink; k++) {
      ctx.beginPath();
      ctx.arc(box.x0 + rnd() * (box.x1 - box.x0), box.y0 + rnd() * (box.y1 - box.y0), 0.5 + rnd() * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 手番の定規はチョークの点線で囲む
  if (active) {
    ctx.globalAlpha = (b.alpha ?? 1) * (0.55 + 0.45 * Math.sin(now / 260));
    ctx.beginPath();
    addPoly(ctx, outsetPolygon(g, 0.7));
    ctx.setLineDash([0.8, 0.6]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(0.12, 2 / P);
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
    // ---- バトル道場の柄（和柄） ----
    case 'pattern:sakura': {
      // 桜：散らした五枚の花びら
      const rnd = rng(17);
      const n = Math.max(3, Math.round(L * W * 0.16));
      for (let i = 0; i < n; i++) {
        const x = -hx + rnd() * L, y = -hy + rnd() * W, r = (0.35 + rnd() * 0.35) * k, rot = rnd() * 6;
        ctx.fillStyle = rnd() > 0.4 ? 'rgba(255, 196, 214, 0.85)' : 'rgba(255, 240, 245, 0.85)';
        for (let p = 0; p < 5; p++) {
          const a = rot + p * Math.PI * 2 / 5;
          ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.32, a, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = 'rgba(214, 90, 120, 0.8)'; ctx.beginPath(); ctx.arc(x, y, r * 0.16, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'pattern:asanoha': {
      // 麻の葉：六角の中に放射状の線
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'; ctx.lineWidth = 0.07 * k;
      const s6 = 1.1 * k, h6 = s6 * Math.sqrt(3) / 2;
      ctx.beginPath();
      for (let row = 0, y = -hy - h6; y < hy + h6; y += h6 * 1.5, row++) {
        for (let x = -hx - s6 + (row % 2) * s6 * 0.866; x < hx + s6; x += s6 * 1.732) {
          for (let q = 0; q < 6; q++) {
            const a = Math.PI / 6 + q * Math.PI / 3;
            ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * s6, y + Math.sin(a) * s6);
            const b = a + Math.PI / 3;
            ctx.moveTo(x + Math.cos(a) * s6, y + Math.sin(a) * s6); ctx.lineTo(x + Math.cos(b) * s6, y + Math.sin(b) * s6);
            const m = a + Math.PI / 6;
            ctx.moveTo(x + Math.cos(a) * s6, y + Math.sin(a) * s6); ctx.lineTo(x + Math.cos(m) * s6 * 0.5, y + Math.sin(m) * s6 * 0.5);
            ctx.moveTo(x + Math.cos(b) * s6, y + Math.sin(b) * s6); ctx.lineTo(x + Math.cos(m) * s6 * 0.5, y + Math.sin(m) * s6 * 0.5);
          }
        }
      }
      ctx.stroke();
      break;
    }
    case 'pattern:ichimatsu': {
      // 市松：濃い色と淡い色の石畳
      const c = Math.max(0.7, W / 3);
      let i = 0;
      for (let x = -hx; x < hx; x += c, i++) {
        let j = 0;
        for (let y = -hy; y < hy; y += c, j++) {
          ctx.fillStyle = (i + j) % 2 ? 'rgba(20, 60, 50, 0.4)' : 'rgba(255, 255, 255, 0.28)';
          ctx.fillRect(x, y, c, c);
        }
      }
      break;
    }
    case 'pattern:yagasuri': {
      // 矢絣：矢羽根を縦に並べる
      const w = 1.2 * k, h = W;
      let i = 0;
      for (let x = -hx; x < hx; x += w, i++) {
        ctx.fillStyle = i % 2 ? 'rgba(130, 40, 60, 0.45)' : 'rgba(255, 255, 255, 0.35)';
        ctx.beginPath();
        ctx.moveTo(x, -hy); ctx.lineTo(x + w, -hy + h * 0.25); ctx.lineTo(x + w, hy); ctx.lineTo(x, hy - h * 0.25); ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'pattern:shippo': {
      // 七宝：重なり合う円
      ctx.strokeStyle = 'rgba(176, 128, 26, 0.62)'; ctx.lineWidth = 0.1 * k;
      const r = 0.7 * k;
      ctx.beginPath();
      for (let y = -hy - r; y < hy + r; y += r) for (let x = -hx - r; x < hx + r; x += r) {
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.stroke();
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

// 定規ケースなどのプレビュー（1本だけ）。オーラのある定規は動かし続ける
const previews = new Map(); // canvas -> { look, owner, px, cx, cy, dpr }
export function previewRuler(canvas, look, owner = 0) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cssW = canvas.clientWidth || 300, cssH = canvas.clientHeight || 60;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const s = Physics.RULERS[look.specKey] || Physics.RULERS['straight30-acrylic'];
  const g = geometry(look.shapeKey || s.shape);
  const margin = (look.level || 1) >= AURA_FROM ? 2.4 : 0.6;
  const bw = g.box.x1 - g.box.x0 + margin, bh = g.box.y1 - g.box.y0 + margin;
  const px = Math.min((cssW - 12) / bw, (cssH - 10) / bh, 22);
  // 形の外枠の真ん中を画面の真ん中に
  const x = g.off.x - (g.box.x0 + g.box.x1) / 2, y = g.off.y - (g.box.y0 + g.box.y1) / 2;
  const p = { look, owner, px, x, y, dpr, cssW, cssH };
  previews.set(canvas, p);
  drawPreview(canvas, p, performance.now());
  if ((look.level || 1) >= AURA_FROM && !loopOn) { loopOn = true; requestAnimationFrame(loop); }
}
function drawPreview(canvas, p, now) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(p.px * p.dpr, 0, 0, p.px * p.dpr, p.cssW / 2 * p.dpr, p.cssH / 2 * p.dpr);
  paintRuler(ctx, { owner: p.owner, specKey: p.look.specKey, shapeKey: p.look.shapeKey, maxHp: p.look.maxHp, hp: p.look.hp, enemy: p.look.enemy, pl: p.look.pl, level: p.look.level, art: p.look.art, x: p.x, y: p.y, a: 0, pattern: p.look.pattern, sticker: p.look.sticker }, p.px, false, now);
}
let loopOn = false, lastLoop = 0;
function loop(now) {
  let any = false;
  for (const [canvas, p] of previews) {
    if (!canvas.isConnected) { previews.delete(canvas); continue; }
    if ((p.look.level || 1) < AURA_FROM) continue;
    any = true;
    if (now - lastLoop >= 33 && canvas.offsetParent !== null) drawPreview(canvas, p, now);
  }
  if (now - lastLoop >= 33) lastLoop = now;
  if (any) requestAnimationFrame(loop); else loopOn = false;
}

// ---- 折りたたみ定規の継ぎ目（金具） ----
function paintHinges(ctx, g, P) {
  const sh = g.sh, L = sh.L, W = sh.W;
  ctx.save();
  if (sh.folds === 3) {
    // たたんだ形：3枚重なって見えるよう、少しずらした縁を描く
    ctx.strokeStyle = 'rgba(30, 60, 90, 0.45)';
    ctx.lineWidth = Math.max(0.05, 1 / P);
    for (const k of [1, 2]) {
      ctx.beginPath();
      ctx.moveTo(-L / 2 + 0.3 * k, -W / 2 + 0.28 * k); ctx.lineTo(L / 2 - 0.3 * k, -W / 2 + 0.28 * k);
      ctx.stroke();
    }
  }
  const at = sh.folds === 2 ? [0] : sh.folds === 1 ? [-L / 6, L / 6] : [-L / 2 + 0.9, L / 2 - 0.9];
  for (const x of at) {
    ctx.fillStyle = 'rgba(40, 50, 60, 0.35)';
    ctx.fillRect(x - 0.05, -W / 2, 0.1, W);
    const r = Math.min(0.55, W * 0.18);
    const gr = ctx.createRadialGradient(x - r * 0.3, -r * 0.3, r * 0.1, x, 0, r);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#c4ccd4'); gr.addColorStop(1, '#7c8794');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(x, 0, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ---- ステージの敵（文房具） ----
// 形を定義したときの座標で描く（長い向きが x）。範囲のある敵は、その範囲をうっすら見せる
function paintEnemy(ctx, b, s, g, px, active, now) {
  const k = b.scale ?? 1;
  const P = px * k;
  const sh = g.sh;
  ctx.save();
  ctx.globalAlpha = b.alpha ?? 1;
  ctx.translate(b.x, b.y);
  // 範囲（向きに関係ない円）
  const range = { 'en-compass': ['rgba(220, 60, 50, 0.5)', 14, true], 'en-glue': ['rgba(142, 91, 214, 0.5)', 12, false], 'en-eraser': ['rgba(63, 127, 214, 0.45)', 9, true], 'en-magnet': ['rgba(208, 69, 58, 0.32)', 32, true] }[b.specKey];
  if (range && (b.alpha ?? 1) > 0.6) {
    const [col, r, dash] = range;
    ctx.save();
    ctx.globalAlpha *= 0.55 + 0.15 * Math.sin(now / 500);
    if (!dash) { ctx.fillStyle = 'rgba(142, 91, 214, 0.10)'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(0.12, 1.4 / P);
    if (dash) ctx.setLineDash([0.9, 0.7]);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  ctx.rotate(b.a);
  ctx.scale(k, k);
  ctx.translate(-g.off.x, -g.off.y);
  ctx.lineJoin = 'round';
  // 影
  ctx.save();
  ctx.translate(0.2, 0.35);
  bodyPath(ctx, g);
  ctx.fillStyle = 'rgba(40, 22, 8, 0.28)';
  ctx.fill();
  ctx.restore();
  const line = (w) => Math.max(0.04, w / P);
  const L = sh.L || 0, W = sh.W || 0;
  switch (b.specKey) {
    case 'en-eraser': {
      bodyPath(ctx, g); ctx.fillStyle = '#f7f5ef'; ctx.fill();
      ctx.strokeStyle = 'rgba(120, 110, 100, 0.55)'; ctx.lineWidth = line(1); ctx.stroke();
      // 紙のスリーブ
      ctx.fillStyle = '#3f7fd6'; ctx.fillRect(-L / 2 + 1.3, -W / 2 - 0.02, L - 2.3, W + 0.04);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(-L / 2 + 1.3, -0.22, L - 2.3, 0.44);
      ctx.fillStyle = '#1f2a44'; ctx.fillRect(-L / 2 + 1.3, -W / 2 - 0.02, 0.22, W + 0.04);
      break;
    }
    case 'en-pencil': {
      bodyPath(ctx, g); ctx.fillStyle = '#f2b630'; ctx.fill();
      // 削った木と芯
      ctx.fillStyle = '#e8c79a';
      ctx.beginPath(); ctx.moveTo(6.6, -0.4); ctx.lineTo(8.8, 0); ctx.lineTo(6.6, 0.4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath(); ctx.moveTo(8.05, -0.135); ctx.lineTo(8.8, 0); ctx.lineTo(8.05, 0.135); ctx.closePath(); ctx.fill();
      // 六角の稜線
      ctx.strokeStyle = 'rgba(160, 100, 0, 0.55)'; ctx.lineWidth = line(0.8);
      for (const y of [-0.14, 0.14]) { ctx.beginPath(); ctx.moveTo(-7.4, y); ctx.lineTo(6.6, y); ctx.stroke(); }
      // おしりの消しゴムと金具
      ctx.fillStyle = '#f08aa0'; ctx.fillRect(-8.8, -0.4, 0.8, 0.8);
      ctx.fillStyle = '#c8ced6'; ctx.fillRect(-8.0, -0.42, 0.6, 0.84);
      ctx.strokeStyle = 'rgba(90, 60, 10, 0.6)'; ctx.lineWidth = line(1); bodyPath(ctx, g); ctx.stroke();
      break;
    }
    case 'en-clip': {
      ctx.strokeStyle = '#aab3bf'; ctx.lineWidth = 0.14; ctx.lineCap = 'round';
      roundRect(ctx, -1.62, -0.42, 3.24, 0.84, 0.42); ctx.stroke();
      roundRect(ctx, -1.2, -0.22, 2.4, 0.44, 0.22); ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'; ctx.lineWidth = 0.05;
      roundRect(ctx, -1.62, -0.42, 3.24, 0.84, 0.42); ctx.stroke();
      break;
    }
    case 'en-stapler': {
      bodyPath(ctx, g); ctx.fillStyle = '#3c4352'; ctx.fill();
      ctx.fillStyle = '#8a93a3'; roundRect(ctx, -L / 2 + 0.8, -W / 2 + 0.55, L - 2.2, W - 1.1, 0.6); ctx.fill();
      ctx.fillStyle = '#c8ced6'; roundRect(ctx, L / 2 - 1.5, -0.45, 1.1, 0.9, 0.2); ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'; ctx.lineWidth = line(1);
      ctx.beginPath(); ctx.moveTo(-L / 2 + 1.2, 0); ctx.lineTo(L / 2 - 1.8, 0); ctx.stroke();
      break;
    }
    case 'en-tack': {
      const gr = ctx.createRadialGradient(-0.3, -0.3, 0.1, 0, 0, 1);
      gr.addColorStop(0, '#ff9c8f'); gr.addColorStop(0.55, '#d9443a'); gr.addColorStop(1, '#8e1f18');
      ctx.fillStyle = gr; bodyPath(ctx, g); ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'; ctx.lineWidth = line(1);
      ctx.beginPath(); ctx.arc(0, 0, 0.55, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#e9edf2'; ctx.beginPath(); ctx.arc(0, 0, 0.16, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'en-glue': {
      bodyPath(ctx, g); ctx.fillStyle = '#f6f6f2'; ctx.fill();
      ctx.fillStyle = '#8e5bd6'; ctx.fillRect(-L / 2 + 2.2, -W / 2, 3.4, W);
      ctx.fillStyle = '#6a3fb0'; roundRect(ctx, L / 2 - 2.6, -W / 2, 2.6, W, 0.55); ctx.fill();
      ctx.strokeStyle = 'rgba(80, 60, 120, 0.5)'; ctx.lineWidth = line(1); bodyPath(ctx, g); ctx.stroke();
      if (P > 10) {
        ctx.save(); ctx.scale(1 / P, 1 / P);
        ctx.fillStyle = '#fff'; ctx.font = `700 ${(W * P * 0.5).toFixed(1)}px "BIZ UDPGothic", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('のり', (-L / 2 + 3.9) * P, 0.5);
        ctx.restore();
      }
      break;
    }
    case 'en-tape': {
      bodyPath(ctx, g); ctx.fillStyle = '#2fb3a5'; ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath(); ctx.arc(-1.2, 0, 1.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d9e6e4'; ctx.beginPath(); ctx.arc(-1.2, 0, 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f1f4f6'; roundRect(ctx, L / 2 - 1.4, -0.35, 1.3, 0.7, 0.2); ctx.fill();
      ctx.strokeStyle = 'rgba(10, 70, 64, 0.6)'; ctx.lineWidth = line(1); bodyPath(ctx, g); ctx.stroke();
      break;
    }
    case 'en-compass': {
      // 上から見たコンパス：つまみと2本の脚
      ctx.strokeStyle = '#9aa4b2'; ctx.lineWidth = 0.32; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(1.6, 0.9); ctx.moveTo(0, 0); ctx.lineTo(-1.6, 0.9); ctx.stroke();
      const gr = ctx.createRadialGradient(-0.4, -0.4, 0.1, 0, 0, 1.1);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#b9c2cc'); gr.addColorStop(1, '#6d7784');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, 1.05, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2b2f36'; ctx.beginPath(); ctx.arc(0, 0, 0.22, 0, Math.PI * 2); ctx.fill();
      break;
    }
    // ---- 破天荒編 ----
    case 'en-brush': {
      // 木の柄・金具・絵の具をふくんだ穂先（色は筆ごと）
      const col = PAINT_COLOR[b.paint] || PAINT_COLOR.red;
      ctx.fillStyle = '#c98a4b';
      ctx.beginPath(); ctx.moveTo(-7.5, -0.42); ctx.lineTo(3.6, -0.55); ctx.lineTo(3.6, 0.55); ctx.lineTo(-7.5, 0.42); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255, 230, 190, 0.35)'; ctx.fillRect(-7.2, -0.32, 10.4, 0.18);
      ctx.fillStyle = col; ctx.fillRect(-7.5, -0.42, 1.1, 0.84); // 柄のおしりの色
      const fg = ctx.createLinearGradient(0, -0.6, 0, 0.6);
      fg.addColorStop(0, '#f1f3f5'); fg.addColorStop(0.5, '#a9b1bb'); fg.addColorStop(1, '#dfe3e8');
      ctx.fillStyle = fg; ctx.fillRect(3.4, -0.6, 1.4, 1.2);
      ctx.fillStyle = '#efe4cf';
      ctx.beginPath(); ctx.moveTo(4.8, -0.62); ctx.quadraticCurveTo(6.6, -0.6, 7.5, 0); ctx.quadraticCurveTo(6.6, 0.6, 4.8, 0.62); ctx.closePath(); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(5.6, -0.55); ctx.quadraticCurveTo(6.8, -0.45, 7.5, 0); ctx.quadraticCurveTo(6.8, 0.45, 5.6, 0.55); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(70, 40, 15, 0.6)'; ctx.lineWidth = line(1); bodyPath(ctx, g); ctx.stroke();
      break;
    }
    case 'en-palette': {
      // 白いパレットに、4色の絵の具のくぼみと、親指の穴
      const R = 5.2, R2 = 3.9;
      ctx.fillStyle = '#fbfaf6'; ctx.beginPath(); ctx.ellipse(0, 0, R, R2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(120, 110, 90, 0.6)'; ctx.lineWidth = line(1.2); ctx.stroke();
      const wells = [['red', -2.6, -1.9], ['blue', 0.2, -2.6], ['green', 2.8, -1.6], ['yellow', 3.2, 1.2]];
      for (const [c, x, y] of wells) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)'; ctx.beginPath(); ctx.arc(x + 0.08, y + 0.1, 1.05, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = PAINT_COLOR[c]; ctx.beginPath(); ctx.arc(x, y, 0.95, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'; ctx.beginPath(); ctx.ellipse(x - 0.3, y - 0.35, 0.35, 0.16, -0.5, 0, Math.PI * 2); ctx.fill();
      }
      // 混ぜた跡
      ctx.fillStyle = 'rgba(150, 90, 160, 0.35)'; ctx.beginPath(); ctx.ellipse(-0.6, 1.4, 1.6, 0.8, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d9bb8f'; ctx.beginPath(); ctx.ellipse(-3.3, 1.4, 0.8, 0.65, 0.4, 0, Math.PI * 2); ctx.fill(); // 親指の穴（机が見える）
      ctx.strokeStyle = 'rgba(120, 110, 90, 0.5)'; ctx.lineWidth = line(1); ctx.stroke();
      break;
    }
    case 'en-scissors': {
      // 刃（金属）・持ち手（オレンジの輪）・要のねじ
      const [b1, b2, h1, h2] = g.multi;
      const mg = ctx.createLinearGradient(0, -3, 9, 3);
      mg.addColorStop(0, '#eef1f4'); mg.addColorStop(0.5, '#a3acb7'); mg.addColorStop(1, '#dde2e7');
      for (const q of [b1, b2]) { ctx.beginPath(); addPoly(ctx, q); ctx.fillStyle = mg; ctx.fill(); ctx.strokeStyle = 'rgba(60, 68, 80, 0.7)'; ctx.lineWidth = line(1); ctx.stroke(); }
      for (const q of [h1, h2]) {
        ctx.beginPath(); addPoly(ctx, q); ctx.fillStyle = '#e8743b'; ctx.fill();
        const cx = q.reduce((a, p) => a + p.x, 0) / q.length, cy = q.reduce((a, p) => a + p.y, 0) / q.length;
        ctx.fillStyle = '#d9bb8f'; ctx.beginPath(); ctx.ellipse(cx, cy, 1.15, 0.6, cy > g.off.y ? -0.3 : 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); addPoly(ctx, q); ctx.strokeStyle = 'rgba(120, 50, 20, 0.7)'; ctx.lineWidth = line(1); ctx.stroke();
      }
      // 刃の間（ここで番を終えると力が半分）をうっすら
      const { len, open } = Physics.BLADE;
      ctx.fillStyle = 'rgba(232, 116, 59, 0.16)';
      ctx.beginPath(); ctx.moveTo(g.off.x * 0, 0); ctx.lineTo(Math.cos(open) * len, Math.sin(open) * len); ctx.lineTo(Math.cos(open) * len, -Math.sin(open) * len); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5b6470'; ctx.beginPath(); ctx.arc(0, 0, 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c9ced6'; ctx.beginPath(); ctx.arc(-0.08, -0.08, 0.2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'en-magnet': {
      // 赤いU字と、銀色の極（N・S）
      for (const q of g.multi) { ctx.beginPath(); addPoly(ctx, q); ctx.fillStyle = '#d0453a'; ctx.fill(); }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'; ctx.fillRect(-3.3, -3.1, 0.4, 6.2);
      const sg = ctx.createLinearGradient(0, -3.3, 0, 3.3);
      sg.addColorStop(0, '#f2f4f6'); sg.addColorStop(0.5, '#a8b0ba'); sg.addColorStop(1, '#e3e7ea');
      ctx.fillStyle = sg;
      ctx.fillRect(2.0, -3.3, 1.4, 1.8); ctx.fillRect(2.0, 1.5, 1.4, 1.8);
      for (const q of g.multi) { ctx.beginPath(); addPoly(ctx, q); ctx.strokeStyle = 'rgba(90, 20, 15, 0.65)'; ctx.lineWidth = line(1); ctx.stroke(); }
      if (P > 9) {
        ctx.save(); ctx.scale(1 / P, 1 / P);
        ctx.fillStyle = '#2b2f36'; ctx.font = `700 ${(1.2 * P).toFixed(1)}px "BIZ UDPGothic", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('N', 2.7 * P, -2.4 * P); ctx.fillText('S', 2.7 * P, 2.4 * P);
        ctx.restore();
      }
      break;
    }
    case 'boss-cloud': {
      // 雷雲の雲形定規：体力で白い雲 → 灰色の雲 → 黒い雷雲
      const form = Physics.formIndex(b.hp ?? 100, b.maxHp || 100);
      paintCloud(ctx, g, P, now, ['white', 'gray', 'black'][form] || 'white');
      break;
    }
    default: {
      bodyPath(ctx, g); ctx.fillStyle = '#ccc'; ctx.fill();
    }
  }
  const hpPct = ((b.hp ?? 100) / (b.maxHp || 100)) * 100;
  if (hpPct < 70 && !['en-clip', 'boss-cloud', 'en-scissors', 'en-magnet'].includes(b.specKey)) paintCracks(ctx, g, hpPct, P, b.owner || 0);
  if (active) {
    ctx.globalAlpha = (b.alpha ?? 1) * (0.55 + 0.45 * Math.sin(now / 260));
    ctx.beginPath();
    addPoly(ctx, outsetPolygon(g, 0.6));
    ctx.setLineDash([0.8, 0.6]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(0.12, 2 / P);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// 絵の具の色（stage.js の PAINT と同じ）
const PAINT_COLOR = { red: '#e0483a', blue: '#2f7fd6', green: '#3fae5a', yellow: '#e8b818' };
// 雲形定規の雲（tone：white / gray / black / storm〈プレイヤーの定規〉）
const CLOUD_TONE = {
  white: { a: '#ffffff', b: '#dde4f0', edge: 'rgba(110, 120, 160, 0.85)', puff: 'rgba(255, 255, 255, 0.9)' },
  gray: { a: '#d4d8df', b: '#8e94a2', edge: 'rgba(60, 64, 78, 0.9)', puff: 'rgba(240, 242, 246, 0.55)' },
  black: { a: '#5a5470', b: '#211e2c', edge: 'rgba(10, 8, 16, 0.95)', puff: 'rgba(150, 140, 190, 0.35)', flash: true },
  storm: { a: '#6f63d8', b: '#2c2560', edge: 'rgba(20, 12, 40, 0.9)', puff: 'rgba(200, 190, 255, 0.4)', flash: true },
};
function paintCloud(ctx, g, P, now, tone) {
  const t = CLOUD_TONE[tone] || CLOUD_TONE.white;
  const { box } = g;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  ctx.save();
  bodyPath(ctx, g);
  const gr = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, (box.x1 - box.x0) * 0.6);
  gr.addColorStop(0, t.a); gr.addColorStop(1, t.b);
  ctx.globalAlpha *= 0.94; // アクリルなので少し透ける
  ctx.fillStyle = gr; ctx.fill();
  ctx.clip();
  // もこもこの雲（部品の上側に丸を重ねる）
  ctx.fillStyle = t.puff;
  for (const q of g.sh.parts) {
    const px = q.center.x + g.off.x, py = q.center.y + g.off.y;
    const r = Math.sqrt(q.area / Math.PI);
    for (const [dx, dy, k] of [[-0.45, -0.35, 0.42], [0.1, -0.5, 0.36], [0.5, -0.25, 0.3]]) {
      ctx.beginPath(); ctx.arc(px + dx * r, py + dy * r, r * k, 0, Math.PI * 2); ctx.fill();
    }
  }
  // 黒い雷雲は、中で稲妻がときどき光る
  if (t.flash) {
    const ph = (now % 2400) / 2400;
    if (ph < 0.12 || (ph > 0.2 && ph < 0.26)) {
      ctx.strokeStyle = 'rgba(230, 220, 255, 0.9)'; ctx.lineWidth = Math.max(0.12, 2 / P); ctx.lineJoin = 'miter';
      ctx.beginPath(); ctx.moveTo(cx - 2, box.y0 + 1); ctx.lineTo(cx - 3.2, cy); ctx.lineTo(cx - 1.4, cy); ctx.lineTo(cx - 2.8, box.y1 - 1); ctx.stroke();
    }
  }
  ctx.restore();
  // つやの帯（アクリル）
  ctx.save(); bodyPath(ctx, g); ctx.clip();
  const sh = ctx.createLinearGradient(box.x0, box.y0, box.x1, box.y1);
  sh.addColorStop(0.3, 'rgba(255,255,255,0)'); sh.addColorStop(0.4, 'rgba(255,255,255,0.3)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)');
  ctx.fillStyle = sh; ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  ctx.restore();
  bodyPath(ctx, g);
  ctx.strokeStyle = t.edge; ctx.lineWidth = Math.max(0.06, 1.5 / P); ctx.stroke();
  paintScale(ctx, g, tone === 'white' || tone === 'gray' ? 'acrylic' : 'gold', P);
}

// ---- 定規ケースのアイコン（正方形。長い定規は斜めに置いて大きく見せる） ----
// 席の色ではなく、素材の色で塗る。locked：まだ持っていない定規は影だけ
export const ICON_PL = {
  acrylic: { name: '', tint: 'rgba(70, 160, 225, 0.45)', edge: 'rgba(20, 80, 130, 0.9)', sticker: '#2f7fc0', ink: '#fff' },
  metal: { name: '', tint: 'rgba(200, 160, 60, 0.4)', edge: 'rgba(90, 70, 20, 0.9)', sticker: '#8a6510', ink: '#fff' },
  rubber: { name: '', tint: 'rgba(200, 70, 120, 0.45)', edge: 'rgba(110, 20, 60, 0.9)', sticker: '#c94a7e', ink: '#fff' },
};
export function iconRuler(canvas, look, opt = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const css = canvas.clientWidth || 80;
  canvas.width = Math.round(css * dpr);
  canvas.height = Math.round(css * dpr);
  const s = Physics.RULERS[look.specKey] || Physics.RULERS['straight30-acrylic'];
  const shapeKey = look.shapeKey || (s.forms ? s.forms[1] : s.shape);
  const g = geometry(shapeKey);
  const ang = g.sh.kind === 'rect' ? -Math.PI / 4 : g.sh.kind === 'tri' ? 0.15 : 0;
  // 重心まわりに回したときの外枠
  const c = Math.cos(ang), sn = Math.sin(ang);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of g.outer) {
    const vx = p.x - g.off.x, vy = p.y - g.off.y;
    const rx = vx * c - vy * sn, ry = vx * sn + vy * c;
    x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); y0 = Math.min(y0, ry); y1 = Math.max(y1, ry);
  }
  const fit = (look.level || 1) >= AURA_FROM ? 0.72 : 0.8;
  const P = Math.min((css * fit) / Math.max(x1 - x0, y1 - y0), 16);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(P * dpr, 0, 0, P * dpr, (css / 2) * dpr, (css / 2) * dpr);
  paintRuler(ctx, {
    owner: 0, specKey: look.specKey, shapeKey, level: opt.locked ? 1 : look.level, art: look.art, pattern: opt.locked ? null : look.pattern, sticker: opt.locked ? null : look.sticker,
    pl: ICON_PL[s.mat] || ICON_PL.acrylic, x: -(x0 + x1) / 2, y: -(y0 + y1) / 2, a: ang,
  }, P, false, 1200);
  if (opt.locked) {
    // 影だけ残す
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(28, 30, 40, 0.92)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ---- 絵柄（銘柄ごとの見た目） ----
// R＝教室の持ち物、SR＝製図用、SSR＝漆・蒔絵・金箔の工芸品。本体の形で切り抜いた中に描く（形を定義したときの座標）
// ART_BASE：地の色から塗りかえる絵柄（席の色は外のふちで見せる）。ART_INK：目盛りの色
export const matLook = (mat) => ICON_PL[mat] || ICON_PL.acrylic;
const ART_BASE = new Set(['steel', 'makie', 'karakawa', 'raden', 'urushi', 'kinpaku', 'board', 'raiun']);
const ART_INK = { makie: 'gold', karakawa: 'gold', raden: 'gold', urushi: 'gold', steel: 'metal', kinpaku: 'metal' };
function rng(seed) { let r = seed; return () => (r = (r * 16807) % 2147483647) / 2147483647; }
function fillBox(ctx, g, style) { const { box } = g; ctx.fillStyle = style; ctx.fillRect(box.x0 - 1, box.y0 - 1, box.x1 - box.x0 + 2, box.y1 - box.y0 + 2); }
// SSR のつや：ゆっくり流れる光の帯
function glint(ctx, g, now, alpha = 0.45) {
  const { box } = g;
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  const t = ((now / 2600) % 1) * 1.6 - 0.3;
  const x = box.x0 + w * t;
  const gr = ctx.createLinearGradient(x - h, box.y0, x + h * 0.4, box.y1);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${alpha})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(box.x0, box.y0, w, h);
}
const ART_PAINT = {
  plain() {},
  // SSR：雷雲（雲形定規。藍の雷雲に、ときどき光る稲妻と金の雷紋）
  raiun(ctx, g, P, now) {
    const { box } = g;
    const gr = ctx.createLinearGradient(box.x0, box.y0, box.x1, box.y1);
    gr.addColorStop(0, '#4b3fb0'); gr.addColorStop(0.55, '#2a235e'); gr.addColorStop(1, '#5a4fcf');
    fillBox(ctx, g, gr);
    ctx.fillStyle = 'rgba(200, 190, 255, 0.28)';
    for (const q of g.sh.parts || []) {
      const px = q.center.x + g.off.x, py = q.center.y + g.off.y, r = Math.sqrt(q.area / Math.PI);
      ctx.beginPath(); ctx.arc(px - 0.4 * r, py - 0.35 * r, r * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(px + 0.15 * r, py - 0.5 * r, r * 0.34, 0, Math.PI * 2); ctx.fill();
    }
    // 金の雷紋（四角いうず）を帯に
    ctx.strokeStyle = 'rgba(255, 216, 120, 0.75)'; ctx.lineWidth = Math.max(0.04, 1 / P);
    const y = box.y1 - 1.6;
    for (let x = box.x0 + 1; x < box.x1 - 1.4; x += 1.6) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1.1, y); ctx.lineTo(x + 1.1, y - 1.1); ctx.lineTo(x + 0.3, y - 1.1); ctx.lineTo(x + 0.3, y - 0.4); ctx.lineTo(x + 0.75, y - 0.4); ctx.stroke();
    }
    const ph = (now % 3000) / 3000;
    if (ph < 0.08) {
      const cx = (box.x0 + box.x1) / 2;
      ctx.strokeStyle = 'rgba(255, 246, 200, 0.95)'; ctx.lineWidth = Math.max(0.1, 2 / P);
      ctx.beginPath(); ctx.moveTo(cx + 1, box.y0 + 0.8); ctx.lineTo(cx - 0.6, box.y0 + 4); ctx.lineTo(cx + 0.8, box.y0 + 4); ctx.lineTo(cx - 0.8, box.y0 + 7.5); ctx.stroke();
    }
    glint(ctx, g, now, 0.3);
  },
  // 黒板用の大きな定規（担任の先生）：木の地と、真ん中の取っ手
  board(ctx, g, P) {
    const { box } = g;
    const gr = ctx.createLinearGradient(box.x0, box.y0, box.x0, box.y1);
    gr.addColorStop(0, '#e6c48a'); gr.addColorStop(0.5, '#d4ad6c'); gr.addColorStop(1, '#c69c5c');
    fillBox(ctx, g, gr);
    ctx.strokeStyle = 'rgba(120, 80, 30, 0.25)'; ctx.lineWidth = Math.max(0.02, 0.6 / P);
    const h = box.y1 - box.y0;
    for (let k = 1; k < 5; k++) { ctx.beginPath(); for (let x = box.x0; x <= box.x1; x += 1) { const y = box.y0 + h * k / 5 + Math.sin(x * 0.3 + k) * 0.12; if (x === box.x0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke(); }
    // 取っ手
    const cx = (box.x0 + box.x1) / 2, cy = box.y0 + h * 0.62;
    ctx.fillStyle = 'rgba(60, 40, 20, 0.35)'; roundRect(ctx, cx - 3.2 + 0.2, cy - 0.9 + 0.25, 6.4, 1.8, 0.9); ctx.fill();
    ctx.fillStyle = '#7a5530'; roundRect(ctx, cx - 3.2, cy - 0.9, 6.4, 1.8, 0.9); ctx.fill();
    ctx.fillStyle = 'rgba(255, 230, 190, 0.35)'; roundRect(ctx, cx - 2.6, cy - 0.7, 5.2, 0.5, 0.25); ctx.fill();
  },
  // R：名前シール（白い名前欄に手書きの線）
  namesticker(ctx, g, P) {
    const { box } = g;
    const h = (box.y1 - box.y0) * 0.62, w = Math.min(7, (box.x1 - box.x0) * 0.24);
    const x = box.x0 + (box.x1 - box.x0) * 0.56, y = (box.y0 + box.y1) / 2 - h / 2;
    ctx.fillStyle = 'rgba(255, 255, 250, 0.95)';
    roundRect(ctx, x, y, w, h, 0.3); ctx.fill();
    ctx.strokeStyle = 'rgba(200, 60, 60, 0.7)'; ctx.lineWidth = Math.max(0.04, 0.8 / P); ctx.stroke();
    ctx.strokeStyle = 'rgba(30, 40, 90, 0.75)'; ctx.lineWidth = Math.max(0.06, 1.2 / P);
    ctx.beginPath();
    for (let k = 0; k < 4; k++) { const cx = x + w * (0.2 + k * 0.19); ctx.moveTo(cx - 0.35, y + h * 0.65); ctx.quadraticCurveTo(cx, y + h * 0.15, cx + 0.4, y + h * 0.6); }
    ctx.stroke();
  },
  // R：筆箱サイズ（はしに丸い穴とラベル）
  pencase(ctx, g, P) {
    const { box } = g;
    const cy = (box.y0 + box.y1) / 2, x = box.x0 + 1.1, r = Math.min(0.45, (box.y1 - box.y0) * 0.18);
    ctx.fillStyle = 'rgba(30, 30, 40, 0.55)'; ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = Math.max(0.04, 0.8 / P); ctx.stroke();
    ctx.fillStyle = 'rgba(255, 210, 63, 0.85)';
    roundRect(ctx, box.x0 + (box.x1 - box.x0) * 0.35, box.y0 + 0.25, (box.x1 - box.x0) * 0.22, (box.y1 - box.y0) * 0.32, 0.15); ctx.fill();
  },
  // R：インク汚れ
  inkstain(ctx, g) {
    const { box } = g;
    const rnd = rng(31);
    ctx.fillStyle = 'rgba(30, 60, 170, 0.55)';
    for (let k = 0; k < 5; k++) {
      const x = box.x0 + (0.2 + rnd() * 0.6) * (box.x1 - box.x0), y = box.y0 + rnd() * (box.y1 - box.y0), r = 0.3 + rnd() * 0.9;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.4, r, rnd() * 3, 0, Math.PI * 2); ctx.fill();
      for (let j = 0; j < 4; j++) { ctx.beginPath(); ctx.arc(x + (rnd() - 0.5) * 3, y + (rnd() - 0.5) * 2, 0.08 + rnd() * 0.18, 0, Math.PI * 2); ctx.fill(); }
    }
  },
  // R：2色目盛り（辺に沿って赤と青の帯）
  twotone(ctx, g, P) {
    ctx.lineWidth = 0.7;
    const v = g.outer;
    for (let i = 0; i < v.length; i++) {
      const a = v[i], q = v[(i + 1) % v.length], n = g.normals[i];
      ctx.strokeStyle = i % 2 ? 'rgba(220, 60, 50, 0.45)' : 'rgba(40, 110, 220, 0.45)';
      ctx.beginPath(); ctx.moveTo(a.x - n.x * 0.4, a.y - n.y * 0.4); ctx.lineTo(q.x - n.x * 0.4, q.y - n.y * 0.4); ctx.stroke();
    }
  },
  // R：キャラ柄（顔と星）
  character(ctx, g) {
    const { box } = g;
    const cx = box.x0 + (box.x1 - box.x0) * 0.24, cy = box.y1 - (box.y1 - box.y0) * 0.24, r = Math.min(1.5, (box.y1 - box.y0) * 0.15);
    ctx.fillStyle = '#ffe07a'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a2a20';
    ctx.beginPath(); ctx.arc(cx - r * 0.35, cy - r * 0.15, r * 0.12, 0, Math.PI * 2); ctx.arc(cx + r * 0.35, cy - r * 0.15, r * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a2a20'; ctx.lineWidth = r * 0.1;
    ctx.beginPath(); ctx.arc(cx, cy + r * 0.1, r * 0.4, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.fillStyle = 'rgba(255, 140, 170, 0.8)';
    ctx.beginPath(); ctx.arc(cx - r * 0.6, cy + r * 0.25, r * 0.15, 0, Math.PI * 2); ctx.arc(cx + r * 0.6, cy + r * 0.25, r * 0.15, 0, Math.PI * 2); ctx.fill();
    const rnd = rng(5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (let k = 0; k < 6; k++) { star(ctx, box.x0 + rnd() * (box.x1 - box.x0), box.y0 + rnd() * (box.y1 - box.y0), 0.35 + rnd() * 0.3); ctx.fill(); }
  },
  // R：カラー（虹色の帯）
  colorful(ctx, g) {
    const { box } = g;
    const gr = ctx.createLinearGradient(box.x0, 0, box.x1, 0);
    ['#ff6b6b', '#ffb84d', '#ffe66d', '#7bd389', '#5ab8ff', '#a78bfa'].forEach((c, i, a) => gr.addColorStop(i / (a.length - 1), c));
    ctx.globalAlpha *= 0.45;
    fillBox(ctx, g, gr);
  },
  // SR：方眼（1mmと5mmの細かい方眼）
  grid(ctx, g, P) {
    const { box } = g;
    for (const [step, a] of [[0.1, 0.12], [0.5, 0.3]]) {
      if (step * P < 2.5) continue;
      ctx.strokeStyle = `rgba(20, 80, 60, ${a})`; ctx.lineWidth = Math.max(0.01, 0.6 / P);
      ctx.beginPath();
      for (let x = Math.ceil(box.x0 / step) * step; x <= box.x1; x += step) { ctx.moveTo(x, box.y0); ctx.lineTo(x, box.y1); }
      for (let y = Math.ceil(box.y0 / step) * step; y <= box.y1; y += step) { ctx.moveTo(box.x0, y); ctx.lineTo(box.x1, y); }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40, 170, 120, 0.12)'; fillBox(ctx, g, ctx.fillStyle);
  },
  // SR：ステンレス（つや消しの銀と、面取りの影）
  steel(ctx, g, P) {
    const { box } = g;
    const gr = ctx.createLinearGradient(box.x0, box.y0, box.x0, box.y1);
    gr.addColorStop(0, '#f4f6f8'); gr.addColorStop(0.5, '#c3c9d0'); gr.addColorStop(1, '#e8ebee');
    fillBox(ctx, g, gr);
    const rnd = rng(9);
    ctx.lineWidth = Math.max(0.01, 0.5 / P);
    for (let y = box.y0; y < box.y1; y += 0.08) { ctx.strokeStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.4)' : 'rgba(80,90,100,0.08)'; ctx.beginPath(); ctx.moveTo(box.x0, y); ctx.lineTo(box.x1, y); ctx.stroke(); }
  },
  // SR：すべり止め（ふちに沿ってコルクの点）
  nonslip(ctx, g) {
    ctx.fillStyle = 'rgba(150, 100, 50, 0.75)';
    const v = g.outer;
    for (let i = 0; i < v.length; i++) {
      const a = v[i], q = v[(i + 1) % v.length], n = g.normals[i];
      const len = Math.hypot(q.x - a.x, q.y - a.y);
      for (let d = 1; d < len - 0.6; d += 1.6) {
        const t = d / len;
        ctx.beginPath(); ctx.arc(a.x + (q.x - a.x) * t - n.x * 0.55, a.y + (q.y - a.y) * t - n.y * 0.55, 0.28, 0, Math.PI * 2); ctx.fill();
      }
    }
  },
  // SR：製図三角（緑がかった地と、内側の面取り線）
  drafting(ctx, g, P) {
    ctx.fillStyle = 'rgba(60, 190, 140, 0.28)'; fillBox(ctx, g, ctx.fillStyle);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'; ctx.lineWidth = Math.max(0.05, 1.1 / P);
    ctx.beginPath(); addPoly(ctx, insetPolygon(g.outer, g.normals, 0.45)); ctx.stroke();
  },
  // SR：全円目盛り（中心の十字と、放射状の細い線）
  fullcircle(ctx, g, P) {
    ctx.strokeStyle = 'rgba(20, 30, 50, 0.4)'; ctx.lineWidth = Math.max(0.02, 0.6 / P);
    const R = g.sh.R || 7;
    ctx.beginPath();
    for (let k = 0; k < 36; k++) { const t = Math.PI + (k / 36) * Math.PI; ctx.moveTo(Math.cos(t) * R * 0.3, Math.sin(t) * R * 0.3); ctx.lineTo(Math.cos(t) * R * 0.62, Math.sin(t) * R * 0.62); }
    ctx.moveTo(-1, 0); ctx.lineTo(1, 0); ctx.moveTo(0, -1); ctx.lineTo(0, 0.6);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(200, 40, 40, 0.6)'; ctx.beginPath(); ctx.arc(0, 0, R * 0.25, Math.PI, Math.PI * 2); ctx.stroke();
  },
  // SSR：金蒔絵（黒漆に金の流水と梅、金粉）
  makie(ctx, g, P, now) {
    const { box } = g;
    fillBox(ctx, g, '#16110e');
    const gold = ctx.createLinearGradient(box.x0, box.y0, box.x1, box.y1);
    gold.addColorStop(0, '#f6d77a'); gold.addColorStop(0.5, '#c8962c'); gold.addColorStop(1, '#ffe9a8');
    ctx.strokeStyle = gold; ctx.lineWidth = Math.max(0.08, 1.4 / P);
    const h = box.y1 - box.y0;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      for (let x = box.x0; x <= box.x1; x += 0.4) { const y = box.y0 + h * (0.3 + k * 0.2) + Math.sin(x * 0.7 + k) * h * 0.12; if (x === box.x0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.fillStyle = gold;
    for (const fx of [0.3, 0.72]) { const cx = box.x0 + (box.x1 - box.x0) * fx, cy = box.y0 + h * 0.5; for (let p = 0; p < 5; p++) { const t = (p / 5) * Math.PI * 2; ctx.beginPath(); ctx.arc(cx + Math.cos(t) * h * 0.14, cy + Math.sin(t) * h * 0.14, h * 0.1, 0, Math.PI * 2); ctx.fill(); } }
    const rnd = rng(77);
    for (let k = 0; k < 60; k++) { ctx.globalAlpha = 0.4 + rnd() * 0.5; ctx.fillRect(box.x0 + rnd() * (box.x1 - box.x0), box.y0 + rnd() * h, 0.08, 0.08); }
    ctx.globalAlpha = 1;
    glint(ctx, g, now, 0.25);
  },
  // SSR：金唐革（深い赤茶の革に、金の唐草を浮き出し）
  karakawa(ctx, g, P, now) {
    const { box } = g;
    fillBox(ctx, g, '#5a1f14');
    ctx.strokeStyle = '#d9a83c'; ctx.lineWidth = Math.max(0.07, 1.2 / P);
    const h = box.y1 - box.y0;
    for (let x = box.x0 + 1; x < box.x1; x += 2.6) {
      ctx.beginPath();
      ctx.arc(x, box.y0 + h * 0.5, h * 0.28, Math.PI * 0.2, Math.PI * 1.7);
      ctx.moveTo(x + h * 0.3, box.y0 + h * 0.5);
      ctx.arc(x + h * 0.55, box.y0 + h * 0.5, h * 0.18, Math.PI, Math.PI * 2.6);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(box.x0, box.y1 - h * 0.18, box.x1 - box.x0, h * 0.18);
    glint(ctx, g, now, 0.2);
  },
  // SSR：螺鈿（黒い地に、虹色に光る貝の小片）
  raden(ctx, g, P, now) {
    const { box } = g;
    fillBox(ctx, g, '#0f1420');
    const rnd = rng(13);
    const shift = (now / 30) % 360;
    for (let k = 0; k < 70; k++) {
      const x = box.x0 + rnd() * (box.x1 - box.x0), y = box.y0 + rnd() * (box.y1 - box.y0), r = 0.25 + rnd() * 0.7;
      ctx.fillStyle = `hsla(${(rnd() * 360 + shift) % 360}, 70%, 78%, ${0.55 + rnd() * 0.35})`;
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.9, y + r * 0.2); ctx.lineTo(x - r * 0.3, y + r); ctx.closePath(); ctx.fill();
    }
    glint(ctx, g, now, 0.3);
  },
  // SSR：朱漆（深い朱に、つやの光）
  urushi(ctx, g, P, now) {
    const { box } = g;
    const gr = ctx.createLinearGradient(box.x0, box.y0, box.x1, box.y1);
    gr.addColorStop(0, '#d8402a'); gr.addColorStop(0.5, '#a8231a'); gr.addColorStop(1, '#c9341f');
    fillBox(ctx, g, gr);
    ctx.strokeStyle = 'rgba(20, 8, 6, 0.85)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); addPoly(ctx, g.outer); ctx.stroke();
    glint(ctx, g, now, 0.4);
  },
  // SSR：金箔（少しずつ色の違う金の四角を貼り重ねる）
  kinpaku(ctx, g, P, now) {
    const { box } = g;
    const rnd = rng(21);
    const s = 1.3;
    for (let x = box.x0; x < box.x1; x += s) for (let y = box.y0; y < box.y1; y += s) {
      ctx.fillStyle = `hsl(${42 + rnd() * 8}, ${70 + rnd() * 15}%, ${55 + rnd() * 14}%)`;
      ctx.fillRect(x + (rnd() - 0.5) * 0.2, y + (rnd() - 0.5) * 0.2, s + 0.15, s + 0.15);
    }
    ctx.strokeStyle = 'rgba(120, 80, 10, 0.25)'; ctx.lineWidth = Math.max(0.02, 0.5 / P);
    for (let x = box.x0; x < box.x1; x += s) { ctx.beginPath(); ctx.moveTo(x, box.y0); ctx.lineTo(x, box.y1); ctx.stroke(); }
    glint(ctx, g, now, 0.45);
  },
};
