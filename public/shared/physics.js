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
  // 多角形（n角形）で円や角の丸い四角を近似する
  function poly(rx, ry, n, rot = 0) {
    const v = [];
    for (let i = 0; i < n; i++) { const t = rot + (i / n) * Math.PI * 2; v.push([rx * Math.cos(t), ry * Math.sin(t)]); }
    return v;
  }
  // 角を落とした四角（面取り c）
  function chamfer(L, W, c) {
    const x = L / 2, y = W / 2;
    return [[-x + c, -y], [x - c, -y], [x, -y + c], [x, y - c], [x - c, y], [-x + c, y], [-x, y - c], [-x, -y + c]];
  }
  const SHAPE_DEFS = {
    straight30: { name: '30cm定規', kind: 'rect', nominal: 30, L: 32, W: 3.4, verts: rect(32, 3.4), fill: 1 },
    straight15: { name: '15cm定規', kind: 'rect', nominal: 15, L: 17, W: 2.6, verts: rect(17, 2.6), fill: 1.5 },
    tri45: { name: '三角定規（45°）', kind: 'tri', nominal: 12, hole: 2.4, legs: [15, 15], verts: [[0, 0], [15, 0], [0, -15]], fill: 0.8, hollow: true },
    tri60: { name: '三角定規（30°・60°）', kind: 'tri', nominal: 15, hole: 2.2, legs: [18, 10.4], verts: [[0, 0], [18, 0], [0, -10.4]], fill: 0.88, hollow: true },
    protractor: { name: '分度器', kind: 'protractor', nominal: 180, hole: 1.7, R: 7.5, strip: 0.9, verts: semicircle(7.5, 0.9), fill: 0.82, hollow: true },
    // 折りたたみ定規（50cm）：たたんだ形 → 半分開いた形 → 全開。体力で形が変わる（重さは同じ）
    folding1: { name: '折りたたみ定規', kind: 'rect', nominal: 50, L: 17.6, W: 3.3, verts: rect(17.6, 3.3), fill: 1, special: true, folds: 3 },
    folding2: { name: '折りたたみ定規', kind: 'rect', nominal: 50, L: 34.6, W: 3.1, verts: rect(34.6, 3.1), fill: 1, special: true, folds: 2 },
    folding3: { name: '折りたたみ定規', kind: 'rect', nominal: 50, L: 51.6, W: 3.1, verts: rect(51.6, 3.1), fill: 1, special: true, folds: 1 },
    // ステージの敵（文房具）
    eraser: { name: '消しゴム', kind: 'rect', L: 5.6, W: 2.4, verts: chamfer(5.6, 2.4, 0.25), fill: 1, special: true },
    pencil: { name: '鉛筆', kind: 'rect', L: 17.6, W: 0.8, verts: [[-8.8, -0.4], [6.6, -0.4], [8.8, 0], [6.6, 0.4], [-8.8, 0.4]], fill: 1, special: true },
    clip: { name: 'クリップ', kind: 'rect', L: 3.4, W: 1.0, verts: chamfer(3.4, 1.0, 0.3), fill: 1, special: true },
    stapler: { name: 'ホチキス', kind: 'box', L: 10.4, W: 3.4, verts: chamfer(10.4, 3.4, 0.8), fill: 1, special: true },
    tack: { name: '画びょう', kind: 'round', R: 1.0, verts: poly(1.0, 1.0, 10), fill: 1, special: true },
    glue: { name: 'スティックのり', kind: 'rect', L: 9.6, W: 2.6, verts: chamfer(9.6, 2.6, 0.6), fill: 1, special: true },
    tape: { name: '修正テープ', kind: 'box', L: 8.6, W: 3.4, verts: chamfer(8.6, 3.4, 1.0), fill: 1, special: true },
    compass: { name: 'コンパス', kind: 'round', R: 1.9, verts: poly(1.9, 1.9, 10), fill: 1, special: true },
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
      const k = def.L > 30 ? 12 : 8;
      for (let i = 0; i < k; i++) samples.push({ x: -def.L / 2 + (i + 0.5) * (def.L / k), y: 0 });
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
    if (sh.special) continue;
    for (const [mk, mt] of Object.entries(MATERIALS)) {
      RULERS[`${sk}-${mk}`] = {
        name: `${sh.name}（${mt.name}）`, shape: sk, mat: mk, kind: mk, nominal: sh.nominal,
        mass: Math.round(mt.density * sh.area * sh.fill * 10) / 10, mu: mt.mu, e: mt.e,
      };
    }
  }

  // 折りたたみ定規（ステージの報酬）。forms：体力が多い順の形
  RULERS['folding-acrylic'] = {
    name: '折りたたみ定規（アクリル）', shape: 'folding1', forms: ['folding1', 'folding2', 'folding3'], mat: 'acrylic', kind: 'acrylic', nominal: 50,
    mass: 30, mu: 0.38, e: 0.5,
  };
  // ステージの敵。pinned：机に刺さって動かない
  const ENEMY_SPECS = {
    'en-eraser': { name: '消しゴム', shape: 'eraser', mat: 'rubber', mass: 18, mu: 1.5, e: 0.05 },
    'en-pencil': { name: '鉛筆', shape: 'pencil', mat: 'wood', mass: 6, mu: 0.26, e: 0.45 },
    'en-clip': { name: 'クリップ', shape: 'clip', mat: 'metal', mass: 9, mu: 0.34, e: 0.3 },
    'en-stapler': { name: 'ホチキス', shape: 'stapler', mat: 'metal', mass: 44, mu: 0.62, e: 0.2 },
    'en-tack': { name: '画びょう', shape: 'tack', mat: 'metal', mass: 3, mu: 1, e: 0.3 },
    'en-glue': { name: 'スティックのり', shape: 'glue', mat: 'plastic', mass: 16, mu: 0.75, e: 0.25 },
    'en-tape': { name: '修正テープ', shape: 'tape', mat: 'plastic', mass: 14, mu: 0.6, e: 0.3 },
    'en-compass': { name: 'コンパス', shape: 'compass', mat: 'metal', mass: 20, mu: 1, e: 0.3 },
    'boss-folding': { name: '折りたたみ定規', shape: 'folding1', forms: ['folding1', 'folding2', 'folding3'], mat: 'acrylic', mass: 40, mu: 0.42, e: 0.45 },
  };
  for (const [k, v] of Object.entries(ENEMY_SPECS)) RULERS[k] = { ...v, kind: v.mat, nominal: SHAPES[v.shape].nominal || 0, enemy: true };

  // 体力で形が変わる定規の、いまの形。体力の割合が 2/3 より多い→たたんだ形、1/3 より多い→半分、それ以下→全開
  function formIndex(hp, maxHp = 100) {
    const r = (hp ?? maxHp) / (maxHp || 100);
    return r > 2 / 3 ? 0 : r > 1 / 3 ? 1 : 2;
  }
  function shapeOf(specKey, hp, maxHp, forced) {
    const s = RULERS[specKey];
    if (!s) return 'straight30';
    if (!s.forms) return s.shape;
    return s.forms[forced ?? formIndex(hp, maxHp)];
  }

  // アクセサリの効果の上限（±5%）。レベルの分と合わせた上限は ±10%
  const MOD_LIMIT = 0.05;
  const MOD_TOTAL_LIMIT = 0.16; // レア度（最大+6%）×レベル（+3.6%）×アクセサリ（5%）をおさめる

  // ---- 体力 ----
  // 押されたときにすべる距離の倍率：体力が満タンで kbMin、0で kbMax（はじいた本人には効かない）
  // ダメージ：ぶつかった瞬間に近づく速さ（cm/秒）から。当てられた側だけが受ける
  // ダメージ = dmgK ×（近づく速さ − dmgFloor）^dmgExp（強く当てても伸びすぎないよう、ゆるやかに増える。1回 dmgMax まで）
  // zeroKb・zeroPower：体力0でも倒れない定規（プレイヤー）の「瀕死」。当てられるとかなり飛び、自分ではじくと力がかなり弱い
  const HP = { max: 100, kbMin: 0.6, kbMax: 1.6, zeroKb: 10, zeroPower: 0.55, dmgK: 0.32, dmgExp: 0.7, dmgFloor: 12, dmgMax: 35, critDmg: 1.5, windDmg: 18, gripExp: 0.5, massExp: 0.5 };
  // 体力から、押されたときのすべりにくさ（摩擦の倍率）を決める。すべる距離は摩擦に反比例する
  // 体力から「押されたときの飛びやすさ」kb を出し、すべりにくさ（摩擦）と、ぶつかったときの重さの両方に分けて効かせる
  function setHp(b, hp) {
    const max = b.maxHp || HP.max;
    b.hp = Math.max(0, Math.min(max, hp));
    // kbMul：特性「重心」で、当てられたときの飛び方を少し小さくする
    const base = b.hp <= 0 && b.weakAtZero ? HP.zeroKb : HP.kbMin + (HP.kbMax - HP.kbMin) * (1 - b.hp / max);
    const kb = b.shooter ? 1 : base * (b.kbMul ?? 1);
    b.grip = Math.pow(kb, -HP.gripExp);
    const mk = Math.pow(kb, HP.massExp);
    b.cM = b.invM * mk; b.cI = b.invI * mk;
  }
  function damage(world, target, amount, from, x, y, kind) {
    const dmg = Math.round(amount * 10) / 10;
    if (dmg <= 0 || world.noDamage) return; // noDamage：コンパスの番（弾くだけで、だれも体力が減らない）
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
  // tune：設定画面で変えた定規の性能 { mass（g）, mu, e, power（%） }。無ければ素材と形から決まる値
  // opt：shape（形を変える定規のいまの形）、modLimit（倍率の上限。ステージではレベルの分が大きい）、
  //      maxHp（体力の最大）、pinned（机に刺さって動かない）、thorns（ぶつかった相手へのトゲのダメージ）、zone（周りのねばり { r, mul }）
  function createBody(id, owner, specKey, x, y, a, mods, tune, opt = {}) {
    const s = RULERS[specKey] || RULERS['straight30-acrylic'];
    const shapeKey = SHAPES[opt.shape] ? opt.shape : s.shape;
    const sh = SHAPES[shapeKey];
    const lim = opt.modLimit ?? MOD_TOTAL_LIMIT;
    const cl = (v) => Math.max(1 - lim, Math.min(1 + lim, Number.isFinite(v) ? v : 1));
    const mm = cl(mods?.mass ?? 1), mu = cl(mods?.mu ?? 1), pw = cl(mods?.power ?? 1);
    const baseMass = tune?.mass ?? s.mass, baseMu = tune?.mu ?? s.mu, baseE = tune?.e ?? s.e, basePow = (tune?.power ?? 100) / 100;
    const m = baseMass * mm;
    const I = m * sh.inertiaPerMass;
    const pin = !!opt.pinned;
    const maxHp = opt.maxHp || HP.max;
    return {
      id, owner, specKey, spec: s, shape: sh, shapeKey, mat: s.mat,
      x, y, a, vx: 0, vy: 0, w: 0,
      m, invM: pin ? 0 : 1 / m, I, invI: pin ? 0 : 1 / I, cM: pin ? 0 : 1 / m, cI: pin ? 0 : 1 / I, // cM・cI：ぶつかったときに使う重さ（体力で変わる）
      mu: baseMu * mu, e: baseE, powerMul: pw * basePow,
      state: 'desk', fallAt: 0,
      maxHp, hp: maxHp, grip: 1, // 体力と、押されたときのすべりにくさ（体力が多いほど止まりやすい）
      pinned: pin, thorns: opt.thorns || 0, zone: opt.zone || null,
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
    if (b.pinned) return;
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

  // 一角：tip を持つ定規が、決めた角の先（tip.r 以内）で最初に当たったとき、相手だけを (push - 1) 倍ぶん余計に押し、ダメージを tip.dmg 倍にする
  function applyTip(world, c) {
    const { A, B, nx, ny } = c;
    const src = A.tip && !A.tip.used ? A : B.tip && !B.tip.used ? B : null;
    if (!src) return null;
    const t = src.tip;
    const cs = Math.cos(src.a), sn = Math.sin(src.a);
    const tx = src.x + t.x * cs - t.y * sn, ty = src.y + t.x * sn + t.y * cs;
    const hit = c.points.find((p) => Math.hypot(p.x - tx, p.y - ty) <= t.r);
    if (!hit) return null;
    t.used = true;
    const target = src === A ? B : A, sign = src === A ? 1 : -1;
    for (const p of c.points) {
      const P = p.Pn * (t.push - 1) * sign;
      const rx = target === B ? p.rBx : p.rAx, ry = target === B ? p.rBy : p.rAy;
      target.vx += P * nx * target.cM; target.vy += P * ny * target.cM;
      target.w += target.cI * (rx * P * ny - ry * P * nx);
    }
    (world.events ||= []).push({ type: 'tip', time: world.time, owner: src.owner, target: target.owner, x: hit.x, y: hit.y });
    return { by: src, dmg: t.dmg };
  }
  // 不動：src（構えている定規）に当たった相手だけを、ぶつかった力の src.repel 倍ぶん余計に押し返す
  function applyRepel(world, c, src) {
    const { A, B, nx, ny } = c;
    const target = src === A ? B : A, sign = src === A ? 1 : -1;
    if (target.pinned) return;
    let px = 0, py = 0, sum = 0;
    for (const p of c.points) {
      const P = p.Pn * src.repel * sign;
      const rx = target === B ? p.rBx : p.rAx, ry = target === B ? p.rBy : p.rAy;
      target.vx += P * nx * target.cM; target.vy += P * ny * target.cM;
      target.w += target.cI * (rx * P * ny - ry * P * nx) * 0.5;
      px += target.x + rx; py += target.y + ry; sum += p.Pn;
    }
    if (sum <= 0) return;
    const k = c.points.length || 1;
    (world.events ||= []).push({ type: 'repel', time: world.time, owner: src.owner, target: target.owner, x: px / k, y: py / k });
  }

  // 形のいちばん鋭い角（重心から見た位置）と、形のいちばん長い所
  function sharpestCorner(shapeKey) {
    const sh = SHAPES[shapeKey];
    let best = null, bestAng = Infinity;
    const v = sh.verts;
    for (let i = 0; i < v.length; i++) {
      const a = v[(i - 1 + v.length) % v.length], p = v[i], q = v[(i + 1) % v.length];
      const ux = a.x - p.x, uy = a.y - p.y, wx = q.x - p.x, wy = q.y - p.y;
      const ang = Math.acos(Math.max(-1, Math.min(1, (ux * wx + uy * wy) / (Math.hypot(ux, uy) * Math.hypot(wx, wy)))));
      if (ang < bestAng - 1e-6) { bestAng = ang; best = { x: p.x, y: p.y }; }
    }
    let span = 0;
    for (const p of v) for (const q of v) span = Math.max(span, Math.hypot(p.x - q.x, p.y - q.y));
    return { ...best, angle: (bestAng * 180) / Math.PI, span };
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

  // ---- 虹の道 ----
  // road = { pts: [{x,y}…], w（半分の幅）, speed（乗ったときの速さの下限）, owner（道を作った定規。乗らない） }
  // 点から道（折れ線）までのいちばん近い所。lo〜hi の区間だけを調べる
  function nearestOnRoad(pts, x, y, lo = 0, hi = pts.length - 2) {
    let best = null;
    for (let i = Math.max(0, lo); i <= Math.min(pts.length - 2, hi); i++) {
      const a = pts[i], q = pts[i + 1];
      const ex = q.x - a.x, ey = q.y - a.y, L2 = ex * ex + ey * ey || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / L2));
      const px = a.x + ex * t, py = a.y + ey * t;
      const d = Math.hypot(x - px, y - py);
      if (!best || d < best.d) { const L = Math.sqrt(L2); best = { d, i, t, px, py, tx: ex / L, ty: ey / L }; }
    }
    return best;
  }
  // 道に乗った定規：道の向きに速さを向け直し、道の上へ寄せる（机との摩擦は効かない）。道の端まで来たら降りる
  function rideRoad(world, b, dt) {
    const road = world.road;
    const pts = road.pts;
    if (!b.ride) {
      if (b.rode || b.owner === road.owner || b.pinned) return;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp < 3) return;
      const n = nearestOnRoad(pts, b.x, b.y);
      if (!n || n.d > road.w) return;
      b.ride = { dir: b.vx * n.tx + b.vy * n.ty >= 0 ? 1 : -1, i: n.i };
      (world.events ||= []).push({ type: 'ride', time: world.time, owner: b.owner, x: n.px, y: n.py });
    }
    const n = nearestOnRoad(pts, b.x, b.y, b.ride.i - 2, b.ride.i + 2);
    b.ride.i = n.i;
    const last = pts.length - 2;
    const atEnd = b.ride.dir > 0 ? n.i === last && n.t >= 0.999 : n.i === 0 && n.t <= 0.001;
    if (atEnd || n.d > road.w * 3) { b.ride = null; b.rode = true; return; }
    const sp = Math.max(road.speed, Math.hypot(b.vx, b.vy));
    // 道の向き＋道の上へ戻る分
    const k = Math.min(1, 10 * dt) / dt;
    b.vx = n.tx * b.ride.dir * sp + (n.px - b.x) * k;
    b.vy = n.ty * b.ride.dir * sp + (n.py - b.y) * k;
    b.w *= 0.85;
  }

  const WIND_CAP = 0.75;
  // 1ステップ進める。新しく落ちた定規の配列を返す。
  function step(world, dt) {
    const P = world.params;
    const live = world.bodies.filter((b) => b.state === 'desk');
    // 虹の道：乗った定規は道に沿って進む
    if (world.road?.pts?.length > 1) for (const b of live) rideRoad(world, b, dt);
    // 強風：動いている定規だけ、風の向きに流される（止まっている定規は動かさない）。
    // 風の強さは、その定規が机から受ける摩擦の WIND_CAP 倍までにする（風だけで動き続けないように）
    if (world.wind) {
      const wa = Math.hypot(world.wind.x, world.wind.y) || 1;
      for (const b of live) {
        if (b.pinned || b.ride || Math.hypot(b.vx, b.vy) < 0.5) continue;
        const k = Math.min(1, (WIND_CAP * b.mu * P.friction * (b.grip ?? 1) * G) / wa);
        b.vx += world.wind.x * k * dt; b.vy += world.wind.y * k * dt;
      }
    }
    for (const b of live) {
      // 百八十度：決めた時間がたったら、速さを保ったまま向きを変える
      if (b.curve && !b.curve.done && world.time >= b.curve.at) {
        b.curve.done = true;
        const c = Math.cos(b.curve.ang), s = Math.sin(b.curve.ang);
        [b.vx, b.vy] = [b.vx * c - b.vy * s, b.vx * s + b.vy * c];
        (world.events ||= []).push({ type: 'curve', time: world.time, owner: b.owner, x: b.x, y: b.y });
      }
    }
    for (const b of live) { b.vx0 = b.vx; b.vy0 = b.vy; }
    // スティックのり：のりの周りでは、ほかの定規が止まりやすい
    const zones = live.filter((z) => z.zone);
    for (const b of live) {
      if (b.ride) continue; // 虹の道に乗っている間は、すべって減速しない
      let k = P.friction;
      for (const z of zones) if (z !== b && Math.hypot(b.x - z.x, b.y - z.y) < z.zone.r) k *= z.zone.mul;
      applyDeskFriction(b, dt, k);
    }
    const contacts = [];
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const c = collide(live[i], live[j]);
        if (c) { prepare(c, dt, P.restitution); contacts.push(c); }
      }
    for (let it = 0; it < 12; it++) for (const c of contacts) solve(c);
    for (const c of contacts) applyAffinity(c);
    for (const c of contacts) c.crit = applyCrit(world, c);
    for (const c of contacts) c.tip = applyTip(world, c);
    // 一文字：この1打のあいだは回らない
    for (const b of live) if (b.noSpin) b.w = 0;
    // 新しくぶつかった組だけダメージ（触れ続けている間や、0.25秒以内の当たり直しは数えない）
    const touching = new Set();
    const last = (world.lastHit ||= new Map());
    for (const c of contacts) {
      const key = c.A.id + '|' + c.B.id;
      touching.add(key);
      if (world.touching?.has(key)) continue;
      if (world.time - (last.get(key) ?? -1) < 0.25) continue;
      last.set(key, world.time);
      // 不動：構えている定規に当たった定規を、大きく跳ね返す
      const rp = c.A.repel && !c.B.repel ? c.A : c.B.repel && !c.A.repel ? c.B : null;
      if (rp) applyRepel(world, c, rp);
      const speed = -(c.vn0 ?? 0);
      // 画びょう：ぶつかった相手もトゲでダメージを受ける（ゆっくり触れただけでも）
      if (speed > 3) {
        const pt0 = c.points[0];
        if (c.A.thorns && !c.B.thorns) damage(world, c.B, c.A.thorns, c.A, pt0.x, pt0.y, 'thorn');
        if (c.B.thorns && !c.A.thorns) damage(world, c.A, c.B.thorns, c.B, pt0.x, pt0.y, 'thorn');
      }
      if (speed <= HP.dmgFloor) continue;
      // 相手へ向かって速く動いていた方が「当てた側」
      const sA = c.A.vx0 * c.nx + c.A.vy0 * c.ny, sB = -(c.B.vx0 * c.nx + c.B.vy0 * c.ny);
      const [att, rec] = sA >= sB ? [c.A, c.B] : [c.B, c.A];
      const pt = c.points[0];
      const base = Math.min(HP.dmgMax, HP.dmgK * Math.pow(speed - HP.dmgFloor, HP.dmgExp) * Math.sqrt(att.m / 26));
      const amount = base * (c.crit ? HP.critDmg : 1) * (att.dmgMul ?? 1) * (c.tip && c.tip.by === att ? c.tip.dmg : 1);
      damage(world, rec, amount, att, pt.x, pt.y, c.crit ? 'crit' : 'hit');
    }
    world.touching = touching;
    const fell = [];
    for (const b of world.bodies) {
      if (b.state === 'gone') continue;
      if (b.pinned) { b.vx = 0; b.vy = 0; b.w = 0; continue; }
      b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.w * dt;
      if (b.state === 'desk' && world.desk.walls) for (const wl of world.desk.walls) hitWall(b, wl);
      if (b.state === 'falling') {
        b.vx *= 0.995; b.vy *= 0.995; b.w *= 0.995;
        if (world.time - b.fallAt > 0.7) b.state = 'gone';
      } else if (!onDesk(world.desk, b.x, b.y) && b.edgeBounce?.left > 0) {
        // ゴム跳び：机の端で1回だけ跳ね返る（越えた向きの速さを反対にして、少し遅くする）
        const px = b.x - b.vx * dt, py = b.y - b.vy * dt;
        const k = b.edgeBounce.speed;
        if (onDesk(world.desk, px, b.y)) { b.vy = -b.vy * k; b.vx *= k; }
        else if (onDesk(world.desk, b.x, py)) { b.vx = -b.vx * k; b.vy *= k; }
        else { b.vx = -b.vx * k; b.vy = -b.vy * k; }
        b.w *= k;
        b.x = px; b.y = py;
        b.edgeBounce.left--;
        (world.events ||= []).push({ type: 'bounce', time: world.time, owner: b.owner, x: px, y: py });
      } else if (!onDesk(world.desk, b.x, b.y)) {
        // 重心が天板の外に出たら傾いて落ちる
        b.state = 'falling'; b.fallAt = world.time; fell.push(b);
      } else if (Math.hypot(b.vx, b.vy) < 0.25 && Math.abs(b.w) < 0.01) {
        b.vx = 0; b.vy = 0; b.w = 0;
      }
    }
    // 回復アイテム：机の上の定規が触れたら、その定規の体力を回復して消える
    if (world.items?.length) {
      for (const it of world.items) {
        if (it.taken) continue;
        for (const b of world.bodies) {
          if (b.state !== 'desk' || Math.hypot(b.x - it.x, b.y - it.y) > b.shape.radius + it.r) continue;
          if (distToBody(b, it.x, it.y) > it.r) continue;
          it.taken = true;
          const before = b.hp;
          setHp(b, b.hp + (b.maxHp || HP.max) * it.heal / 100); // heal は体力の最大に対する％
          (world.events ||= []).push({ type: 'pickup', time: world.time, item: it.id, owner: b.owner, amount: Math.round((b.hp - before) * 10) / 10, x: it.x, y: it.y, big: !!it.big });
          break;
        }
      }
    }
    // 吹雪のクリスタル：机の上の定規が触れたら割れて、机が凍る（この動きの残りもすべりやすくなる）
    if (world.crystals?.length) {
      for (const cr of world.crystals) {
        if (cr.taken) continue;
        for (const b of world.bodies) {
          if (b.state !== 'desk' || Math.hypot(b.x - cr.x, b.y - cr.y) > b.shape.radius + cr.r) continue;
          if (distToBody(b, cr.x, cr.y) > cr.r) continue;
          cr.taken = true;
          if (!world.frozen) { world.frozen = true; P.friction = Math.min(P.friction, world.freezeTo ?? 0.3); }
          (world.events ||= []).push({ type: 'freeze', time: world.time, crystal: cr.id, owner: b.owner, x: cr.x, y: cr.y });
          break;
        }
      }
    }
    world.time += dt;
    return fell;
  }
  // 点から定規の形までの距離（中なら0）
  function distToBody(b, x, y) {
    const v = worldVerts(b), n = worldNormals(b);
    let inside = true, best = Infinity;
    for (let i = 0; i < v.length; i++) {
      const a = v[i], q = v[(i + 1) % v.length];
      if (n[i].x * (x - a.x) + n[i].y * (y - a.y) > 0) inside = false;
      const ex = q.x - a.x, ey = q.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey)));
      best = Math.min(best, Math.hypot(x - (a.x + ex * t), y - (a.y + ey * t)));
    }
    return inside ? 0 : best;
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
    // 力の割合（引っぱった長さ×倍率）。瀕死（体力0で残っている）ときは弱くなる
    const k = power * world.params.power * (b.hp <= 0 && b.weakAtZero ? HP.zeroPower : 1);
    const E = MAX_ENERGY * Math.pow(b.spec.mass / 26, ENERGY_MASS_EXP) * b.powerMul;
    const J = k * Math.sqrt(2 * E * effMass);
    const Jx = dirx * J, Jy = diry * J;
    b.vx += Jx * b.invM; b.vy += Jy * b.invM;
    b.w += b.invI * (r.x * Jy - r.y * Jx);
  }

  // 突風：src の重心から半径 radius の中にある定規を外向きに吹き飛ばす。近いほど強く、軽いほど速く飛ぶ
  // speed がマイナスなら内向き（引き寄せ）。dmg はいちばん近くでのダメージ（0ならダメージなし）
  function blast(world, src, radius, speed, dmg = HP.windDmg, kind = 'wind') {
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
      if (!b.pinned) {
        b.vx += ux * v; b.vy += uy * v;
        // 近い端が強く押されるので、少し回る
        const rx = bx - b.x, ry = by - b.y;
        b.w += (rx * uy - ry * ux) * v * b.m * b.invI * 0.15;
      }
      hit.push(b.owner);
      if (dmg > 0) damage(world, b, dmg * Math.pow(1 - d / radius, 0.5), src, bx, by, kind);
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
    formIndex, shapeOf, ENEMY_SPECS, sharpestCorner, onDesk, distToBody, nearestOnRoad,
  };
})();
export default Physics;
