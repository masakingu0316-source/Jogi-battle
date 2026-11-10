// 定規バトル 物理エンジン
// 単位: 長さ cm / 質量 g / 時間 s。机を真上から見た2D。
// 机との摩擦（クーロン摩擦）＋定規同士の衝突（凸多角形・逐次インパルス法）。
// 定規は「形（まっすぐ・三角定規・分度器）」×「素材（アクリル・メタル・ラバー）」でできている。
const Physics = (() => {
  const G = 981; // cm/s^2
  const DESK = { w: 65, h: 45 }; // JIS規格の生徒机 天板 65×45cm

  // ---- 形 ----
  // verts は反時計回りでなくてよい（作るときに向きをそろえる）。
  // fill は厚みや中抜きを含めた重さの係数（形どうしの重さを近づけるための調整も兼ねる）。hollow は中抜きの形。
  function rect(L, W) { return [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]]; }
  function semicircle(R, strip, n = 16) {
    // 直径の辺（下）に細い帯がつき、円弧が上（-y）に張り出す
    const v = [[R, strip], [-R, strip]];
    for (let i = 0; i <= n; i++) {
      const t = Math.PI + (i / n) * Math.PI; // 180°→360°（上側の円弧）
      v.push([R * Math.cos(t), R * Math.sin(t)]);
    }
    return v;
  }
  const SHAPE_DEFS = {
    straight30: { name: '30cm定規', kind: 'rect', nominal: 30, L: 32, W: 3.4, verts: rect(32, 3.4), fill: 1 },
    straight15: { name: '15cm定規', kind: 'rect', nominal: 15, L: 17, W: 2.6, verts: rect(17, 2.6), fill: 1.5 },
    tri45: { name: '三角定規（45°）', kind: 'tri', nominal: 12, hole: 2.4, legs: [15, 15], verts: [[0, 0], [15, 0], [0, -15]], fill: 0.8, hollow: true },
    tri60: { name: '三角定規（30°・60°）', kind: 'tri', nominal: 15, hole: 2.2, legs: [18, 10.4], verts: [[0, 0], [18, 0], [0, -10.4]], fill: 0.88, hollow: true },
    protractor: { name: '分度器', kind: 'protractor', nominal: 180, hole: 1.7, R: 7.5, strip: 0.9, verts: semicircle(7.5, 0.9), fill: 0.82, hollow: true },
  };

  // ---- 素材 ----
  // density: 1cm²あたりの重さ(g)、mu: 机とのすべりにくさ、e: 定規どうしの跳ね返り
  const MATERIALS = {
    acrylic: { name: 'アクリル', density: 0.24, mu: 0.38, e: 0.5 },
    metal: { name: 'メタル', density: 0.34, mu: 0.42, e: 0.32 },
    rubber: { name: 'ラバー', density: 0.31, mu: 0.58, e: 0.08 },
  };
  // 三すくみ：左が右に強い（当てたとき相手を少し強く弾く）
  const BEATS = { metal: 'acrylic', acrylic: 'rubber', rubber: 'metal' };
  const AFFINITY_BONUS = 0.22;

  // 形を、重心が原点に来るようにして、面積・慣性・外向きの法線・摩擦をかける点を計算する
  function buildShape(def) {
    let v = def.verts.map(([x, y]) => ({ x, y }));
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < v.length; i++) {
      const p = v[i], q = v[(i + 1) % v.length];
      const cr = p.x * q.y - q.x * p.y;
      A += cr; cx += (p.x + q.x) * cr; cy += (p.y + q.y) * cr;
    }
    A /= 2; cx /= 6 * A; cy /= 6 * A;
    if (A < 0) v.reverse();
    const area = Math.abs(A);
    v = v.map((p) => ({ x: p.x - cx, y: p.y - cy }));
    // 慣性モーメント（単位質量あたり）
    let num = 0, den = 0;
    for (let i = 0; i < v.length; i++) {
      const p = v[i], q = v[(i + 1) % v.length];
      const cr = Math.abs(p.x * q.y - q.x * p.y);
      num += cr * (p.x * p.x + p.x * q.x + q.x * q.x + p.y * p.y + p.y * q.y + q.y * q.y);
      den += cr;
    }
    // 中抜きの形は重さが外側に寄るので、回りにくさを少し大きくする
    const inertiaPerMass = (num / (6 * den)) * (def.hollow ? 1.2 : 1);
    const normals = v.map((p, i) => {
      const q = v[(i + 1) % v.length];
      const ex = q.x - p.x, ey = q.y - p.y, len = Math.hypot(ex, ey);
      let nx = ey / len, ny = -ex / len;
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
      return { x: nx, y: ny };
    });
    const radius = Math.max(...v.map((p) => Math.hypot(p.x, p.y)));
    // 摩擦をかける点：まっすぐな定規は長さ方向に8点、ほかは面の中に格子状に
    let samples = [];
    if (def.kind === 'rect') {
      for (let i = 0; i < 8; i++) samples.push({ x: -def.L / 2 + (i + 0.5) * (def.L / 8), y: 0 });
    } else {
      const xs = v.map((p) => p.x), ys = v.map((p) => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
        const p = { x: x0 + (i + 0.5) * (x1 - x0) / 7, y: y0 + (j + 0.5) * (y1 - y0) / 7 };
        if (inside(v, normals, p)) samples.push(p);
      }
    }
    return { ...def, verts: v, normals, area, inertiaPerMass, radius, samples, offset: { x: cx, y: cy } };
  }
  function inside(v, n, p, tol = 0) {
    for (let i = 0; i < v.length; i++) if (n[i].x * (p.x - v[i].x) + n[i].y * (p.y - v[i].y) > tol) return false;
    return true;
  }

  const SHAPES = Object.fromEntries(Object.entries(SHAPE_DEFS).map(([k, d]) => [k, buildShape(d)]));

  // 定規の仕様（形×素材）。キーは "straight30-acrylic" のような形
  const RULERS = {};
  for (const [sk, sh] of Object.entries(SHAPES)) {
    for (const [mk, mt] of Object.entries(MATERIALS)) {
      RULERS[`${sk}-${mk}`] = {
        name: `${sh.name}（${mt.name}）`, shape: sk, mat: mk, kind: mk, nominal: sh.nominal,
        mass: Math.round(mt.density * sh.area * sh.fill * 10) / 10, mu: mt.mu, e: mt.e,
      };
    }
  }

  // アクセサリの効果の上限（±5%）。レベルの分と合わせた上限は ±10%
  const MOD_LIMIT = 0.05;
  const MOD_TOTAL_LIMIT = 0.1;
  const clampMod = (v) => Math.max(1 - MOD_TOTAL_LIMIT, Math.min(1 + MOD_TOTAL_LIMIT, Number.isFinite(v) ? v : 1));

  // ---- 体力 ----
  // 押されたときにすべる距離の倍率：体力が満タンで kbMin、0で kbMax（はじいた本人には効かない）
  // ダメージ：ぶつかった瞬間に近づく速さ（cm/秒）から。当てられた側だけが受ける
  // ダメージ = dmgK ×（近づく速さ − dmgFloor）^dmgExp（強く当てても伸びすぎないよう、ゆるやかに増える。1回 dmgMax まで）
  const HP = { max: 100, kbMin: 0.6, kbMax: 1.6, dmgK: 0.32, dmgExp: 0.7, dmgFloor: 12, dmgMax: 35, critDmg: 1.5, windDmg: 18, gripExp: 0.5, massExp: 0.5 };
  // 体力から、押されたときのすべりにくさ（摩擦の倍率）を決める。すべる距離は摩擦に反比例する
  // 体力から「押されたときの飛びやすさ」kb を出し、すべりにくさ（摩擦）と、ぶつかったときの重さの両方に分けて効かせる
  function setHp(b, hp) {
    b.hp = Math.max(0, Math.min(HP.max, hp));
    const kb = b.shooter ? 1 : HP.kbMin + (HP.kbMax - HP.kbMin) * (1 - b.hp / HP.max);
    b.grip = Math.pow(kb, -HP.gripExp);
    const mk = Math.pow(kb, HP.massExp);
    b.cM = b.invM * mk; b.cI = b.invI * mk;
  }
  function damage(world, target, amount, from, x, y, kind) {
    const dmg = Math.round(amount * 10) / 10;
    if (dmg <= 0) return;
    setHp(target, target.hp - dmg);
    (world.events ||= []).push({ type: 'hit', time: world.time, target: target.owner, from: from ? from.owner : -1, dmg, x, y, kind });
  }

  const DEFAULT_PARAMS = {
    friction: 1.0,     // 机の摩擦の倍率
    restitution: 1.0,  // 跳ね返りの倍率（素材ごとの値にかける）
    power: 1.0,        // はじく力の倍率
  };
  const RULER_RULER_MU = 0.3;
  const MAX_IMPULSE = 6000; // g·cm/s（26gの定規の真ん中をはじいたときの最大）
  // 指が出せる最大エネルギー（26gの定規のとき）。重い定規ほど少し強くはじける（重さの0.7乗）。
  // 軽い定規は遠くまで速く滑り、重い定規は押す力が強い。
  const MAX_ENERGY = MAX_IMPULSE * MAX_IMPULSE / (2 * 26);
  const ENERGY_MASS_EXP = 0.7;

  // mods: アクセサリとレベルの効果 { mass, mu, power }（倍率。1.0 が効果なし）
  function createBody(id, owner, specKey, x, y, a, mods) {
    const s = RULERS[specKey] || RULERS['straight30-acrylic'];
    const sh = SHAPES[s.shape];
    const mm = clampMod(mods?.mass ?? 1), mu = clampMod(mods?.mu ?? 1), pw = clampMod(mods?.power ?? 1);
    const m = s.mass * mm;
    const I = m * sh.inertiaPerMass;
    return {
      id, owner, specKey, spec: s, shape: sh, mat: s.mat,
      x, y, a, vx: 0, vy: 0, w: 0,
      m, invM: 1 / m, I, invI: 1 / I, cM: 1 / m, cI: 1 / I, // cM・cI：ぶつかったときに使う重さ（体力で変わる）
      mu: s.mu * mu, e: s.e, powerMul: pw,
      state: 'desk', fallAt: 0,
      hp: HP.max, grip: 1, // 体力と、押されたときのすべりにくさ（体力が多いほど止まりやすい）
    };
  }

  // desk: 天板全体の大きさ {w, h}（複数台をくっつけた場合は合計の大きさ）
  function createWorld(params, desk) {
    return { bodies: [], params: Object.assign({}, DEFAULT_PARAMS, params || {}), desk: desk || DESK, time: 0 };
  }

  const rot = (b, p) => {
    const c = Math.cos(b.a), s = Math.sin(b.a);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
  };
  function worldVerts(b) {
    const c = Math.cos(b.a), s = Math.sin(b.a);
    return b.shape.verts.map((p) => ({ x: b.x + p.x * c - p.y * s, y: b.y + p.x * s + p.y * c }));
  }
  function worldNormals(b) {
    const c = Math.cos(b.a), s = Math.sin(b.a);
    return b.shape.normals.map((n) => ({ x: n.x * c - n.y * s, y: n.x * s + n.y * c }));
  }

  // 机との摩擦：定規の面に散らばる点ごとに、滑り速度と逆向きに摩擦力をかける
  function applyDeskFriction(b, dt, scale) {
    const mu = b.mu * scale * (b.grip ?? 1);
    const pts = b.shape.samples;
    const fPer = mu * (b.m / pts.length) * G;
    const c = Math.cos(b.a), s = Math.sin(b.a);
    let Fx = 0, Fy = 0, T = 0;
    for (const p of pts) {
      const rx = p.x * c - p.y * s, ry = p.x * s + p.y * c;
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

  // A の各辺の法線方向で、B がどれだけ離れているか（いちばん離れている辺）
  function maxSeparation(va, na, vb) {
    let best = -Infinity, idx = 0;
    for (let i = 0; i < va.length; i++) {
      let min = Infinity;
      for (const q of vb) {
        const d = na[i].x * (q.x - va[i].x) + na[i].y * (q.y - va[i].y);
        if (d < min) min = d;
      }
      if (min > best) { best = min; idx = i; }
    }
    return { sep: best, idx };
  }

  // 2つの凸多角形の衝突判定。法線はA→B向き。
  function collide(A, B) {
    const dx = B.x - A.x, dy = B.y - A.y;
    const rr = A.shape.radius + B.shape.radius;
    if (dx * dx + dy * dy > rr * rr) return null;
    const va = worldVerts(A), na = worldNormals(A), vb = worldVerts(B), nb = worldNormals(B);
    const sA = maxSeparation(va, na, vb);
    if (sA.sep > 0) return null;
    const sB = maxSeparation(vb, nb, va);
    if (sB.sep > 0) return null;
    let refV, refN, incV, incN, idx, flip;
    if (sB.sep > 0.95 * sA.sep + 0.01) { refV = vb; refN = nb; incV = va; incN = na; idx = sB.idx; flip = true; }
    else { refV = va; refN = na; incV = vb; incN = nb; idx = sA.idx; flip = false; }
    const n = refN[idx];
    const r1 = refV[idx], r2 = refV[(idx + 1) % refV.length];
    // 入射辺：参照辺の法線といちばん逆向きの辺
    let inc = 0, md = Infinity;
    for (let i = 0; i < incN.length; i++) {
      const d = incN[i].x * n.x + incN[i].y * n.y;
      if (d < md) { md = d; inc = i; }
    }
    let pts = [incV[inc], incV[(inc + 1) % incV.length]];
    // 参照辺の両端でクリップ
    const tx = r2.x - r1.x, ty = r2.y - r1.y, tl = Math.hypot(tx, ty);
    const ux = tx / tl, uy = ty / tl;
    pts = clipSeg(pts, (p) => -(ux * (p.x - r1.x) + uy * (p.y - r1.y)), 0);
    if (!pts) return null;
    pts = clipSeg(pts, (p) => ux * (p.x - r1.x) + uy * (p.y - r1.y), tl);
    if (!pts) return null;
    const out = [];
    for (const p of pts) {
      const sep = n.x * (p.x - r1.x) + n.y * (p.y - r1.y);
      if (sep <= 0.02) out.push({ x: p.x - n.x * sep * 0.5, y: p.y - n.y * sep * 0.5, sep });
    }
    if (!out.length) return null;
    const sign = flip ? -1 : 1;
    return { A, B, nx: n.x * sign, ny: n.y * sign, points: out };
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

  function prepare(c, dt, eScale) {
    const { A, B, nx, ny } = c;
    const tx = -ny, ty = nx;
    const e = ((A.e + B.e) / 2) * eScale;
    for (const p of c.points) {
      p.rAx = p.x - A.x; p.rAy = p.y - A.y;
      p.rBx = p.x - B.x; p.rBy = p.y - B.y;
      const rnA = p.rAx * ny - p.rAy * nx, rnB = p.rBx * ny - p.rBy * nx;
      const rtA = p.rAx * ty - p.rAy * tx, rtB = p.rBx * ty - p.rBy * tx;
      p.mn = 1 / (A.cM + B.cM + A.cI * rnA * rnA + B.cI * rnB * rnB);
      p.mt = 1 / (A.cM + B.cM + A.cI * rtA * rtA + B.cI * rtB * rtB);
      const vn = relVel(A, B, p, nx, ny);
      c.vn0 = Math.min(c.vn0 ?? 0, vn);
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
    A.vx -= Px * A.cM; A.vy -= Py * A.cM;
    A.w -= A.cI * (p.rAx * Py - p.rAy * Px);
    B.vx += Px * B.cM; B.vy += Py * B.cM;
    B.w += B.cI * (p.rBx * Py - p.rBy * Px);
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

  // 三すくみ：有利な素材が当たったとき、不利な側だけを少し強く押す
  function applyAffinity(c) {
    const { A, B, nx, ny } = c;
    let target = null, sign = 1;
    if (BEATS[A.mat] === B.mat) { target = B; sign = 1; }
    else if (BEATS[B.mat] === A.mat) { target = A; sign = -1; }
    if (!target) return;
    for (const p of c.points) {
      const P = p.Pn * AFFINITY_BONUS * sign;
      const rx = target === B ? p.rBx : p.rAx, ry = target === B ? p.rBy : p.rAy;
      target.vx += P * nx * target.cM; target.vy += P * ny * target.cM;
      target.w += target.cI * (rx * P * ny - ry * P * nx);
    }
  }

  // 重心が天板の上にあるか。tiles があれば、残っている机のどれかの上
  function onDesk(desk, x, y) {
    if (desk.tiles) return desk.tiles.some((t) => x >= t.x0 && x <= t.x1 && y >= t.y0 && y <= t.y1);
    return Math.abs(x) <= desk.w / 2 && Math.abs(y) <= desk.h / 2;
  }

  // クリティカル：crit を持つ定規が最初に別の定規へ当たったとき、相手だけを (crit - 1) 倍ぶん余計に押す
  function applyCrit(world, c) {
    const { A, B, nx, ny } = c;
    const src = A.crit > 1 ? A : B.crit > 1 ? B : null;
    if (!src) return false;
    const target = src === A ? B : A, sign = src === A ? 1 : -1;
    let px = 0, py = 0;
    for (const p of c.points) {
      const P = p.Pn * (src.crit - 1) * sign;
      const rx = target === B ? p.rBx : p.rAx, ry = target === B ? p.rBy : p.rAy;
      target.vx += P * nx * target.cM; target.vy += P * ny * target.cM;
      target.w += target.cI * (rx * P * ny - ry * P * nx);
      px += target.x + rx; py += target.y + ry;
    }
    const k = c.points.length || 1;
    (world.events ||= []).push({ type: 'crit', time: world.time, owner: src.owner, target: target.owner, x: px / k, y: py / k });
    src.crit = 0;
    return true;
  }

  // 椅子：机の辺に沿った壁。wall = { nx, ny（外向き）, d（辺の位置 n·p）, lo, hi（辺に沿った範囲） }
  // 定規の角が辺の外に出ようとしたら押し戻し、少しだけ跳ね返す
  const WALL_E = 0.25;
  function hitWall(b, wl) {
    let best = null, pen = 0;
    for (const v of worldVerts(b)) {
      const t = wl.nx !== 0 ? v.y : v.x;
      if (t < wl.lo - 1 || t > wl.hi + 1) continue;
      const p = v.x * wl.nx + v.y * wl.ny - wl.d;
      if (p > pen) { pen = p; best = v; }
    }
    if (!best) return;
    b.x -= wl.nx * pen; b.y -= wl.ny * pen;
    const rx = best.x - wl.nx * pen - b.x, ry = best.y - wl.ny * pen - b.y;
    const vn = (b.vx - b.w * ry) * wl.nx + (b.vy + b.w * rx) * wl.ny;
    if (vn <= 0) return;
    const rn = rx * wl.ny - ry * wl.nx;
    const J = -(1 + WALL_E) * vn / (b.invM + b.invI * rn * rn);
    b.vx += J * wl.nx * b.invM; b.vy += J * wl.ny * b.invM;
    b.w += b.invI * (rx * J * wl.ny - ry * J * wl.nx);
  }

  // 1ステップ進める。新しく落ちた定規の配列を返す。
  function step(world, dt) {
    const P = world.params;
    const live = world.bodies.filter((b) => b.state === 'desk');
    for (const b of live) { b.vx0 = b.vx; b.vy0 = b.vy; }
    for (const b of live) applyDeskFriction(b, dt, P.friction);
    const contacts = [];
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const c = collide(live[i], live[j]);
        if (c) { prepare(c, dt, P.restitution); contacts.push(c); }
      }
    for (let it = 0; it < 12; it++) for (const c of contacts) solve(c);
    for (const c of contacts) applyAffinity(c);
    for (const c of contacts) c.crit = applyCrit(world, c);
    // 新しくぶつかった組だけダメージ（触れ続けている間や、0.25秒以内の当たり直しは数えない）
    const touching = new Set();
    const last = (world.lastHit ||= new Map());
    for (const c of contacts) {
      const key = c.A.id + '|' + c.B.id;
      touching.add(key);
      if (world.touching?.has(key)) continue;
      if (world.time - (last.get(key) ?? -1) < 0.25) continue;
      last.set(key, world.time);
      const speed = -(c.vn0 ?? 0);
      if (speed <= HP.dmgFloor) continue;
      // 相手へ向かって速く動いていた方が「当てた側」
      const sA = c.A.vx0 * c.nx + c.A.vy0 * c.ny, sB = -(c.B.vx0 * c.nx + c.B.vy0 * c.ny);
      const [att, rec] = sA >= sB ? [c.A, c.B] : [c.B, c.A];
      const pt = c.points[0];
      const base = Math.min(HP.dmgMax, HP.dmgK * Math.pow(speed - HP.dmgFloor, HP.dmgExp) * Math.sqrt(att.m / 26));
      const amount = base * (c.crit ? HP.critDmg : 1);
      damage(world, rec, amount, att, pt.x, pt.y, c.crit ? 'crit' : 'hit');
    }
    world.touching = touching;
    const fell = [];
    for (const b of world.bodies) {
      if (b.state === 'gone') continue;
      b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.w * dt;
      if (b.state === 'desk' && world.desk.walls) for (const wl of world.desk.walls) hitWall(b, wl);
      if (b.state === 'falling') {
        b.vx *= 0.995; b.vy *= 0.995; b.w *= 0.995;
        if (world.time - b.fallAt > 0.7) b.state = 'gone';
      } else if (!onDesk(world.desk, b.x, b.y)) {
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
  // 指が出せるエネルギーは押さえる位置によらず同じ、として力積を決める。
  // 端をはじくと回転が加わるぶん力積は小さくなる。
  function flick(world, b, lx, ly, dirx, diry, power) {
    const r = rot(b, { x: lx, y: ly });
    const arm = r.x * diry - r.y * dirx;
    const effMass = 1 / (b.invM + b.invI * arm * arm);
    const k = power * world.params.power; // 力の割合（引っぱった長さ×倍率）
    const E = MAX_ENERGY * Math.pow(b.spec.mass / 26, ENERGY_MASS_EXP) * b.powerMul;
    const J = k * Math.sqrt(2 * E * effMass);
    const Jx = dirx * J, Jy = diry * J;
    b.vx += Jx * b.invM; b.vy += Jy * b.invM;
    b.w += b.invI * (r.x * Jy - r.y * Jx);
  }

  // 突風：src の重心から半径 radius の中にある定規を外向きに吹き飛ばす。近いほど強く、軽いほど速く飛ぶ
  function blast(world, src, radius, speed) {
    const hit = [];
    for (const b of world.bodies) {
      if (b === src || b.state !== 'desk') continue;
      // 相手の定規のいちばん近い所までの距離で決める（長い定規の端が近くにあれば届く）
      let best = Infinity, bx = b.x, by = b.y;
      for (const v of worldVerts(b)) {
        const d = Math.hypot(v.x - src.x, v.y - src.y);
        if (d < best) { best = d; bx = v.x; by = v.y; }
      }
      const dc = Math.hypot(b.x - src.x, b.y - src.y);
      if (Math.min(best, dc) >= radius) continue;
      const d = Math.min(best, dc);
      const ux = (b.x - src.x) / (dc || 1), uy = (b.y - src.y) / (dc || 1);
      const v = speed * Math.pow(1 - d / radius, 0.5) * Math.sqrt(26 / b.m);
      b.vx += ux * v; b.vy += uy * v;
      // 近い端が強く押されるので、少し回る
      const rx = bx - b.x, ry = by - b.y;
      b.w += (rx * uy - ry * ux) * v * b.m * b.invI * 0.15;
      hit.push(b.owner);
      damage(world, b, HP.windDmg * Math.pow(1 - d / radius, 0.5), src, bx, by, 'wind');
    }
    return hit;
  }

  // 形の中のいちばん近い点（はじく点を定規の上に収める）と、形からの距離
  function nearestOnShape(shapeKey, lx, ly) {
    const sh = SHAPES[shapeKey];
    const p = { x: lx, y: ly };
    if (inside(sh.verts, sh.normals, p)) return { x: lx, y: ly, dist: 0 };
    let best = null;
    for (let i = 0; i < sh.verts.length; i++) {
      const a = sh.verts[i], b = sh.verts[(i + 1) % sh.verts.length];
      const ex = b.x - a.x, ey = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey)));
      const q = { x: a.x + ex * t, y: a.y + ey * t };
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!best || d < best.dist) best = { x: q.x, y: q.y, dist: d };
    }
    return best;
  }

  return {
    G, DESK, SHAPES, MATERIALS, BEATS, AFFINITY_BONUS, RULERS, DEFAULT_PARAMS, MAX_IMPULSE, MOD_LIMIT, MOD_TOTAL_LIMIT,
    createBody, createWorld, step, atRest, flick, blast, collide, nearestOnShape, worldVerts, HP, setHp, damage,
  };
})();
export default Physics;
