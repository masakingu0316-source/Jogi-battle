// 盤面（机・定規・狙いの矢印・落下の文字）を canvas に描く
import { paintRuler } from './ruler-paint.js';
import { DESKS, PLAYERS, SKILL_TUNE } from './shared/rules.js';
import Physics from './shared/physics.js';

const MARGIN = 9; // 机のまわりに見せる床（cm）
export const MAX_DRAG = 11; // これ以上引っぱっても力は最大のまま（cm）

// opt.below(): 盤面の下に残す高さ（px）。画面の高さから盤面の上の位置とこれを引いた高さに収める
export function createBoard(canvas, wrap, opt = {}) {
  const ctx = canvas.getContext('2d');
  const view = { s: 10, rot: false, cx: 0, cy: 0, w: 0, h: 0, dpr: 1 };
  // 手元カメラ：盤面の拡大（z 倍）と、ずらし（画面の px）。2本指で操作する
  const cam = { z: 1, x: 0, y: 0 };
  const CAM_MAX = 3;
  // カメラを入れた見え方（拡大率と中心）
  const eff = () => ({ s: view.s * cam.z, cx: view.cx + cam.x, cy: view.cy + cam.y });
  function clampCam() {
    cam.z = Math.min(CAM_MAX, Math.max(1, cam.z));
    const mx = (view.w * (cam.z - 1)) / 2, my = (view.h * (cam.z - 1)) / 2;
    cam.x = Math.min(mx, Math.max(-mx, cam.x));
    cam.y = Math.min(my, Math.max(-my, cam.y));
    if (cam.z === 1) { cam.x = 0; cam.y = 0; }
  }
  // 画面の (sx, sy)（盤面の左上から）を中心に k 倍し、(dx, dy) ずらす
  function camMove(k, sx, sy, dx = 0, dy = 0) {
    const z2 = Math.min(CAM_MAX, Math.max(1, cam.z * k));
    const r = z2 / cam.z;
    cam.x = sx - view.cx - (sx - view.cx - cam.x) * r + dx;
    cam.y = sy - view.cy - (sy - view.cy - cam.y) * r + dy;
    cam.z = z2;
    clampCam();
  }
  function camReset() { cam.z = 1; cam.x = 0; cam.y = 0; }
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
    const top = wrap.getBoundingClientRect().top;
    const below = opt.below ? opt.below() : 60;
    const visible = wrap.offsetParent !== null;
    const bottom = visible && opt.bottom ? opt.bottom() : window.innerHeight;
    const maxH = Math.max(140, bottom - (visible ? top : 290) - below - 2);
    const s = Math.min(cssW / vw, maxH / vh);
    const cssH = Math.round(vh * s);
    canvas.style.height = cssH + 'px';
    view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(cssW * view.dpr);
    canvas.height = Math.round(cssH * view.dpr);
    Object.assign(view, { s, rot, cx: cssW / 2, cy: cssH / 2, w: cssW, h: cssH });
    clampCam();
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
    const { rot, dpr } = view;
    const { s, cx, cy } = eff();
    if (rot) ctx.setTransform(0, s * dpr, -s * dpr, 0, cx * dpr, cy * dpr);
    else ctx.setTransform(s * dpr, 0, 0, s * dpr, cx * dpr, cy * dpr);
  }
  function toScreen(x, y) {
    const { s, cx, cy } = eff();
    return view.rot ? { x: cx - s * y, y: cy + s * x } : { x: cx + s * x, y: cy + s * y };
  }
  function toWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const sx = clientX - r.left, sy = clientY - r.top;
    const { s, cx, cy } = eff();
    return view.rot ? { x: (sy - cy) / s, y: (cx - sx) / s } : { x: (sx - cx) / s, y: (sy - cy) / s };
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
    const px = eff().s;

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

    // 場のイベント：こおり（机が凍る）・いす（辺に椅子が並ぶ）・ヒーリング・強風
    if (desks.event?.type === 'ice' || desks.icy) drawIce(shown.map((x) => x.pn), now);
    if (desks.event?.type === 'chair') drawChairs(desks.event.wall, now);
    if (desks.event?.type === 'heal') drawHealing(shown.map((x) => x.pn), now);
    // 虹の道（作った次の番だけ効く。作ったばかりのものは薄く）
    if (desks.rainbow?.pts?.length > 1) drawRainbow(desks.rainbow, now);
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

    // 回復アイテム（ばんそうこう）・吹雪のクリスタルは、定規の下に置く
    if (desks.items?.length) drawItems(desks.items, now);
    if (desks.crystals?.length) drawCrystals(desks.crystals, now);
    for (const b of bodies) {
      if (b.alpha <= 0) continue;
      drawRuler(b, px, b.owner === active && !aim, now);
    }
    // 強風：盤面の上を流れる風の筋
    if (desks.event?.type === 'gale') drawGale(desks.event.ang, dw, dh, now);
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
          ctx.lineWidth = Math.max(0.25, 5 / eff().s) * (1.4 - rt);
          const grow = f.inward ? 1 - 0.75 * Math.sqrt(rt) : 0.25 + 0.75 * Math.sqrt(rt);
        ctx.beginPath(); ctx.arc(f.x, f.y, Math.max(0.1, f.ring * k * grow), 0, Math.PI * 2); ctx.stroke();
        }
        // 風の筋
        ctx.globalAlpha = (1 - rt) * 0.8;
        ctx.lineWidth = Math.max(0.15, 2.5 / eff().s);
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
      ctx.font = `400 ${size}px "Yuji Boku", "Yuji Mai", "Yuji Syuku", "BIZ UDPGothic", serif`;
      const half = ctx.measureText(f.text).width / 2 + 8;
      const x = Math.max(half, Math.min(view.w - half, p.x));
      const y = Math.max(24, Math.min(view.h - 24, p.y)) - t * 18;
      // 出た瞬間だけ少し大きく（判を押すように）
      const pop = 1 + 0.25 * Math.max(0, 1 - t * 6);
      ctx.save();
      ctx.translate(x, y); ctx.scale(pop, pop);
      ctx.globalAlpha = 1 - t * t;
      ctx.lineJoin = 'round';
      // 墨のふち → 少しずらした影 → 同じ色で太らせてから塗る
      ctx.lineWidth = Math.max(5, size * 0.26); ctx.strokeStyle = 'rgba(24, 18, 14, 0.9)';
      ctx.strokeText(f.text, 0, 0);
      if (f.big) { ctx.fillStyle = 'rgba(24, 18, 14, 0.75)'; ctx.fillText(f.text, size * 0.05, size * 0.07); }
      ctx.lineWidth = Math.max(1.5, size * 0.09); ctx.strokeStyle = f.color;
      ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = f.color; ctx.fillText(f.text, 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  function drawRuler(b, px, active, now) { paintRuler(ctx, b, px, active, now); }

  // ばんそうこう：うっすら光る緑の輪の上に、斜めに貼ったばんそうこう
  // 救急箱（大回復）：金色に光る輪の上に、取っ手の付いた白い箱と赤い十字
  function drawItems(items, now) {
    for (const it of items) {
      if (it.big) { drawAidBox(it, now); continue; }
      const born = it.born ? Math.min(1, (now - it.born) / 400) : 1;
      const pulse = 0.5 + 0.5 * Math.sin(now / 380 + it.id);
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.globalAlpha = born;
      // 光の輪
      const R = it.r * (1.25 + 0.15 * pulse);
      const gr = ctx.createRadialGradient(0, 0, it.r * 0.3, 0, 0, R);
      gr.addColorStop(0, 'rgba(120, 230, 150, 0.45)'); gr.addColorStop(1, 'rgba(120, 230, 150, 0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(60, 180, 100, ${0.35 + 0.35 * pulse})`;
      ctx.lineWidth = 0.12;
      ctx.setLineDash([0.35, 0.25]);
      ctx.beginPath(); ctx.arc(0, 0, it.r * 1.05, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // ばんそうこう本体
      ctx.rotate(it.a || 0.3);
      ctx.scale(born, born);
      const L = it.r * 2.7, W = it.r * 1.05;
      ctx.shadowColor = 'rgba(40, 22, 8, 0.35)'; ctx.shadowBlur = 0.4; ctx.shadowOffsetY = 0.15;
      roundRect(-L / 2, -W / 2, L, W, W / 2);
      ctx.fillStyle = '#f2c9a0'; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(150, 95, 50, 0.6)'; ctx.lineWidth = 0.06; ctx.stroke();
      // 真ん中のガーゼ
      roundRect(-L * 0.17, -W * 0.36, L * 0.34, W * 0.72, 0.12);
      ctx.fillStyle = '#fffaf2'; ctx.fill();
      // 赤い十字
      ctx.fillStyle = '#e0483a';
      ctx.fillRect(-0.09, -W * 0.25, 0.18, W * 0.5);
      ctx.fillRect(-W * 0.25, -0.09, W * 0.5, 0.18);
      // 空気穴
      ctx.fillStyle = 'rgba(150, 95, 50, 0.45)';
      for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) for (const sy of [-1, 1]) {
        ctx.beginPath(); ctx.arc(sx * (L * 0.27 + k * 0.32), sy * W * 0.18, 0.05, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawAidBox(it, now) {
    const born = it.born ? Math.min(1, (now - it.born) / 400) : 1;
    const pulse = 0.5 + 0.5 * Math.sin(now / 300 + it.id);
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.globalAlpha = born;
    // 金色の光
    const R = it.r * (1.45 + 0.2 * pulse);
    const gr = ctx.createRadialGradient(0, 0, it.r * 0.3, 0, 0, R);
    gr.addColorStop(0, 'rgba(255, 220, 90, 0.55)'); gr.addColorStop(1, 'rgba(255, 220, 90, 0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    // 回るきらめき
    ctx.save();
    ctx.rotate(now / 900);
    ctx.fillStyle = `rgba(255, 240, 170, ${0.5 + 0.4 * pulse})`;
    for (let k = 0; k < 4; k++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath(); ctx.arc(it.r * 1.2, 0, 0.16, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = `rgba(220, 160, 30, ${0.45 + 0.4 * pulse})`;
    ctx.lineWidth = 0.14;
    ctx.setLineDash([0.4, 0.25]);
    ctx.beginPath(); ctx.arc(0, 0, it.r * 1.05, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // 箱
    ctx.rotate(it.a || 0.2);
    ctx.scale(born, born);
    const w = it.r * 1.7, h = it.r * 1.3;
    // 取っ手
    ctx.strokeStyle = '#8a1f18'; ctx.lineWidth = 0.22;
    roundRect(-w * 0.2, -h / 2 - h * 0.28, w * 0.4, h * 0.4, 0.2); ctx.stroke();
    ctx.shadowColor = 'rgba(40, 22, 8, 0.4)'; ctx.shadowBlur = 0.5; ctx.shadowOffsetY = 0.2;
    roundRect(-w / 2, -h / 2, w, h, 0.4);
    ctx.fillStyle = '#e3392e'; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#8a1f18'; ctx.lineWidth = 0.08; ctx.stroke();
    // ふたの線とつや
    ctx.strokeStyle = 'rgba(120, 20, 15, 0.55)'; ctx.lineWidth = 0.06;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 0.15, -h * 0.22); ctx.lineTo(w / 2 - 0.15, -h * 0.22); ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    roundRect(-w / 2 + 0.2, -h / 2 + 0.15, w - 0.4, h * 0.18, 0.15); ctx.fill();
    // 白い十字
    const c = h * 0.5, t = h * 0.17;
    ctx.fillStyle = '#fff';
    ctx.fillRect(-t / 2, -c / 2 + h * 0.08, t, c);
    ctx.fillRect(-c / 2, -t / 2 + h * 0.08, c, t);
    ctx.restore();
  }

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

  // ヒーリング：机がうっすら緑に光り、光の粒がのぼる
  function drawHealing(list, now) {
    for (const pn of list) {
      ctx.save();
      roundRect(pn.x, pn.y, pn.w, pn.h, 1.4);
      ctx.clip();
      const pulse = 0.5 + 0.5 * Math.sin(now / 500);
      ctx.fillStyle = `rgba(126, 227, 160, ${0.18 + 0.08 * pulse})`;
      ctx.fillRect(pn.x, pn.y, pn.w, pn.h);
      let seed = Math.abs(Math.round(pn.x * 11 + pn.y * 5)) + 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let k = 0; k < 26; k++) {
        const x = pn.x + rnd() * pn.w, sp = 2 + rnd() * 3, ph = rnd();
        const t = ((now / 1000) * sp / pn.h + ph) % 1;
        const y = pn.y + pn.h * (1 - t);
        ctx.globalAlpha = Math.sin(t * Math.PI) * 0.9;
        ctx.fillStyle = k % 3 ? '#c9ffd9' : '#ffffff';
        const r = 0.25 + (k % 4) * 0.08;
        // 小さな十字の光
        ctx.fillRect(x - r * 2, y - r / 2, r * 4, r);
        ctx.fillRect(x - r / 2, y - r * 2, r, r * 4);
      }
      ctx.restore();
      roundRect(pn.x + 0.35, pn.y + 0.35, pn.w - 0.7, pn.h - 0.7, 1.1);
      ctx.strokeStyle = 'rgba(80, 200, 130, 0.85)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }

  // 強風：風の向きに流れる白い筋（机の外まで）
  function drawGale(ang, dw, dh, now) {
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const span = Math.hypot(dw, dh) / 2 + 10;
    ctx.save();
    ctx.lineCap = 'round';
    let seed = 4242;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 34; k++) {
      const side = (rnd() - 0.5) * 2 * span, sp = 28 + rnd() * 26, len = 5 + rnd() * 9, ph = rnd();
      const t = (((now / 1000) * sp) / (span * 2) + ph) % 1;
      const along = -span + t * span * 2;
      const x = ux * along - uy * side, y = uy * along + ux * side;
      const wob = Math.sin(now / 260 + k) * 0.6;
      ctx.globalAlpha = Math.sin(t * Math.PI) * 0.55;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.22 + (k % 3) * 0.08;
      ctx.beginPath();
      ctx.moveTo(x - ux * len, y - uy * len);
      ctx.quadraticCurveTo(x - ux * len / 2 - uy * wob, y - uy * len / 2 + ux * wob, x, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 吹雪のクリスタル：青白く光る氷の結晶
  function drawCrystals(list, now) {
    for (const c of list) {
      const born = c.born ? Math.min(1, Math.max(0, (now - c.born) / 450)) : 1;
      if (born <= 0) continue;
      const pulse = 0.5 + 0.5 * Math.sin(now / 380 + c.id);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.globalAlpha = born;
      const R = c.r * (1.5 + 0.25 * pulse);
      const gr = ctx.createRadialGradient(0, 0, c.r * 0.2, 0, 0, R);
      gr.addColorStop(0, 'rgba(190, 235, 255, 0.75)'); gr.addColorStop(1, 'rgba(190, 235, 255, 0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
      // 雪の結晶の線
      ctx.rotate(now / 3000);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 0.12;
      for (let k = 0; k < 6; k++) {
        ctx.rotate(Math.PI / 3);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(c.r * 1.25, 0);
        ctx.moveTo(c.r * 0.8, 0); ctx.lineTo(c.r * 1.0, 0.3); ctx.moveTo(c.r * 0.8, 0); ctx.lineTo(c.r * 1.0, -0.3);
        ctx.stroke();
      }
      ctx.rotate(-now / 3000);
      // 結晶（縦長の六角柱を2本、斜めに）
      ctx.scale(born, born);
      for (const [a, s] of [[-0.25, 1], [0.55, 0.72]]) {
        ctx.save();
        ctx.rotate(a);
        const h = c.r * 0.95 * s, w = c.r * 0.38 * s;
        ctx.beginPath();
        ctx.moveTo(0, -h); ctx.lineTo(w, -h * 0.55); ctx.lineTo(w, h * 0.55); ctx.lineTo(0, h); ctx.lineTo(-w, h * 0.55); ctx.lineTo(-w, -h * 0.55); ctx.closePath();
        const cg = ctx.createLinearGradient(-w, -h, w, h);
        cg.addColorStop(0, '#f2fbff'); cg.addColorStop(0.45, '#8fd8ff'); cg.addColorStop(1, '#3f8fd0');
        ctx.fillStyle = cg; ctx.fill();
        ctx.strokeStyle = '#2d6fa8'; ctx.lineWidth = 0.08; ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath(); ctx.moveTo(-w * 0.3, -h * 0.5); ctx.lineTo(0, -h * 0.85); ctx.lineTo(0, h * 0.2); ctx.lineTo(-w * 0.3, h * 0.35); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // 虹の道：通った跡に6色の帯（効いている番は濃く、作ったばかりは薄く）
  function drawRainbow(road, now) {
    const pts = road.pts;
    const cols = ['#ff6b6b', '#ffb84d', '#ffe66d', '#7bd389', '#5ab8ff', '#a78bfa'];
    const W = SKILL_TUNE.roadW * 2;
    const live = !road.wait;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.globalAlpha = live ? 0.75 : 0.35;
    // 白いふち
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = W + 0.5;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
    ctx.stroke();
    // 色の帯（外側から内側へ細くして重ねる）
    cols.forEach((c, k) => {
      ctx.strokeStyle = c;
      ctx.lineWidth = W * (1 - k / cols.length);
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
      ctx.stroke();
    });
    // 進む向きに流れる光
    if (live) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.3;
      ctx.setLineDash([0.6, 3.4]);
      ctx.lineDashOffset = -now / 40;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
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
    const al = (3 + power * 14) * (a.reach || 1);
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
    // 百八十度：本当の動きと同じ計算で出した通り道（曲がる所・当たる所まで）
    if (a.trace?.pts?.length > 1) {
      const tp = a.trace.pts;
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(30, 24, 20, 0.55)';
      ctx.lineWidth = Math.max(0.35, 5 / px);
      ctx.beginPath(); ctx.moveTo(tp[0].x, tp[0].y);
      for (const q of tp.slice(1)) ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(0.22, 3 / px);
      ctx.setLineDash([0.9, 0.5]);
      ctx.beginPath(); ctx.moveTo(tp[0].x, tp[0].y);
      for (const q of tp.slice(1)) ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const dot = (p, r, fill, stroke) => {
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = fill; ctx.fill();
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(0.12, 1.5 / px); ctx.stroke(); }
      };
      if (a.trace.curveAt) dot(a.trace.curveAt, Math.max(0.5, 5 / px), '#fff', col);
      const end = a.trace.hitAt || tp.at(-1);
      if (a.trace.hitAt) {
        // 当たる所：ばつ印
        const r = Math.max(0.7, 7 / px);
        ctx.strokeStyle = '#ff4f4f'; ctx.lineWidth = Math.max(0.25, 3 / px); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(end.x - r, end.y - r); ctx.lineTo(end.x + r, end.y + r); ctx.moveTo(end.x + r, end.y - r); ctx.lineTo(end.x - r, end.y + r); ctx.stroke();
      } else if (a.trace.fell) {
        dot(end, Math.max(0.6, 6 / px), '#ff4f4f', '#fff');
      } else {
        dot(end, Math.max(0.6, 6 / px), col, '#fff');
      }
      ctx.restore();
    } else if (a.curve !== undefined) {
      // 百八十度（通り道が出せないとき）：矢印の先から、曲がったあとの向きを点線で
      const c = Math.cos(a.curve), s = Math.sin(a.curve);
      const vx = ux * c - uy * s, vy = ux * s + uy * c;
      ctx.setLineDash([0.9, 0.6]);
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + vx * al * 0.8, ey + vy * al * 0.8); ctx.stroke();
      ctx.setLineDash([]);
    }
    // 虹の道：ぶつかる所と、跳ね返った先まで虹色の点線で
    if (a.path?.length > 1) {
      const p0 = a.path[0], p1 = a.path.at(-1);
      const gr = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
      ['#ff6b6b', '#ffb84d', '#ffe66d', '#7bd389', '#5ab8ff', '#a78bfa'].forEach((cl, i, arr) => gr.addColorStop(i / (arr.length - 1), cl));
      ctx.save();
      ctx.strokeStyle = gr;
      ctx.lineWidth = Math.max(0.25, 3 / px);
      ctx.setLineDash([1.2, 0.7]);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
      for (const q of a.path.slice(1)) ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (a.path.length > 2) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(a.path[1].x, a.path[1].y, Math.max(0.4, 4 / px), 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
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
  // 盤面の向き (x, y) が、画面ではどちら向きに見えるか
  const screenDir = (x, y) => (view.rot ? { x: -y, y: x } : { x, y });
  return {
    setDesk, layout, draw, toWorld, screenDir, camMove, camReset,
    get scale() { return view.s * cam.z; },
    get zoomed() { return cam.z > 1.001; },
  };
}
