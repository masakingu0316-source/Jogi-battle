// 定規バトル 物理エンジン
// 単位: 長さ cm / 質量 g / 時間 s。机を真上から見た2D。
// 机との摩擦（クーロン摩擦）＋定規同士の衝突（逐次インパルス法）。
const Physics = (() => {
  const G = 981; // cm/s^2
  const DESK = { w: 65, h: 45 }; // JIS規格の生徒机 天板 65×45cm

  // basic: 全員が最初から持っている定規。それ以外はガチャで手に入る。
  const RULERS = {
    plastic30: { name: '30cm プラ定規', nominal: 30, length: 32, width: 3.4, mass: 26, mu: 0.48, kind: 'plastic', basic: true },
    plastic15: { name: '15cm プラ定規', nominal: 15, length: 17, width: 2.6, mass: 9, mu: 0.48, kind: 'plastic', basic: true },
    bamboo30: { name: '30cm 竹定規', nominal: 30, length: 32.5, width: 2.4, mass: 20, mu: 0.6, kind: 'bamboo', basic: true },
    steel15: { name: '15cm ステンレス定規', nominal: 15, length: 17, width: 1.8, mass: 22, mu: 0.33, kind: 'steel', basic: true },
    plastic20: { name: '20cm プラ定規', nominal: 20, length: 22, width: 3.0, mass: 15, mu: 0.48, kind: 'plastic' },
    acrylic30: { name: '30cm アクリル定規', nominal: 30, length: 32, width: 4.2, mass: 32, mu: 0.4, kind: 'plastic' },
    steel30: { name: '30cm ステンレス定規', nominal: 30, length: 32, width: 2.6, mass: 36, mu: 0.3, kind: 'steel' },
    grid30: { name: '30cm 方眼定規', nominal: 30, length: 32, width: 5.0, mass: 30, mu: 0.44, kind: 'plastic', grid: true },
  };

  // アクセサリの効果の上限（±5%）
  const MOD_LIMIT = 0.05;
  const clampMod = (v) => Math.max(1 - MOD_LIMIT, Math.min(1 + MOD_LIMIT, Number.isFinite(v) ? v : 1));

  const DEFAULT_PARAMS = {
    friction: 1.0,     // 机の摩擦の倍率
    restitution: 0.35, // 定規同士の跳ね返り
    power: 1.0,        // はじく力の倍率
  };
  const RULER_RULER_MU = 0.3;
  const MAX_IMPULSE = 6000; // g·cm/s（30cmプラ定規の真ん中をはじいたときの最大）
  // 指が出せる最大エネルギー。どの定規・どの位置をはじいても同じ。
  const MAX_ENERGY = MAX_IMPULSE * MAX_IMPULSE / (2 * 26);
  const FRICTION_SAMPLES = 8;

  // mods: アクセサリの効果 { mass, mu, power }（倍率。1.0 が効果なし、上限 ±5%）
  function createBody(id, owner, specKey, x, y, a, mods) {
    const s = RULERS[specKey];
    const mm = clampMod(mods?.mass ?? 1), mu = clampMod(mods?.mu ?? 1), pw = clampMod(mods?.power ?? 1);
    const L = s.length, W = s.width, m = s.mass * mm;
    const I = m * (L * L + W * W) / 12;
    return {
      id, owner, specKey, spec: s,
      x, y, a, vx: 0, vy: 0, w: 0,
      m, invM: 1 / m, I, invI: 1 / I,
      mu: s.mu * mu, powerMul: pw,
      hx: L / 2, hy: W / 2,
      state: 'desk', fallAt: 0,
    };
  }

  // desk: 天板全体の大きさ {w, h}（複数台をくっつけた場合は合計の大きさ）
  function createWorld(params, desk) {
    return { bodies: [], params: Object.assign({}, DEFAULT_PARAMS, params || {}), desk: desk || DESK, time: 0 };
  }

  function axesOf(b) {
    const c = Math.cos(b.a), s = Math.sin(b.a);
    return { ux: c, uy: s, vx: -s, vy: c };
  }

  // 机との摩擦：定規を長さ方向に分割し、各点の滑り速度と逆向きに摩擦力をかける
  function applyDeskFriction(b, dt, scale) {
    const mu = b.mu * scale;
    const c = Math.cos(b.a), s = Math.sin(b.a);
    const fPer = mu * (b.m / FRICTION_SAMPLES) * G;
    let Fx = 0, Fy = 0, T = 0;
    for (let i = 0; i < FRICTION_SAMPLES; i++) {
      const t = -b.hx + (i + 0.5) * (2 * b.hx / FRICTION_SAMPLES);
      const rx = t * c, ry = t * s;
      const pvx = b.vx - b.w * ry, pvy = b.vy + b.w * rx;
      const sp = Math.hypot(pvx, pvy);
      if (sp < 1e-6) continue;
      const fx = -fPer * pvx / sp, fy = -fPer * pvy / sp;
      Fx += fx; Fy += fy;
      T += rx * fy - ry * fx;
    }
    const nvx = b.vx + Fx * b.invM * dt;
    const nvy = b.vy + Fy * b.invM * dt;
    const nw = b.w + T * b.invI * dt;
    const decel = mu * G * dt * 1.5;
    if (nvx * b.vx + nvy * b.vy <= 0 && Math.hypot(b.vx, b.vy) < decel) { b.vx = 0; b.vy = 0; }
    else { b.vx = nvx; b.vy = nvy; }
    if (nw * b.w <= 0) b.w = 0; else b.w = nw;
  }

  // 2つの長方形（OBB）の衝突判定。法線はA→B向き。
  function collide(A, B) {
    const aa = axesOf(A), ba = axesOf(B);
    const dx = B.x - A.x, dy = B.y - A.y;
    const cands = [
      { ref: A, inc: B, nx: aa.ux, ny: aa.uy, he: A.hx, tx: aa.vx, ty: aa.vy, ht: A.hy },
      { ref: A, inc: B, nx: aa.vx, ny: aa.vy, he: A.hy, tx: aa.ux, ty: aa.uy, ht: A.hx },
      { ref: B, inc: A, nx: ba.ux, ny: ba.uy, he: B.hx, tx: ba.vx, ty: ba.vy, ht: B.hy },
      { ref: B, inc: A, nx: ba.vx, ny: ba.vy, he: B.hy, tx: ba.ux, ty: ba.uy, ht: B.hx },
    ];
    let best = null;
    for (const c of cands) {
      const rA = A.hx * Math.abs(c.nx * aa.ux + c.ny * aa.uy) + A.hy * Math.abs(c.nx * aa.vx + c.ny * aa.vy);
      const rB = B.hx * Math.abs(c.nx * ba.ux + c.ny * ba.uy) + B.hy * Math.abs(c.nx * ba.vx + c.ny * ba.vy);
      const sep = Math.abs(c.nx * dx + c.ny * dy) - rA - rB;
      if (sep > 0) return null;
      c.sep = sep;
      if (best === null || sep > 0.95 * best.sep + 0.01) best = c;
    }
    const ref = best.ref, inc = best.inc;
    let nx = best.nx, ny = best.ny;
    if (nx * (inc.x - ref.x) + ny * (inc.y - ref.y) < 0) { nx = -nx; ny = -ny; }
    // 参照面に沿う接線
    const tx = -ny, ty = nx;
    const ht = best.ht, he = best.he;
    // 入射面：法線と最も逆向きの面
    const ia = axesOf(inc);
    const faces = [
      { fx: ia.ux, fy: ia.uy, h: inc.hx, sx: ia.vx, sy: ia.vy, sh: inc.hy },
      { fx: -ia.ux, fy: -ia.uy, h: inc.hx, sx: ia.vx, sy: ia.vy, sh: inc.hy },
      { fx: ia.vx, fy: ia.vy, h: inc.hy, sx: ia.ux, sy: ia.uy, sh: inc.hx },
      { fx: -ia.vx, fy: -ia.vy, h: inc.hy, sx: ia.ux, sy: ia.uy, sh: inc.hx },
    ];
    let f = faces[0], fd = Infinity;
    for (const fc of faces) { const d = fc.fx * nx + fc.fy * ny; if (d < fd) { fd = d; f = fc; } }
    const cx = inc.x + f.fx * f.h, cy = inc.y + f.fy * f.h;
    let pts = [
      { x: cx + f.sx * f.sh, y: cy + f.sy * f.sh },
      { x: cx - f.sx * f.sh, y: cy - f.sy * f.sh },
    ];
    // 参照面の両端でクリップ
    const sOf = (p) => tx * (p.x - ref.x) + ty * (p.y - ref.y);
    pts = clipSeg(pts, sOf, ht);
    if (!pts) return null;
    pts = clipSeg(pts, (p) => -sOf(p), ht);
    if (!pts) return null;
    const out = [];
    for (const p of pts) {
      const sep = nx * (p.x - ref.x) + ny * (p.y - ref.y) - he;
      if (sep <= 0.02) out.push({ x: p.x - nx * sep * 0.5, y: p.y - ny * sep * 0.5, sep });
    }
    if (!out.length) return null;
    const sign = ref === A ? 1 : -1;
    return { A, B, nx: nx * sign, ny: ny * sign, points: out };
  }

  // s(p) <= lim の範囲に線分を切り詰める
  function clipSeg(pts, sOf, lim) {
    const d0 = sOf(pts[0]) - lim, d1 = sOf(pts[1]) - lim;
    if (d0 > 0 && d1 > 0) return null;
    if (d0 <= 0 && d1 <= 0) return pts;
    const t = d0 / (d0 - d1);
    const q = { x: pts[0].x + t * (pts[1].x - pts[0].x), y: pts[0].y + t * (pts[1].y - pts[0].y) };
    return d0 > 0 ? [q, pts[1]] : [pts[0], q];
  }

  function prepare(c, dt, e) {
    const { A, B, nx, ny } = c;
    const tx = -ny, ty = nx;
    for (const p of c.points) {
      p.rAx = p.x - A.x; p.rAy = p.y - A.y;
      p.rBx = p.x - B.x; p.rBy = p.y - B.y;
      const rnA = p.rAx * ny - p.rAy * nx, rnB = p.rBx * ny - p.rBy * nx;
      const rtA = p.rAx * ty - p.rAy * tx, rtB = p.rBx * ty - p.rBy * tx;
      p.mn = 1 / (A.invM + B.invM + A.invI * rnA * rnA + B.invI * rnB * rnB);
      p.mt = 1 / (A.invM + B.invM + A.invI * rtA * rtA + B.invI * rtB * rtB);
      const vn = relVel(A, B, p, nx, ny);
      const bounce = vn < -15 ? -e * vn : 0;
      const push = 0.25 / dt * Math.max(0, -p.sep - 0.01);
      p.bias = Math.max(bounce, Math.min(push, 60));
      p.Pn = 0; p.Pt = 0;
    }
  }

  function relVel(A, B, p, dx, dy) {
    const vax = A.vx - A.w * p.rAy, vay = A.vy + A.w * p.rAx;
    const vbx = B.vx - B.w * p.rBy, vby = B.vy + B.w * p.rBx;
    return (vbx - vax) * dx + (vby - vay) * dy;
  }

  function applyImp(A, B, p, Px, Py) {
    A.vx -= Px * A.invM; A.vy -= Py * A.invM;
    A.w -= A.invI * (p.rAx * Py - p.rAy * Px);
    B.vx += Px * B.invM; B.vy += Py * B.invM;
    B.w += B.invI * (p.rBx * Py - p.rBy * Px);
  }

  function solve(c) {
    const { A, B, nx, ny } = c;
    const tx = -ny, ty = nx;
    for (const p of c.points) {
      const vn = relVel(A, B, p, nx, ny);
      let dPn = p.mn * (-vn + p.bias);
      const Pn0 = p.Pn; p.Pn = Math.max(Pn0 + dPn, 0); dPn = p.Pn - Pn0;
      applyImp(A, B, p, dPn * nx, dPn * ny);
      const vt = relVel(A, B, p, tx, ty);
      let dPt = -p.mt * vt;
      const maxPt = RULER_RULER_MU * p.Pn;
      const Pt0 = p.Pt; p.Pt = Math.max(-maxPt, Math.min(Pt0 + dPt, maxPt)); dPt = p.Pt - Pt0;
      applyImp(A, B, p, dPt * tx, dPt * ty);
    }
  }

  // 1ステップ進める。新しく落ちた定規の配列を返す。
  function step(world, dt) {
    const P = world.params;
    const live = world.bodies.filter((b) => b.state === 'desk');
    for (const b of live) applyDeskFriction(b, dt, P.friction);
    const contacts = [];
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const c = collide(live[i], live[j]);
        if (c) { prepare(c, dt, P.restitution); contacts.push(c); }
      }
    for (let it = 0; it < 12; it++) for (const c of contacts) solve(c);
    const fell = [];
    for (const b of world.bodies) {
      if (b.state === 'gone') continue;
      b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.w * dt;
      if (b.state === 'falling') {
        b.vx *= 0.995; b.vy *= 0.995; b.w *= 0.995;
        if (world.time - b.fallAt > 0.7) b.state = 'gone';
      } else if (Math.abs(b.x) > world.desk.w / 2 || Math.abs(b.y) > world.desk.h / 2) {
        // 重心が天板の外に出たら傾いて落ちる
        b.state = 'falling'; b.fallAt = world.time; fell.push(b);
      } else if (Math.hypot(b.vx, b.vy) < 0.25 && Math.abs(b.w) < 0.01) {
        b.vx = 0; b.vy = 0; b.w = 0;
      }
    }
    world.time += dt;
    return fell;
  }

  function atRest(world) {
    return world.bodies.every((b) =>
      b.state === 'gone' || (b.state === 'desk' && b.vx === 0 && b.vy === 0 && b.w === 0));
  }

  // 定規上の点（ローカル座標 lx, ly）に、力の割合 power(0-1) で dir 方向にはじく
  // 指が出せるエネルギーは定規の種類や押さえる位置によらず同じ、として力積を決める。
  // 端をはじくと回転が加わるぶん力積は小さく、軽い定規ほど力積は小さくなる。
  function flick(world, b, lx, ly, dirx, diry, power) {
    const c = Math.cos(b.a), s = Math.sin(b.a);
    const rx = lx * c - ly * s, ry = lx * s + ly * c;
    const arm = rx * diry - ry * dirx;
    const effMass = 1 / (b.invM + b.invI * arm * arm);
    const k = power * world.params.power; // 力の割合（引っぱった長さ×倍率）
    const J = k * Math.sqrt(2 * MAX_ENERGY * b.powerMul * effMass);
    const Jx = dirx * J, Jy = diry * J;
    b.vx += Jx * b.invM; b.vy += Jy * b.invM;
    b.w += b.invI * (rx * Jy - ry * Jx);
  }

  return { G, DESK, RULERS, DEFAULT_PARAMS, MAX_IMPULSE, MOD_LIMIT, createBody, createWorld, step, atRest, flick, collide, axesOf };
})();
export default Physics;
