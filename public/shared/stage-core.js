// ステージモードの進行（サーバーで動かす）。部屋の進行（RoomCore）を土台に、
// 「自分1人 対 敵（文房具）」の盤面を、自分 → 敵1体ずつ の順に回す。
// 敵は体力0か机から落ちると倒れる。自分は机から落ちたらそのマップは失敗（体力0では負けない）。
import Physics from './physics.js';
import { RoomCore, encodeFrame, round2, round4, FPS, STEP, MAX_SIM_SECONDS, MARK_TYPES } from './core.js';
import { DESKS, deskTiles, onTile, GAUGE, SKILLS, skillFor, PLAYERS } from './rules.js';
import { ENEMIES, scaleOf, aiOf, BOARD_HEAL, enemyLook, mapOf, STAGES, stageMaxHp, LIVES, RESPAWN_HP, enemyMaxHp, diffOf, PAINT, PAINT_COLORS } from './stage.js';

export const ME = 'P';
const STAGE_MOD_LIMIT = 0.3; // ステージでは Lv.50 まで効くので、倍率の上限を広げる
const ENEMY_GAUGE = 0.5;     // 敵の必殺ゲージのたまる速さ（自分を1として）

export class StageCore extends RoomCore {
  // player: { name, userId, loadout }
  // opt.enemyHp：敵の種類ごとの体力（マップ1のとき）、opt.enemyHpGrow：マップが1つ進むごとに増える体力（％）。設定画面の値
  constructor(stageId, map, player, now = Date.now(), opt = {}) {
    super('STAGE', 'standard', now);
    const def = mapOf(stageId, map);
    if (!def) throw new Error('そのマップはありません');
    this.s.mode = 'stage';
    this.s.phase = 'aim';
    this.s.stage = {
      id: stageId, map, board: 0, boards: def.boards.length, result: null, shots: 0, startedAt: now, lives: LIVES,
      enemyHp: opt.enemyHp || null, enemyHpGrow: opt.enemyHpGrow ?? null,
    };
    this.s.members = [{ id: ME, token: '', userId: player.userId || null, name: player.name || 'あなた', loadout: player.loadout, ready: true, connected: true }];
    this.s.hostId = ME;
    this.loadBoard(0, null);
  }

  static restore(saved) {
    const r = Object.create(StageCore.prototype);
    r.s = saved;
    r.rand = Math.random;
    r.record = null;
    return r;
  }

  deskDef() { return DESKS[this.s.game?.desk] || DESKS.single; }
  // 難しさ（編ごとの、マップ番号の代わりの値）
  diff() { return diffOf(this.s.stage.id, this.s.stage.map); }

  // 盤面を並べる。carry：前の盤面から持ち越す自分の体力・ゲージ
  loadBoard(index, carry) {
    const s = this.s, st = s.stage;
    const def = mapOf(st.id, st.map).boards[index];
    const sc = scaleOf(this.diff());
    const me = s.members[0];
    const lo = me.loadout;
    const desk = DESKS[def.desk];
    const maxHp = stageMaxHp(lo.level || 1);
    const bodies = [{
      owner: 0, hp: carry ? Math.min(maxHp, Math.round((carry.hp + maxHp * BOARD_HEAL / 100) * 10) / 10) : maxHp, maxHp,
      tune: lo.tune || null, skill: SKILLS[lo.skill] ? lo.skill : skillFor(lo.specKey), ruler: lo.ruler, specKey: lo.specKey,
      rarity: lo.rarity || 'N', art: lo.art || 'plain', trait: lo.trait || null, traitPct: lo.traitPct || 0, st: lo.skillTune || null,
      level: lo.level || 1, mods: lo.mods, pattern: lo.pattern, sticker: lo.sticker, charge: Number.isFinite(lo.charge) ? lo.charge : GAUGE.charge,
      x: def.me.x, y: def.me.y, a: def.me.a ?? 0, state: 'desk',
    }];
    const members = [me];
    const looks = [{ name: me.name, color: null }];
    def.foes.forEach((f, k) => {
      const d = ENEMIES[f.t];
      const spec = f.spec || d.spec;
      // ボスの体力は編によらず同じ（マップ番号で決める）。ほかはマップの難しさで決める
      const hp = enemyMaxHp(f.t, d.boss ? st.map : this.diff(), st);
      const skill = d.skill === true ? skillFor(spec) : d.skill || 'none';
      bodies.push({
        owner: k + 1, enemy: f.t, hp, maxHp: hp, specKey: spec, level: 1, tune: null, skill,
        mods: { mass: round4(sc.body), mu: 1, power: round4(sc.power * (d.power ?? 1)) }, dmgMul: round4(sc.atk),
        x: f.x, y: f.y, a: f.a ?? 0, state: 'desk', ...(f.t === 'brush' ? { paint: f.c || 'red' } : {}),
      });
      const look = enemyLook({ ...f, spec });
      members.push({ id: `E${k + 1}`, token: '', userId: null, name: look.name, loadout: { ruler: null, level: 1 }, ready: true, connected: true, enemy: true });
      looks.push(look);
    });
    s.members = members;
    s.game = {
      id: (s.game?.id || 0) + 1, mode: 'stage', n: bodies.length, order: members.map((m) => m.id), starter: 0, turn: 0, shots: 0,
      outOrder: [], result: null, bodies, kos: bodies.map(() => 0), players: bodies.map(() => ({ alive: true, selfOut: false })),
      desk: def.desk, desks: def.tiles ? [...def.tiles] : deskTiles(desk).map((t) => t.i),
      vanish: null, vanishIn: null, vanishWait: null,
      gauge: bodies.map((_, i) => (i === 0 ? carry?.gauge ?? 0 : 0)), extra: false, event: null, eventId: 0,
      walls: [], icy: 0, icyNext: false, looks, board: index, boardClear: false, boss: !!def.boss,
      // 絵の具の水たまり（円 { id, c, x, y, r } と、筆の跡 { id, c, pts, w, lap }）と、落雷の予告
      puddles: (def.pools || []).map((p, k) => ({ id: k + 1, c: p.c, x: p.x, y: p.y, r: p.r ?? PAINT.r })), puddleId: (def.pools || []).length,
      bolts: [], boltEvent: mapOf(st.id, st.map).bolts || 0,
      fx: s.game?.fx || [], fxId: s.game?.fxId || 0,
    };
    s.phase = 'aim';
    this._strikes = [];
  }

  // 体力0で倒れず瀕死になるのは自分だけ（敵は今までどおり倒れる）
  zeroSurvives(i) { return i === 0; }

  bodyExtra(b) {
    if (!b.enemy) return { maxHp: b.maxHp || Physics.HP.max, modLimit: STAGE_MOD_LIMIT };
    const d = ENEMIES[b.enemy];
    const sc = scaleOf(this.diff());
    return {
      maxHp: b.maxHp, modLimit: 0.6, pinned: !!d.pinned,
      thorns: d.thorns ? Math.round(d.thorns * sc.atk * 10) / 10 : 0, zone: d.zone || null,
      trail: !!d.trail, splash: !!d.splash,
    };
  }

  // 水たまりは、上を通っている間のすべり方を変える（赤・青）
  buildWorld() {
    const world = super.buildWorld();
    const g = this.s.game;
    if (g.puddles?.length) world.puddles = g.puddles;
    return world;
  }

  // はさみ：刃の間で番を終えた定規は、次にはじく力が半分
  shoot(input, now = Date.now()) {
    const g = this.s.game;
    const b = g.bodies[g.turn];
    if (b?.cut && !g.extra) {
      b.cut = false;
      input = { ...input, power: (Number(input.power) || 0) * 0.5, cut: true };
    }
    return super.shoot(input, now);
  }

  // 物理の世界から盤面へ：拾われたアイテムなどに加えて、筆の跡・パレットの絵の具
  takeFieldThings(world) {
    super.takeFieldThings(world);
    const g = this.s.game;
    if (!g.puddles) return;
    // 筆の跡（その筆の色の細い水たまり。3周で乾く）
    world.bodies.forEach((wb, i) => {
      if (!wb.trail || wb.trail.length < 2) return;
      const c = g.bodies[i]?.paint || 'red';
      const pts = [];
      for (const p of wb.trail) if (!pts.length || Math.hypot(p.x - pts.at(-1).x, p.y - pts.at(-1).y) >= 1.5) pts.push(p);
      if (pts.length < 2) return;
      g.puddleId = (g.puddleId || 0) + 1;
      g.puddles.push({ id: g.puddleId, c, pts: pts.slice(0, 50), w: PAINT.trailW, lap: g.lap || 0, owner: i });
      wb.trail = [];
      // 同じ筆の跡は、新しいものから数本まで
      const mine = g.puddles.filter((p) => p.pts && p.owner === i);
      if (mine.length > PAINT.maxTrails) g.puddles = g.puddles.filter((p) => p !== mine[0]);
    });
    // パレット：当たると、まわり3か所に4色からランダムで絵の具がはねる（1回の動きで1つのパレットにつき1回）
    const done = new Set();
    for (const e of world.events || []) {
      if (e.type !== 'splash' || done.has(e.owner)) continue;
      done.add(e.owner);
      this.splash(e.owner, e.x, e.y);
    }
  }

  splash(owner, x, y) {
    const g = this.s.game;
    const tiles = deskTiles(this.deskDef()).filter((t) => !g.desks || g.desks.includes(t.i));
    const made = [];
    const a0 = this.rand() * Math.PI * 2;
    for (let k = 0; k < 3; k++) {
      let spot = null;
      for (let tries = 0; tries < 12 && !spot; tries++) {
        const a = a0 + (k * Math.PI * 2) / 3 + (this.rand() - 0.5) * 0.9 + tries * 0.5;
        const d = 9 + this.rand() * 6;
        const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
        if (tiles.some((t) => onTile(t, px, py))) spot = { x: round2(px), y: round2(py) };
      }
      if (!spot) continue;
      g.puddleId = (g.puddleId || 0) + 1;
      const c = PAINT_COLORS[Math.floor(this.rand() * PAINT_COLORS.length) % PAINT_COLORS.length];
      const p = { id: g.puddleId, c, x: spot.x, y: spot.y, r: PAINT.splashR, splash: true };
      g.puddles.push(p);
      made.push(p.id);
    }
    // 円の水たまりが多くなりすぎたら、古いはねた絵の具から消す
    let pools = g.puddles.filter((p) => !p.pts);
    while (pools.length > PAINT.maxPools) {
      const old = pools.find((p) => p.splash) || pools[0];
      g.puddles = g.puddles.filter((p) => p !== old);
      pools = pools.filter((p) => p !== old);
    }
    if (made.length) this.pushFx({ kind: 'splash', owner, x: round2(x), y: round2(y), puddles: made });
  }

  // 1周したとき：筆の跡が乾く・場のイベントの落雷を予告する（次の周の初め＝自分の番の直前に落ちる）
  onLap(lap) {
    const g = this.s.game;
    if (g.puddles?.some((p) => p.pts && lap - p.lap >= PAINT.trailDry)) {
      const dry = g.puddles.filter((p) => p.pts && lap - p.lap >= PAINT.trailDry);
      g.puddles = g.puddles.filter((p) => !dry.includes(p));
      this.pushFx({ kind: 'dry', puddles: dry.map((p) => p.id) });
    }
    const n = g.boltEvent || 0;
    if (n > 0 && !g.boardClear && !(g.bolts || []).some((b) => b.owner < 0 && b.skip > 0)) {
      // 1か所目は自分のそば、ほかは敵も含めて残っている定規のどれかのそば
      const live = g.players.map((p, i) => (p.alive && g.bodies[i].state === 'desk' ? i : -1)).filter((i) => i >= 0);
      const targets = [0];
      while (targets.length < n && live.length) targets.push(live[Math.floor(this.rand() * live.length) % live.length]);
      this.placeBolts(-1, n, targets, { due: 0, skip: 1, kind: 'event', near: PAINT.eventNear });
    }
  }

  // 落雷の狙い：自分（プレイヤー）は敵全員、敵は自分だけ
  boltTargets(i) {
    const g = this.s.game;
    if (i !== 0) return [0];
    return g.players.map((p, j) => j).filter((j) => j !== 0 && g.players[j].alive);
  }

  // 番の終わりの水たまりとはさみの判定（番を終えた定規 i の重心がどこにあるか）
  turnEndPaint(i) {
    const g = this.s.game, b = g.bodies[i];
    if (!b || b.state !== 'desk' || !g.players[i]?.alive) return;
    const on = (g.puddles || []).filter((p) => Physics.onPuddle(p, b.x, b.y));
    const green = on.find((p) => p.c === 'green');
    if (green && (b.hp ?? 0) < (b.maxHp ?? 100)) {
      const add = Math.min(PAINT.heal, (b.maxHp ?? 100) - (b.hp ?? 0));
      b.hp = Math.round(((b.hp ?? 0) + add) * 10) / 10;
      g.puddles = g.puddles.filter((p) => p !== green);
      this.pushFx({ kind: 'paintHeal', owner: i, x: b.x, y: b.y, amount: Math.round(add * 10) / 10, puddle: green.id });
    }
    if (on.some((p) => p.c === 'yellow')) {
      const was = b.hp ?? 100;
      b.hp = Math.max(0, Math.round((was - PAINT.hurt) * 10) / 10);
      this.pushFx({ kind: 'paintHurt', owner: i, x: b.x, y: b.y, amount: Math.round((was - b.hp) * 10) / 10 });
    }
    // はさみ：開いた刃の間（要から刃先までの三角の所）に、定規が入ったまま番を終えた
    const scissors = g.bodies.filter((o, j) => j !== i && g.players[j]?.alive && o.state === 'desk' && ENEMIES[o.enemy]?.cut);
    const body = scissors.length ? this.makeBody(b) : null;
    const cut = scissors.some((o) => bladeSpots(o).some((p) => Physics.distToBody(body, p.x, p.y) === 0));
    if (cut && !b.cut) {
      b.cut = true;
      this.pushFx({ kind: 'cut', owner: i, x: b.x, y: b.y });
    }
  }

  // 必殺ゲージは1周（自分と残っている敵が1回ずつ）ごと。敵は、自分の初期値の半分の速さでたまる
  lapCharge(i) {
    if (i === 0) return super.lapCharge(i);
    const d = ENEMIES[this.s.game.bodies[i]?.enemy];
    return Math.round((d?.charge ?? GAUGE.charge * ENEMY_GAUGE) * 10) / 10;
  }

  skillOf(i) {
    const b = this.s.game.bodies[i];
    if (!b) return 'power';
    if (b.enemy) return SKILLS[b.skill] ? b.skill : null;
    return SKILLS[b.skill] ? b.skill : skillFor(b.specKey);
  }

  look(i) {
    const g = this.s.game;
    return g.looks?.[i] || { name: PLAYERS[0].name };
  }

  snapshot() {
    const s = this.s, g = s.game, st = s.stage;
    const def = STAGES[st.id];
    return {
      code: 'STAGE', hostId: ME, mode: 'stage', phase: s.phase, capacity: 1, minPlayers: 1, startIn: null,
      members: s.members.map((x) => ({ id: x.id, name: x.name, account: !!x.userId, loadout: x.loadout, ready: true, connected: true, enemy: !!x.enemy })),
      wins: {},
      stage: { id: st.id, name: def.name, place: def.place || '', map: st.map, mapsTotal: def.maps.length, mapName: def.maps[st.map - 1].name, board: st.board, boards: st.boards, result: st.result, shots: st.shots, lives: st.lives ?? LIVES, livesMax: LIVES },
      game: g && {
        n: g.n, order: g.order, turn: g.turn, shots: g.shots, id: g.id,
        desk: g.desk, desks: g.desks, vanish: null, vanishIn: null, vanishWait: null,
        gauge: g.gauge, lap: g.lap || 0, lapDone: g.lapDone || [], extra: !!g.extra, event: null, eventId: 0,
        walls: g.walls || [], icy: g.icy || 0, icyNext: !!g.icyNext, fx: g.fx || [], items: g.items || [],
        crystals: g.crystals || [], rainbow: g.rainbow || null, mode: 'stage',
        bodies: g.bodies, players: g.players, result: g.result, looks: g.looks, board: g.board, boardClear: !!g.boardClear, boss: !!g.boss,
        puddles: g.puddles || [], bolts: g.bolts || [], boltEvent: g.boltEvent || 0,
      },
    };
  }

  // 番の終わり：倒れた敵・落ちた自分・盤面クリアを決めて、次の番へ
  finishTurn(shooter, now = Date.now(), opt = {}) {
    const s = this.s, g = s.game;
    if (!opt.keepTurn && !opt.again && !opt.skipped) s.stage.shots += shooter === 0 ? 1 : 0;
    // 番を終えた定規：水たまり（緑・黄）とはさみの判定（落雷や連打の途中は番の終わりではない）
    if (!opt.keepTurn && !opt.again && !opt.strike) this.turnEndPaint(shooter);
    const credit = (opt.creditTo ?? shooter) === 0;
    // 身代わり：使った次の相手の番に落ちた（体力0で倒れた）定規が、机の真ん中に戻る（体力は半分。倒れたときは最大の半分）
    g.bodies.forEach((b, i) => {
      const down = b.state !== 'desk' || ((b.hp ?? 1) <= 0 && !this.zeroSurvives(i));
      if (!b.sub || !down || !g.players[i].alive) return;
      const ko = b.state === 'desk';
      b.state = 'desk'; b.sub = false;
      Object.assign(b, this.freeSpot(i));
      b.hp = ko ? Math.round((b.maxHp || 100) / 2) : Math.round((b.hp ?? 100) / 2 * 10) / 10;
      this.pushFx({ kind: 'subUsed', owner: i, x: b.x, y: b.y });
    });
    // 敵：机から落ちたか、体力が0になったら倒れる
    g.bodies.forEach((b, i) => {
      if (i === 0 || !g.players[i].alive) return;
      if (b.state !== 'desk') {
        g.players[i].alive = false; g.players[i].how = 'fall';
        if (credit) g.kos[0]++;
        this.pushFx({ kind: 'down', owner: i, how: 'fall', x: b.x, y: b.y });
      } else if ((b.hp ?? 1) <= 0) {
        b.state = 'gone';
        g.players[i].alive = false; g.players[i].how = 'ko';
        if (credit) g.kos[0]++;
        this.pushFx({ kind: 'down', owner: i, how: 'ko', x: b.x, y: b.y });
      }
    });
    // 自分が落ちたら、ライフを1つ使って盤面に戻る。ライフが残っていなければ、このマップは失敗
    // （体力0では倒れず、瀕死で残る）
    if (g.bodies[0].state !== 'desk') {
      const how = opt.strike ? '落雷で机から落とされた' : shooter === 0 ? '自分の定規が机から落ちた（自滅）' : `${this.look(shooter).name}に机から落とされた`;
      const lives = s.stage.lives ?? LIVES;
      if (lives > 1) {
        s.stage.lives = lives - 1;
        this.respawn();
        return this.finishTurn(shooter, now, { ...opt, again: true });
      }
      s.stage.lives = 0;
      g.bodies[0].state = 'gone';
      g.players[0].alive = false;
      g.players[0].selfOut = shooter === 0;
      const reason = `ライフがなくなった（最後は${how}）`;
      g.result = { winners: [], title: 'マップ失敗', reason, outOrder: [] };
      s.stage.result = { cleared: false, reason };
      s.phase = 'over';
      return { saved: false, vanished: null };
    }
    this.markWeak();
    // 敵が全部倒れたら盤面クリア（次の盤面へは nextBoard で進む）
    if (g.players.every((p, i) => i === 0 || !p.alive)) {
      g.boardClear = true;
      g.extra = false;
      return { saved: false, vanished: null };
    }
    if (opt.keepTurn && g.players[shooter].alive) {
      g.extra = true; // 連打：同じ番のまま
      return { saved: false, vanished: null };
    }
    g.extra = false;
    this.tickTurn();
    if (g.walls?.length) g.walls = g.walls.map((w) => ({ ...w, left: w.left - 1 })).filter((w) => w.left > 0);
    if (g.icy > 0) g.icy--;
    if (g.icyNext) { g.icy = 1; g.icyNext = false; }
    this.advanceTurn();
    return { saved: false, vanished: null };
  }

  // 落ちた自分を盤面に戻す：盤面の最初の位置（ほかの定規と重なるなら、空いている所）
  respawn() {
    const g = this.s.game, st = this.s.stage;
    const me = g.bodies[0];
    const start = mapOf(st.id, st.map).boards[st.board].me;
    Object.assign(me, { x: start.x, y: start.y, a: start.a ?? 0, state: 'desk', anchor: false });
    const body = this.makeBody(me);
    const blocked = g.bodies.some((o, j) => j > 0 && o.state === 'desk' && g.players[j].alive && Physics.collide(body, this.makeBody(o)));
    if (blocked) Object.assign(me, this.freeSpot(0));
    me.hp = Math.max(me.hp ?? 0, Math.round(me.maxHp * RESPAWN_HP) / 100);
    this.pushFx({ kind: 'respawn', owner: 0, x: me.x, y: me.y, lives: st.lives });
  }

  // 盤面クリアのあと：次の盤面へ。最後の盤面ならマップクリア
  nextBoard() {
    const s = this.s, g = s.game, st = s.stage;
    if (st.board + 1 >= st.boards) {
      st.result = { cleared: true };
      g.result = { winners: [0], title: 'マップクリア！', reason: '', outOrder: [] };
      s.phase = 'over';
      const me = s.members[0];
      this.record = { stage: st.id, map: st.map, ruler: me.loadout?.ruler, userId: me.userId, shots: st.shots };
      return { t: 'state', state: this.snapshot(), stage: 'clear' };
    }
    const me = g.bodies[0];
    st.board++;
    this.loadBoard(st.board, { hp: me.hp ?? me.maxHp, gauge: g.gauge?.[0] ?? 0 });
    return { t: 'state', state: this.snapshot(), stage: 'board', board: st.board };
  }

  // ---- 敵の番 ----
  // 戻り値：画面へ送るメッセージの配列（動く敵は shot、置物は state）
  enemyTurn(now = Date.now(), rand = Math.random) {
    const out = this.enemyAct(now, rand);
    // 番が移るときに落ちた落雷（はじいた動きにつながらなかったもの）
    return [...out, ...this.strikeMessages(now)];
  }

  enemyAct(now, rand) {
    const g = this.s.game;
    const i = g.turn;
    const b = g.bodies[i];
    const d = ENEMIES[b?.enemy];
    if (!d) { this.advanceTurn(); return []; }
    if (d.move) {
      const pre = [];
      // ボスの落雷：ゲージがたまっていて、自分の予告が出ていなければ、はじく前に使う
      if (d.skill === 'raiun' && (g.gauge?.[i] ?? 0) >= GAUGE.max && !g.extra && !(g.bolts || []).some((x) => x.owner === i)) {
        const form = Physics.formIndex(b.hp, b.maxHp);
        b.st = { ...(b.st || {}), boltCount: [3, 4, 5][form] ?? 3 };
        pre.push(...this.handle(g.order[i], { t: 'skill' }, now).map((o) => o.msg));
      }
      const shot = planEnemy(this, i, rand);
      const out = this.handle(g.order[i], { t: 'flick', ...shot }, now);
      return [...pre, ...out.map((o) => o.msg)];
    }
    if (d.act === 'swing') return this.swing(i, d, now);
    if (d.act === 'pull') return this.pull(i, d, now);
    const before = g.fxId || 0;
    if (d.act === 'nibble') this.nibble(i, d);
    else if (d.act === 'heal') this.mend(i, d);
    const acted = (g.fxId || 0) > before;
    this.finishTurn(i, now);
    // 効果がなかった置物は、画面に何も送らない（番だけ進める）
    return acted ? [{ t: 'state', state: this.snapshot(), act: i }] : [];
  }

  // 自分の定規の外形から、点 (x, y) までのいちばん近い距離
  distToMe(x, y) {
    const g = this.s.game;
    const me = g.bodies[0];
    if (me.state !== 'desk') return Infinity;
    const body = this.makeBody(me);
    let best = Math.hypot(me.x - x, me.y - y);
    for (const v of Physics.worldVerts(body)) best = Math.min(best, Math.hypot(v.x - x, v.y - y));
    return best;
  }

  // 消しゴム：すぐそばにいる自分の体力を少し削る
  nibble(i, d) {
    const g = this.s.game, b = g.bodies[i], me = g.bodies[0];
    if (this.distToMe(b.x, b.y) > d.range) return;
    const amount = Math.round(d.amount * scaleOf(this.diff()).act * 10) / 10;
    me.hp = Math.max(0, Math.round(((me.hp ?? 100) - amount) * 10) / 10);
    this.pushFx({ kind: 'nibble', owner: i, x: me.x, y: me.y, amount, from: { x: b.x, y: b.y } });
  }

  // 修正テープ：近くの敵（自分以外）の体力を直す
  mend(i, d) {
    const g = this.s.game, b = g.bodies[i];
    const healed = [];
    g.bodies.forEach((o, j) => {
      if (j === 0 || j === i || !g.players[j].alive || o.state !== 'desk') return;
      if (Math.hypot(o.x - b.x, o.y - b.y) > d.range || o.hp >= o.maxHp) return;
      const add = Math.min(Math.round(o.maxHp * d.amount) / 100, o.maxHp - o.hp); // amount は体力の最大に対する％
      o.hp = Math.round((o.hp + add) * 10) / 10;
      healed.push({ owner: j, x: o.x, y: o.y, amount: Math.round(add) });
    });
    if (healed.length) this.pushFx({ kind: 'mend', owner: i, x: b.x, y: b.y, healed, r: d.range });
  }

  // コンパス：近くにいる定規を弾き飛ばすだけ（ダメージは与えない。弾かれた定規どうしがぶつかっても減らない）
  swing(i, d, now) {
    const g = this.s.game, b = g.bodies[i];
    const near = g.bodies.some((o, j) => j !== i && o.state === 'desk' && g.players[j].alive && Math.hypot(o.x - b.x, o.y - b.y) < d.range + 8);
    if (!near || this.distToMe(b.x, b.y) > d.range + 4) {
      this.finishTurn(i, now);
      return [];
    }
    const world = this.buildWorld();
    world.noDamage = true;
    const src = world.bodies[i];
    const sc = scaleOf(this.diff());
    const frames = [encodeFrame(world)];
    for (let k = 0; k < 8; k++) frames.push(encodeFrame(world));
    const hit = Physics.blast(world, src, d.range, d.speed * sc.body, 0, 'compass');
    const blast = { kind: 'compass', f: frames.length - 1, x: round2(src.x), y: round2(src.y), r: d.range, hit };
    const { falls, hits, pickups, marks } = runWorld(world, frames);
    this.applyWorld(world);
    this.finishTurn(i, now);
    return [{ t: 'shot', by: i, frames, falls, saved: false, crit: null, vanished: null, skill: null, blast, hits, pickups, marks, state: this.snapshot() }];
  }

  // U字磁石：近く（range）にある定規（自分の定規・敵の定規）を、少し引き寄せる。メタルは2倍
  pullTargets(i, d) {
    const g = this.s.game, src = g.bodies[i];
    const out = [];
    g.bodies.forEach((o, j) => {
      if (j === i || o.state !== 'desk' || !g.players[j].alive) return;
      if (j !== 0 && o.enemy !== 'ruler' && !ENEMIES[o.enemy]?.boss) return; // 定規だけ（文房具・置物は引き寄せない）
      const dist = Physics.distToBody(this.makeBody(o), src.x, src.y);
      if (dist < d.range) out.push(j);
    });
    return out;
  }

  pull(i, d, now) {
    const g = this.s.game;
    const targets = this.pullTargets(i, d);
    if (!targets.length) {
      this.finishTurn(i, now);
      return [];
    }
    const world = this.buildWorld();
    world.noDamage = true;
    const src = world.bodies[i];
    const frames = [];
    for (let k = 0; k < 8; k++) frames.push(encodeFrame(world));
    const sc = scaleOf(this.diff());
    for (const j of targets) {
      const b = world.bodies[j];
      const dx = src.x - b.x, dy = src.y - b.y, len = Math.hypot(dx, dy) || 1;
      // メタルは約2倍の距離を動く（すべりにくさの違いも込みで、速さ1.5倍がちょうど2倍）
      const metal = Physics.RULERS[b.specKey]?.mat === 'metal';
      const v = d.speed * Math.sqrt(sc.act) * (metal ? 1.5 : 1);
      b.vx += (dx / len) * v; b.vy += (dy / len) * v;
    }
    const blast = { kind: 'pull', f: frames.length - 1, x: round2(src.x), y: round2(src.y), r: d.range, hit: targets };
    const { falls, hits, pickups, marks } = runWorld(world, frames);
    this.applyWorld(world);
    this.pushFx({ kind: 'pull', owner: i, x: round2(src.x), y: round2(src.y), targets });
    this.finishTurn(i, now);
    return [{ t: 'shot', by: i, frames, falls, saved: false, crit: null, vanished: null, skill: null, blast, hits, pickups, marks, state: this.snapshot() }];
  }
}

// はさみの刃の間（要から刃先までの三角）の点。ここに定規の形がかかっていたら「刃の間」
function bladeSpots(o) {
  const { len, open } = Physics.BLADE;
  const out = [];
  const c = Math.cos(o.a), s = Math.sin(o.a);
  for (let lx = 2; lx <= len; lx += 1) {
    const half = lx * Math.tan(open) - 0.6; // 刃の太さのぶん内側
    for (const k of [-0.6, 0, 0.6]) {
      const ly = half * k;
      out.push({ x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c });
    }
  }
  return out;
}

// 止まるまで動かす（コンパスの弾き飛ばし用）
function runWorld(world, frames) {
  const dt = STEP, perFrame = Math.round(1 / FPS / dt);
  const falls = [], hits = [], pickups = [], marks = [];
  let steps = 0, seen = 0;
  while (!Physics.atRest(world) && steps < MAX_SIM_SECONDS / dt) {
    for (let k = 0; k < perFrame; k++) {
      for (const b of Physics.step(world, dt)) falls.push({ owner: b.owner, f: frames.length, x: round2(b.x), y: round2(b.y) });
      steps++;
    }
    frames.push(encodeFrame(world));
    drain();
  }
  drain(); // 動かなかったとき（刺さっている相手だけ）も、ダメージは記録する
  for (const b of world.bodies) if (b.state === 'falling') b.state = 'gone';
  return { falls, hits, pickups, marks };
  function drain() {
    while (world.events && seen < world.events.length) {
      const e = world.events[seen++];
      if (e.type === 'hit') hits.push({ f: frames.length - 1, target: e.target, from: e.from, dmg: e.dmg, x: round2(e.x), y: round2(e.y), kind: e.kind });
      if (e.type === 'pickup') pickups.push({ f: frames.length - 1, item: e.item, owner: e.owner, amount: e.amount, x: round2(e.x), y: round2(e.y), ...(e.big ? { big: true } : {}) });
      if (MARK_TYPES.includes(e.type)) marks.push({ kind: e.type, f: frames.length - 1, x: round2(e.x), y: round2(e.y), owner: e.owner });
    }
  }
}

// ---- 敵のはじき方 ----
const gauss = (rand) => (rand() + rand() + rand() - 1.5) / 0.75;

// 机の端までの近さ
function margin(tiles, x, y) {
  let best = 16;
  for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let d = 0;
    while (d < best && tiles.some((t) => onTile(t, x + ux * d, y + uy * d))) d += 1;
    best = Math.min(best, d);
  }
  return best;
}

// はじいたあとの局面の良さ（敵 i から見て）
function evaluate(before, after, i) {
  const g0 = before.game, g = after.game;
  let score = 0;
  const p0 = g0.bodies[0], p = g.bodies[0];
  if (after.phase === 'over' && after.stage.result && !after.stage.result.cleared) score += 1000;
  score += ((p0.hp ?? 100) - (p.hp ?? 100)) * 2;
  const tiles = deskTiles(DESKS[g.desk]).filter((t) => g.desks.includes(t.i));
  if (p.state === 'desk') score += (16 - margin(tiles, p.x, p.y)) * 3;
  g.bodies.forEach((b, j) => {
    if (j === 0 || !g0.players[j]?.alive) return;
    const lost = (g0.bodies[j].hp ?? 0) - (b.hp ?? 0);
    if (!g.players[j].alive) score -= j === i ? 400 : 150;
    else {
      score -= lost * (j === i ? 0.6 : 0.4);
      if (j === i && b.state === 'desk') score += margin(tiles, b.x, b.y) * 2;
    }
  });
  return score;
}

function trial(core, i, input) {
  const sim = StageCore.restore(structuredClone(core.s));
  sim.rand = () => 0.99; // クリティカルは当てにしない
  const r = sim.shoot(input, Date.now());
  if (r.error) return -Infinity;
  return evaluate(core.s, sim.s, i);
}

export function planEnemy(core, i, rand = Math.random) {
  const g = core.s.game;
  const ai = aiOf(core.diff());
  const mine = g.bodies[i];
  const me = g.bodies[0];
  const shapeKey = Physics.shapeOf(mine.specKey, mine.hp, mine.maxHp);
  const sh = Physics.SHAPES[shapeKey];
  const sk = core.skillOf(i);
  const canSkill = !!sk && SKILLS[sk]?.mode === 'shot' && !g.extra && (g.gauge?.[i] ?? 0) >= GAUGE.max;
  const useSkill = canSkill && rand() < ai.skillRate;
  const meSpec = Physics.RULERS[me.specKey] || Physics.RULERS['straight30-acrylic'];
  const meHalf = Physics.SHAPES[Physics.shapeOf(me.specKey, me.hp, me.maxHp)]?.radius ?? Physics.SHAPES[meSpec.shape].radius;
  let best = null, bestScore = -Infinity;
  for (let k = 0; k < ai.samples; k++) {
    // 自分の定規のどこかを狙う
    const along = (rand() - 0.5) * 2 * meHalf * 0.6;
    const tx = me.x + Math.cos(me.a) * along, ty = me.y + Math.sin(me.a) * along;
    const len = Math.hypot(tx - mine.x, ty - mine.y) || 1;
    const off = (rand() - 0.5) * sh.radius * 0.5;
    const near = Physics.nearestOnShape(shapeKey, off, 0);
    const curve = useSkill && sk === 'hyaku' ? Math.round((rand() - 0.5) * 2 * (mine.st?.hyakuMax ?? 90)) : undefined;
    const c = { lx: near.x, ly: near.y, dx: (tx - mine.x) / len, dy: (ty - mine.y) / len, power: 0.35 + rand() * 0.65, skill: useSkill, curve };
    const score = trial(core, i, c) + rand() * 2;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  // 試したはじき方がどれも使えなかったとき（念のため）は、自分の定規へまっすぐ
  if (!best) {
    const len = Math.hypot(me.x - mine.x, me.y - mine.y) || 1;
    best = { lx: 0, ly: 0, dx: (me.x - mine.x) / len, dy: (me.y - mine.y) / len, power: 0.6, skill: false };
  }
  const ang = gauss(rand) * ai.aimNoise;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  return {
    ...best,
    dx: best.dx * cs - best.dy * sn, dy: best.dx * sn + best.dy * cs,
    power: Math.max(0.1, Math.min(1, best.power * (1 + gauss(rand) * ai.powerNoise))),
  };
}

// 画面へ送るメッセージの最後が、いまの状態（だれの番か）と合うようにする。
// 何もしなかった置物（のり・画びょう・遠くの消しゴムなど）の番は、メッセージを出さずに進むので、
// 最後のメッセージの状態が「敵の番」のままになり、画面で自分の番が来ないことがあった
export function syncMessages(core, messages) {
  const last = [...messages].reverse().find((m) => m.state);
  const s = core.s, g = s.game;
  const lg = last?.state?.game;
  if (!last || last.state.phase !== s.phase || lg?.id !== g?.id || lg?.turn !== g?.turn || !!lg?.extra !== !!g?.extra) {
    messages.push({ t: 'state', state: core.snapshot() });
  }
  return messages;
}

// 自分の番になるまで（または盤面クリア・失敗まで）敵を動かす。戻り値はメッセージの配列
export function runEnemies(core, now = Date.now(), rand = Math.random) {
  const out = [];
  for (let guard = 0; guard < 24; guard++) {
    const s = core.s, g = s.game;
    if (s.phase !== 'aim') break;
    if (g.boardClear) { out.push(core.nextBoard()); continue; }
    if (g.turn === 0) break;
    out.push(...core.enemyTurn(now, rand));
  }
  return out;
}
