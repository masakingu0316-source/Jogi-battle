// 盤面（机・定規・狙いの矢印・落下の文字）を canvas に描く
import { paintRuler } from './ruler-paint.js';
import { DESKS, PLAYERS } from './shared/rules.js';
import Physics from './shared/physics.js';

const MARGIN = 9; // 机のまわりに見せる床（cm）
export const MAX_DRAG = 11; // これ以上引っぱっても力は最大のまま（cm）

// opt.below(): 盤面の下に残す高さ（px）。画面の高さから盤面の上の位置とこれを引いた高さに収める
export function createBoard(canvas, wrap, opt = {}) {
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
    // 盤面の上（名前の札・手番の表示）と下（ボタンの列）を除いた高さに収めて、上下に動かさずに遊べるようにする
    const top = wrap.getBoundingClientRect().top + window.scrollY;
    const below = opt.below ? opt.below() : 60;
    const visible = wrap.offsetParent !== null;
    const maxH = Math.max(140, window.innerHeight - (visible ? top : 290) - below - 2);
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

  // 床の色は画面のテーマ（明るい／暗い）に合わせて style.css から読む
  let theme = null;
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fb) => cs.getPropertyValue(name).trim() || fb;
    theme = { floor: v('--floor', '#c9d0db'), line: v('--floor-line', 'rgba(28,39,71,0.12)'), ink: v('--floor-ink', '#2d3756') };
  }
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', readTheme);
  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // bodies: [{ owner, specKey, x, y, a, alpha, scale }]
  // desks: { left: 残っている机の番号（null なら全部）, warn: 消える予告の机, fade: { i, t } 消えている途中の机 }
  function draw({ bodies, active, aim, fx, now, desks = {} }) {
    const { dpr } = view;
    if (!theme) readTheme();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.floor;
    ctx.fillRect(0, 0, view.w, view.h);
    setWorldTransform();
    const px = view.s;

    // 教室の床（30cm角のタイル）
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1.2 / px;
    ctx.beginPath();
    for (let x = -255; x <= 255; x += 30) { ctx.moveTo(x, -255); ctx.lineTo(x, 255); }
    for (let y = -255; y <= 255; y += 30) { ctx.moveTo(-255, y); ctx.lineTo(255, y); }
    ctx.stroke();

    // 天板（くっつけた机は1台ずつ描き、継ぎ目を見せる）
    const dw = desk.w, dh = desk.h;
    const left = desks.left || panels.map((_, i) => i);
    const fade = desks.fade || null;
    const shown = panels.map((pn, i) => ({ pn, i })).filter(({ i }) => left.includes(i) || fade?.i === i);
    const full = shown.length === panels.length && !fade;
    // 消えていく机は、少し縮みながら薄くなる
    const enter = (i) => {
      if (fade?.i !== i) return;
      const pn = panels[i], k = 1 - 0.12 * fade.t;
      ctx.globalAlpha = 1 - fade.t;
      ctx.translate(pn.x + pn.w / 2, pn.y + pn.h / 2 + fade.t * 2);
      ctx.scale(k, k);
      ctx.translate(-(pn.x + pn.w / 2), -(pn.y + pn.h / 2));
    };
    const shadowOn = () => {
      ctx.shadowColor = 'rgba(20, 28, 50, 0.35)';
      ctx.shadowBlur = 16 * dpr;
      ctx.shadowOffsetY = 5 * dpr;
    };
    if (full) {
      ctx.save(); shadowOn();
      roundRect(-dw / 2, -dh / 2, dw, dh, 1.4);
      ctx.fillStyle = '#d9bb8f';
      ctx.fill();
      ctx.restore();
    } else {
      for (const { pn, i } of shown) {
        ctx.save(); enter(i); shadowOn();
        roundRect(pn.x, pn.y, pn.w, pn.h, 1.4);
        ctx.fillStyle = '#d9bb8f';
        ctx.fill();
        ctx.restore();
      }
    }
    for (const { pn, i } of shown) {
      ctx.save();
      enter(i);
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
      // 消える予告：赤い斜線が点滅する
      if (desks.warn === i || fade?.i === i) {
        const pulse = fade?.i === i ? 1 : 0.55 + 0.45 * Math.sin(now / 220);
        ctx.globalAlpha *= 0.32 * pulse + 0.12;
        ctx.strokeStyle = '#d8342a';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (let d = -pn.h; d < pn.w; d += 3.2) { ctx.moveTo(pn.x + d, pn.y + pn.h); ctx.lineTo(pn.x + d + pn.h, pn.y); }
        ctx.stroke();
      }
      ctx.restore();
      roundRect(pn.x + 0.35, pn.y + 0.35, pn.w - 0.7, pn.h - 0.7, 1.1);
      const warn = desks.warn === i;
      ctx.strokeStyle = warn ? '#d8342a' : 'rgba(110, 72, 40, 0.55)';
      ctx.lineWidth = warn ? 0.9 : 0.7;
      if (warn) ctx.setLineDash([1.6, 1.0]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 場のイベント：こおり（机が凍る）・いす（辺に椅子が並ぶ）
    if (desks.event?.type === 'ice' || desks.icy) drawIce(shown.map((x) => x.pn), now);
    if (desks.event?.type === 'chair') drawChairs(desks.event.wall, now);
    for (const w of desks.walls || []) drawChairs(w, now);

    // 予告の机に「消える」の札（画面の向きに合わせて文字は立てる）
    if (desks.warn !== null && desks.warn !== undefined && panels[desks.warn]) {
      // 定規と重なりにくいよう、画面で見たときの机の上の辺に寄せる
      const pn = panels[desks.warn];
      const a = toScreen(pn.x, pn.y), b = toScreen(pn.x + pn.w, pn.y + pn.h);
      const sp = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) + 18 };
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = '700 15px "BIZ UDPGothic", system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const txt = (desks.warnIn ?? 1) <= 1 ? 'この番のあと消える' : `あと${desks.warnIn}人の番で消える`;
      const tw = ctx.measureText(txt).width + 18;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#c73e2b';
      roundRect(sp.x - tw / 2, sp.y - 13, tw, 26, 13);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(txt, sp.x, sp.y + 1);
      ctx.restore();
      setWorldTransform();
    }

    // 寸法線
    const dimY = dh / 2 + 3.2;
    ctx.strokeStyle = theme.ink;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.2 / px;
    ctx.beginPath();
    ctx.moveTo(-dw / 2, dimY); ctx.lineTo(dw / 2, dimY);
    ctx.moveTo(-dw / 2, dimY - 0.9); ctx.lineTo(-dw / 2, dimY + 0.9);
    ctx.moveTo(dw / 2, dimY - 0.9); ctx.lineTo(dw / 2, dimY + 0.9);
    ctx.stroke();
    ctx.globalAlpha = 1;

    for (const b of bodies) {
      if (b.alpha <= 0) continue;
      drawRuler(b, px, b.owner === active && !aim, now);
    }
    if (aim) drawAim(aim, px);

    // 画面座標で描く文字
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lp = toScreen(0, dimY);
    const label = desks.label || (left.length < panels.length ? `机 残り${left.length}台` : `机${desk.name}　${desk.w} × ${desk.h} cm`);
    ctx.font = '400 12px "BIZ UDPGothic", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width + 10;
    ctx.save();
    ctx.translate(lp.x, lp.y);
    if (view.rot) ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = theme.floor; ctx.fillRect(-tw / 2, -8, tw, 16);
    ctx.fillStyle = theme.ink; ctx.fillText(label, 0, 0);
    ctx.restore();

    // 盤面の定規ごとの体力（画面の向きに関係なく、定規のすぐ上に横向きで）
    drawHpTags(bodies, aim, now);

    for (const f of fx) {
      const t = (now - f.t0) / 1600;
      if (t < 0 || t > 1) continue;
      const p = toScreen(f.x, f.y);
      if (f.ring) {
        // 突風：風の輪が広がる（半径は実際に届く距離）
        const rt = Math.min(1, (now - f.t0) / 900);
        if (rt >= 1) continue;
        ctx.save();
        setWorldTransform();
        for (const [k, w] of [[1, 1], [0.72, 0.6], [0.45, 0.35]]) {
          ctx.globalAlpha = (1 - rt) * w;
          ctx.strokeStyle = f.color;
          ctx.lineWidth = Math.max(0.25, 5 / view.s) * (1.4 - rt);
          const grow = f.inward ? 1 - 0.75 * Math.sqrt(rt) : 0.25 + 0.75 * Math.sqrt(rt);
        ctx.beginPath(); ctx.arc(f.x, f.y, Math.max(0.1, f.ring * k * grow), 0, Math.PI * 2); ctx.stroke();
        }
        // 風の筋
        ctx.globalAlpha = (1 - rt) * 0.8;
        ctx.lineWidth = Math.max(0.15, 2.5 / view.s);
        ctx.beginPath();
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2 + rt * 0.8;
          const r0 = f.ring * (0.15 + 0.6 * rt), r1 = r0 + f.ring * 0.22;
          ctx.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0);
          ctx.quadraticCurveTo(f.x + Math.cos(a + 0.25) * (r0 + r1) / 2, f.y + Math.sin(a + 0.25) * (r0 + r1) / 2, f.x + Math.cos(a + 0.1) * r1, f.y + Math.sin(a + 0.1) * r1);
        }
        ctx.stroke();
        ctx.restore();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        continue;
      }
      if (f.burst) {
        // クリティカルの光：放射状の線が広がって消える
        const bt = Math.min(1, (now - f.t0) / 520);
        if (bt >= 1) continue;
        ctx.save();
        ctx.globalAlpha = 1 - bt;
        ctx.strokeStyle = '#ffe27a';
        ctx.lineWidth = 3.5 * (1 - bt) + 1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2 + 0.2;
          const r0 = 8 + bt * 26, r1 = r0 + 14 * (1 - bt) + 6;
          ctx.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0);
          ctx.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1);
        }
        ctx.stroke();
        ctx.globalAlpha = (1 - bt) * 0.6;
        ctx.fillStyle = '#fff6c8';
        ctx.beginPath(); ctx.arc(p.x, p.y, 10 * (1 - bt) + 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        continue;
      }
      // 画面からはみ出さないよう、文字の幅に合わせて寄せる
      const size = f.big ? Math.min(36, view.w / 9) : f.small ? Math.min(22, view.w / 14) : Math.min(28, view.w / 11);
      ctx.font = `400 ${size}px "Yuji Mai", "Yuji Syuku", "BIZ UDPGothic", serif`;
      const half = ctx.measureText(f.text).width / 2 + 8;
      const x = Math.max(half, Math.min(view.w - half, p.x));
      const y = Math.max(24, Math.min(view.h - 24, p.y)) - t * 18;
      ctx.globalAlpha = 1 - t * t;
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(30, 24, 20, 0.85)';
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.color; ctx.fillText(f.text, x, y);
      ctx.globalAlpha = 1;
    }
  }

  function drawRuler(b, px, active, now) { paintRuler(ctx, b, px, active, now); }

  // 体力の札：[席の色の印｜バー｜数字] の小さな札を、定規の画面上の外枠のすぐ上（上が狭ければ下）に置く
  // 盤面を隠しすぎないよう小さく半透明にし、狙っている自分の定規の札はさらに薄くする
  const tagSide = new Map();
  function drawHpTags(bodies, aim, now) {
    const small = view.w < 520;
    const W = small ? 64 : 72, H = small ? 15 : 16, barW = small ? 24 : 30;
    // まず全部の定規の画面上の外枠を出す
    const items = [];
    for (const b of bodies) {
      if ((b.alpha ?? 1) < 0.35 || b.hp === undefined) continue;
      const spec = Physics.RULERS[b.specKey];
      const sh = spec && Physics.SHAPES[b.shapeKey || Physics.shapeOf(b.specKey, b.hp, b.maxHp)];
      if (!sh) continue;
      const c = Math.cos(b.a), sn = Math.sin(b.a), k = b.scale ?? 1;
      let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
      for (const v of sh.verts) {
        const p = toScreen(b.x + (v.x * c - v.y * sn) * k, b.y + (v.x * sn + v.y * c) * k);
        top = Math.min(top, p.y); bottom = Math.max(bottom, p.y); left = Math.min(left, p.x); right = Math.max(right, p.x);
      }
      items.push({ b, box: { x0: left, y0: top, x1: right, y1: bottom } });
    }
    // 札の置き場所：上・下・左・右の候補から、ほかの札や定規と重なりにくく、画面からはみ出さない所を選ぶ
    const overlap = (a, q) => Math.max(0, Math.min(a.x1, q.x1) - Math.max(a.x0, q.x0)) * Math.max(0, Math.min(a.y1, q.y1) - Math.max(a.y0, q.y0));
    const placed = [];
    for (const { b, box } of items) {
      const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
      const cands = [
        { x: cx - W / 2, y: box.y0 - H - 5, pref: 0 },
        { x: cx - W / 2, y: box.y1 + 5, pref: 1 },
        { x: box.x1 + 6, y: cy - H / 2, pref: 2 },
        { x: box.x0 - W - 6, y: cy - H / 2, pref: 2 },
      ];
      let best = null, bestScore = Infinity, bestK = 0;
      for (const [k, cd] of cands.entries()) {
        const r = { x0: cd.x, y0: cd.y, x1: cd.x + W, y1: cd.y + H };
        // 前のコマと同じ場所を少しひいきして、動いている間に札がぱたぱた移らないようにする
        let sc = cd.pref * 40 - (tagSide.get(b.owner) === k ? 60 : 0);
        if (r.x0 < 4 || r.y0 < 4 || r.x1 > view.w - 4 || r.y1 > view.h - 4) sc += 5000;
        for (const q of placed) sc += overlap(r, q) * 10;
        for (const it of items) sc += overlap(r, it.box) * (it.b === b ? 3 : 1);
        if (sc < bestScore) { bestScore = sc; best = r; bestK = k; }
      }
      tagSide.set(b.owner, bestK);
      const x = Math.max(4, Math.min(view.w - W - 4, best.x0));
      const y = Math.max(4, Math.min(view.h - H - 4, best.y0));
      placed.push({ x0: x, y0: y, x1: x + W, y1: y + H });
      const hp = Math.max(0, Math.round(b.hp));
      const pct = Math.max(0, Math.min(100, (b.hp / (b.maxHp || 100)) * 100));
      const mine = aim && b.owner === aim.owner;
      ctx.save();
      ctx.globalAlpha = (b.alpha ?? 1) * (mine ? 0.45 : 0.92);
      // 台
      ctx.fillStyle = 'rgba(22, 26, 44, 0.78)';
      roundRect(x, y, W, H, H / 2);
      ctx.fill();
      if (pct <= 30) {
        ctx.strokeStyle = `rgba(255, 110, 90, ${0.55 + 0.45 * Math.sin(now / 200)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // 席の色の印
      ctx.fillStyle = b.tagColor || PLAYERS[b.owner]?.color || '#fff';
      ctx.beginPath(); ctx.arc(x + H / 2, y + H / 2, H / 2 - 4, 0, Math.PI * 2); ctx.fill();
      // バー
      const bx = x + H - 1, by = y + H / 2 - 3;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      roundRect(bx, by, barW, 6, 3); ctx.fill();
      ctx.fillStyle = pct > 60 ? '#4cd17c' : pct > 30 ? '#f2c14e' : '#ff6a55';
      if (hp > 0) { roundRect(bx, by, Math.max(4, barW * pct / 100), 6, 3); ctx.fill(); }
      // 数字
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${small ? 10 : 11}px "BIZ UDPGothic", system-ui, sans-serif`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(String(hp), x + W - 5, y + H / 2 + 0.5);
      ctx.restore();
    }
  }

  // こおり：天板に薄い氷の膜と、光の筋・霜の粒
  function drawIce(list, now) {
    for (const pn of list) {
      ctx.save();
      roundRect(pn.x, pn.y, pn.w, pn.h, 1.4);
      ctx.clip();
      ctx.fillStyle = 'rgba(165, 218, 252, 0.62)';
      ctx.fillRect(pn.x, pn.y, pn.w, pn.h);
      // ゆっくり流れる光の筋
      const shift = ((now / 60) % 40);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let d = -pn.h - 40 + shift; d < pn.w; d += 40) {
        ctx.moveTo(pn.x + d, pn.y + pn.h); ctx.lineTo(pn.x + d + pn.h * 0.6, pn.y);
        ctx.moveTo(pn.x + d + 4, pn.y + pn.h); ctx.lineTo(pn.x + d + 4 + pn.h * 0.6, pn.y);
      }
      ctx.stroke();
      // 霜の粒（毎回同じ場所）
      let seed = Math.abs(Math.round(pn.x * 7 + pn.y * 13)) + 99;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      for (let k = 0; k < 60; k++) {
        ctx.beginPath(); ctx.arc(pn.x + rnd() * pn.w, pn.y + rnd() * pn.h, 0.15 + rnd() * 0.25, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      roundRect(pn.x + 0.35, pn.y + 0.35, pn.w - 0.7, pn.h - 0.7, 1.1);
      ctx.strokeStyle = 'rgba(120, 190, 235, 0.9)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }

  // いす：辺の外側に学校の椅子を並べる（背もたれが机の辺に接する）。外向きを +x として描く
  function drawChairs(wl, now) {
    if (!wl) return;
    const len = wl.hi - wl.lo;
    const n = Math.max(1, Math.round(len / 42));
    const cw = (len / n) * 0.86;
    ctx.save();
    // 落ちない辺を、黄色の太い線で示す
    const ang = Math.atan2(wl.ny, wl.nx);
    const base = (c) => (wl.nx !== 0 ? { x: wl.nx * wl.d, y: c } : { x: c, y: wl.ny * wl.d });
    const a0 = base(wl.lo), a1 = base(wl.hi);
    ctx.strokeStyle = `rgba(240, 190, 40, ${0.65 + 0.25 * Math.sin(now / 300)})`;
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.stroke();
    for (let k = 0; k < n; k++) {
      const c = wl.lo + (len / n) * (k + 0.5);
      const p = base(c);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);
      // 座面（床の上、外側）
      ctx.fillStyle = 'rgba(30, 30, 40, 0.18)';
      ctx.fillRect(1.6, -cw / 2 + 1.2, 34, cw);
      ctx.fillStyle = '#d8b27c';
      roundRect(4.2, -cw / 2 + 1.5, 30, cw - 3, 2.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 80, 40, 0.5)'; ctx.lineWidth = 0.4; ctx.stroke();
      // 鉄のパイプ
      ctx.strokeStyle = '#8b96a5'; ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(1.2, -cw / 2 + 1); ctx.lineTo(35, -cw / 2 + 1);
      ctx.moveTo(1.2, cw / 2 - 1); ctx.lineTo(35, cw / 2 - 1);
      ctx.stroke();
      // 背もたれ（机の辺のすぐ外）
      ctx.fillStyle = '#b9824a';
      roundRect(0.4, -cw / 2, 3.0, cw, 1.2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(90, 55, 25, 0.7)'; ctx.lineWidth = 0.4; ctx.stroke();
      ctx.restore();
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
    const col = a.skill ? a.skill.color : `hsl(${50 - power * 45}, 95%, 62%)`;
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
    ctx.font = '700 14px "BIZ UDPGothic", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const txt = a.skill ? `${a.skill.name}　力 ${Math.round(power * 100)}%` : `力 ${Math.round(power * 100)}%`;
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
