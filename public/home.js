// ホーム画面（1画面）：資源の帯／相棒の定規／大ボタン3つ、下のタブ、受け取り箱
import Physics from './shared/physics.js';
import { titleOf } from './shared/dojo.js';
import { SKILLS, TRAITS, skillDesc, traitDesc } from './shared/rules.js';
import { ITEMS, ECONOMY, RULER_RARITY, rulerList, rulerTune, resolveLoadout, levelInfo, STAGE_LEVEL_MAX, defaultConfig } from './shared/catalog.js';
import { paintRuler, matLook, iconRuler } from './ruler-paint.js';
import { drawAvatar, drawAvatarBg } from './avatar-paint.js';
import { avatarKey } from './shared/avatar.js';
import { levelOfRuler } from './ruler-info.js';

export function createHome({ app, $, esc, toast, account, onNav, onAvatar }) {
  const game = () => app.game || defaultConfig();
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* 保存できなくても動く */ } },
  };

  // ---- 持っている定規（定規ケースと同じ並び） ----
  const ownedRulers = () => rulerList().filter((it) => app.me?.owned.includes(it.id));
  const partnerId = () => (app.me?.owned.includes(app.me.selectedRuler) ? app.me.selectedRuler : ownedRulers()[0]?.id);

  // 重さ・はじく力のバー：全部の定規のいちばん大きい値（上乗せ最大のとき）を 100% にする
  function statMax() {
    const cfg = game();
    let mass = 1, power = 1;
    for (const k of Object.keys(Physics.RULERS)) {
      const r = Physics.RULERS[k];
      if (r.enemy || r.teacher) continue;
      const t = rulerTune(k, cfg);
      mass = Math.max(mass, t.mass * 1.16);
      power = Math.max(power, Math.pow(r.mass / 26, Physics.ENERGY_MASS_EXP ?? 0.7) * (t.power / 100) * 1.16);
    }
    return { mass, power };
  }
  function stats(id) {
    const it = ITEMS[id];
    const lo = resolveLoadout({ ...(app.me.setups?.[id] || {}), ruler: id }, game(), levelOfRuler(app.me, id).level);
    const t = rulerTune(it.specKey, game());
    const spec = Physics.RULERS[it.specKey];
    const mass = t.mass * lo.mods.mass;
    const power = Math.pow(spec.mass / 26, Physics.ENERGY_MASS_EXP ?? 0.7) * (t.power / 100) * lo.mods.power;
    const max = statMax();
    return { lo, mass, massPct: Math.min(100, (mass / max.mass) * 100), powerPct: Math.min(100, (power / max.power) * 100) };
  }

  // ---- 1段目：資源の帯 ----
  let dailyAt = null;
  function renderRes() {
    $('resCoins').textContent = app.me.coins;
    $('resName').textContent = app.me.name;
    dailyAt = performance.now() + (app.me.nextDaily ?? 0);
    tickDaily();
  }
  function tickDaily() {
    if (dailyAt === null || !app.me) return;
    const left = Math.max(0, dailyAt - performance.now());
    const s = Math.ceil(left / 1000);
    $('resDailyTime').textContent = `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    if (left <= 0) {
      // 日付が変わった：もう一度読み込むと、毎日ボーナスが受け取り箱に届く
      dailyAt = null;
      account.refresh(true).then(() => { if (!$('home').hidden) render(); });
    }
  }
  setInterval(tickDaily, 1000);

  // ---- 2段目：相棒の定規 ----
  let anim = 0, lastDraw = 0, slide = null; // slide：持ち替えたときの横すべり { from, dir, t0 }
  function drawPartner(now) {
    const c = $('partnerCanvas');
    if ($('home').hidden || !app.me) { anim = 0; return; }
    anim = requestAnimationFrame(drawPartner);
    if (now - lastDraw < 33) return;
    lastDraw = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // アバターが机の向こうに立ち、手前の机に相棒の定規を置く
    const lay = sceneLayout(w, h);
    const av = app.me.avatar;
    if (av) {
      // 背景（教室・黒板など）を、机より上いっぱいに
      ctx.save();
      ctx.beginPath(); ctx.roundRect(0, 0, w, lay.deskTop + 12, [12, 12, 0, 0]); ctx.clip();
      if (!drawAvatarBg(ctx, av, { x: 0, y: 0, w, h: lay.deskTop + 12 })) {
        ctx.fillStyle = 'rgba(30, 40, 70, 0.06)'; ctx.fillRect(0, 0, w, lay.deskTop + 12);
      }
      ctx.restore();
      // 体（少し息をするように上下）
      const img = avatarSprite(av, lay, dpr);
      const bob = Math.sin(now / 900) * 0.8;
      ctx.drawImage(img, lay.ax, lay.ay + bob, lay.aw, lay.ah);
    }
    // 机（手前が広い台形・木目）
    const { deskTop } = lay;
    const farL = w * 0.07, farR = w * 0.93, nearL = 0, nearR = w;
    const deskPath = () => { ctx.beginPath(); ctx.moveTo(farL, deskTop); ctx.lineTo(farR, deskTop); ctx.lineTo(nearR, h); ctx.lineTo(nearL, h); ctx.closePath(); };
    ctx.save();
    ctx.shadowColor = 'rgba(20, 28, 50, 0.32)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = -2;
    ctx.fillStyle = '#d9bb8f'; deskPath(); ctx.fill();
    ctx.restore();
    ctx.save();
    deskPath(); ctx.clip();
    const grd = ctx.createLinearGradient(0, deskTop, 0, h); grd.addColorStop(0, 'rgba(120,80,40,.18)'); grd.addColorStop(1, 'rgba(255,255,255,.08)');
    ctx.fillStyle = grd; ctx.fillRect(0, deskTop, w, h - deskTop);
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = `rgba(122, 78, 38, ${0.05 + rnd() * 0.08})`;
      ctx.lineWidth = 0.6 + rnd() * 1.2;
      const y0 = deskTop + rnd() * (h - deskTop), amp = 1 + rnd() * 3, fr = 0.01 + rnd() * 0.02, ph = rnd() * 6;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 6) { const y = y0 + Math.sin(x * fr + ph) * amp; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.restore();
    // 机の奥のふち
    ctx.strokeStyle = 'rgba(110, 70, 36, 0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(farL, deskTop + 1); ctx.lineTo(farR, deskTop + 1); ctx.stroke();
    const dw = w * 0.92, dh = (h - deskTop) * 0.8;
    // 相棒（少し斜めに大きく）
    const id = partnerId();
    if (!id) return;
    const drawOne = (rid, offset, alpha) => {
      const it = ITEMS[rid];
      const setup = app.me.setups?.[rid] || {};
      const lv = levelOfRuler(app.me, rid);
      const shapeKey = Physics.RULERS[it.specKey].forms ? Physics.RULERS[it.specKey].forms[1] : Physics.RULERS[it.specKey].shape;
      const sh = Physics.SHAPES[shapeKey];
      const ang = sh.kind === 'rect' ? -0.2 : -0.12;
      const span = sh.radius * 2;
      const px = Math.min((dw * 0.86) / span, (dh * 0.8) / (sh.kind === 'rect' ? Math.max(sh.W * 3.5, span * 0.32) : span * 0.75), 26);
      ctx.save();
      ctx.globalAlpha = alpha;
      // 机に置いた定規（奥行きの分だけ、縦を少しつぶす）
      ctx.setTransform(px * dpr, 0, 0, px * dpr * 0.8, (w / 2 + offset) * dpr, (deskTop + (h - deskTop) * 0.55) * dpr);
      paintRuler(ctx, { owner: 0, specKey: it.specKey, shapeKey, level: lv.level, art: it.art, pattern: setup.pattern, sticker: setup.sticker, pl: { ...matLook(it.mat), name: '' }, x: 0, y: 0, a: ang }, px, false, now);
      ctx.restore();
    };
    if (slide && now - slide.t0 < 260) {
      const t = (now - slide.t0) / 260, e = 1 - (1 - t) * (1 - t);
      drawOne(slide.from, -slide.dir * w * 0.6 * e, 1 - e);
      drawOne(id, slide.dir * w * 0.6 * (1 - e), e);
    } else {
      slide = null;
      drawOne(id, 0, 1);
    }
  }
  // 机とアバターの位置（キャンバスの大きさから）
  function sceneLayout(w, h) {
    const deskTop = Math.round(h * 0.5);
    // 頭のてっぺん（単位14）を上の少し下、腰（単位108）を机の奥のふちに合わせる
    const k = (deskTop - h * 0.04) / (108 - 12);
    const aw = 120 * k, ah = 184 * k;
    return { deskTop, k, aw, ah, ax: (w - aw) / 2, ay: h * 0.04 - 12 * k };
  }
  // アバターの絵は、見た目か大きさが変わったときだけ描き直す
  let sprite = null;
  function avatarSprite(av, lay, dpr) {
    const key = `${avatarKey(av)}|${Math.round(lay.aw)}|${dpr}`;
    if (sprite?.key === key) return sprite.c;
    const c = document.createElement('canvas');
    c.width = Math.round(lay.aw * dpr); c.height = Math.round(lay.ah * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    drawAvatar(g, av, { x: 0, y: 0, w: lay.aw, h: lay.ah, view: 'full', bg: false });
    sprite = { key, c };
    return c;
  }
  function renderPartner() {
    renderAvatarCue();
    const id = partnerId();
    if (!id) return;
    const it = ITEMS[id];
    const st = stats(id);
    const lv = levelOfRuler(app.me, id);
    const slv = levelInfo(app.me.exp?.[id] || 0, STAGE_LEVEL_MAX);
    const rr = RULER_RARITY[it.rarity] || RULER_RARITY.N;
    $('piRar').textContent = it.rarity;
    $('piRar').style.setProperty('--rar', rr.color);
    $('piRar').title = `${rr.name}（${rr.theme}）`;
    $('piName').textContent = it.name;
    $('piLv').textContent = `Lv.${lv.level}${slv.level > lv.level ? `（ステージLv.${slv.level}）` : ''}`;
    $('piMass').style.width = `${st.massPct.toFixed(0)}%`;
    $('piPower').style.width = `${st.powerPct.toFixed(0)}%`;
    $('piMass').parentElement.title = `重さ ${st.mass.toFixed(1)}g`;
    const sk = SKILLS[st.lo.skill];
    $('piSkill').innerHTML = sk ? `<em style="--sk:${sk.color}">必殺</em>${esc(sk.name)}` : '';
    $('piSkill').title = sk ? skillDesc(st.lo.skill, st.lo.skillTune) : '';
    const tr = st.lo.trait && TRAITS[st.lo.trait];
    $('piTrait').hidden = !tr;
    $('piTrait').innerHTML = tr ? `<em>特性</em>${esc(tr.name)}` : '';
    $('piTrait').title = tr ? traitDesc(st.lo.trait, st.lo.traitPct) : '';
    const list = ownedRulers();
    const i = list.findIndex((x) => x.id === id);
    $('partnerCount').textContent = `${i + 1}／${list.length}`;
    $('partnerPrev').hidden = $('partnerNext').hidden = list.length < 2;
    if (!anim) anim = requestAnimationFrame(drawPartner);
  }

  // 持ち替え：すぐ画面を変え、少し待ってからサーバーに保存する（続けて回したときに1回で済むように）
  let saveTimer = 0;
  function shift(dir) {
    const list = ownedRulers();
    if (list.length < 2) return;
    const cur = partnerId();
    const i = list.findIndex((x) => x.id === cur);
    const next = list[(i + dir + list.length) % list.length].id;
    slide = { from: cur, dir, t0: performance.now() };
    app.me.selectedRuler = next;
    renderPartner();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const res = await fetch('/api/me/partner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ruler: app.me.selectedRuler }) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '相棒を保存できませんでした');
      } catch (e) { toast(e.message); }
    }, 450);
  }
  $('partnerPrev').addEventListener('click', () => shift(-1));
  $('partnerNext').addEventListener('click', () => shift(1));
  // 左右スワイプ
  let sw = null;
  $('partnerStage').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    sw = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  $('partnerStage').addEventListener('pointerup', (e) => {
    if (!sw || sw.id !== e.pointerId) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    sw = null;
    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.3) shift(dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      // 机より上（アバター）を押したら着せ替え、机を押したら定規ケース
      const r = $('partnerCanvas').getBoundingClientRect();
      const lay = sceneLayout(r.width, r.height);
      if (e.clientY - r.top < lay.deskTop) onAvatar?.();
      else onNav('case', { edit: true });
    }
  });
  $('partnerStage').addEventListener('pointercancel', () => { sw = null; });
  document.addEventListener('keydown', (e) => {
    if ($('home').hidden || document.querySelector('dialog[open]')) return;
    if (e.key === 'ArrowLeft') shift(-1);
    if (e.key === 'ArrowRight') shift(1);
  });

  // アバターをまだ作っていない人には「着せ替えできます」の印を出す（作って保存したら消える）
  function renderAvatarCue() {
    $('avatarCue').hidden = !app.me || app.me.avatarSet;
    // 称号（アバターの下、机の奥のふち）
    const t = titleOf(app.me?.title);
    $('homeTitle').hidden = !t;
    if (t) { $('homeTitle').textContent = t.name; $('homeTitle').style.setProperty('--tc', t.color); }
  }
  $('avatarCue').addEventListener('click', () => onAvatar?.());
  $('avatarBtn').addEventListener('click', () => onAvatar?.());

  // ---- 受け取り箱 ----
  function renderBadge() {
    const n = app.me?.inbox || 0;
    $('inboxBadge').hidden = !n;
    $('inboxBadge').textContent = n > 99 ? '99+' : String(n);
    $('inboxBtn').setAttribute('aria-label', n ? `受け取り箱（受け取っていないもの ${n}件）` : '受け取り箱');
  }
  let inboxItems = [], picking = null;
  const contentText = (x) => {
    if (x.kind === 'ticket') return 'SSRの定規を1本えらべる';
    const parts = [];
    if (x.coins) parts.push(`${ECONOMY.currency} ${x.coins}${ECONOMY.unit}`);
    if (x.item) parts.push(ITEMS[x.item]?.name || 'アイテム');
    return parts.join('・');
  };
  // もう持っているアイテム：受け取ると、えんぴつに変わる
  const ownedNote = (x) => (x.owned ? `<span class="ib-owned">もう持っているので、受け取ると${ECONOMY.currency}${x.refund}${ECONOMY.unit}になります</span>` : '');
  async function openInbox() {
    const d = $('inboxSheet');
    picking = null;
    $('inboxPick').hidden = true;
    $('inboxList').innerHTML = '<li class="empty">読み込み中…</li>';
    if (!d.open) d.showModal();
    try {
      const r = await (await fetch('/api/inbox', { cache: 'no-store' })).json();
      inboxItems = r.inbox || [];
    } catch { inboxItems = []; }
    renderInbox();
  }
  function renderInbox() {
    $('inboxList').innerHTML = inboxItems.length ? inboxItems.map((x) => {
      const d = new Date(x.at);
      const ik = ITEMS[x.item]?.kind;
      const icon = x.kind === 'ticket' ? '券' : x.item ? (ik === 'ruler' ? '定' : ik === 'avatar' ? '着' : ik === 'title' ? '称' : '飾') : x.kind === 'daily' ? '日' : x.kind === 'stage' ? '旗' : '贈';
      return `<li class="ib-${x.kind}"><span class="ib-icon" aria-hidden="true">${icon}</span>
        <span class="ib-body"><b>${esc(x.title)}</b><small>${esc(contentText(x))}・${d.getMonth() + 1}/${d.getDate()}</small>${ownedNote(x)}</span>
        <button type="button" data-claim="${x.id}">${x.kind === 'ticket' ? 'えらぶ' : '受け取る'}</button></li>`;
    }).join('') : '<li class="empty">受け取るものはありません。毎日ボーナスは、日本時間の0時を過ぎてから開くと届きます。</li>';
    $('inboxAll').hidden = !inboxItems.some((x) => x.kind !== 'ticket');
  }
  async function claim(body) {
    const res = await fetch('/api/inbox/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || '受け取れませんでした'), { data });
    return data;
  }
  async function afterClaim(r) {
    account.setCoins(r.total);
    for (const id of r.items || []) if (!app.me.owned.includes(id)) app.me.owned.push(id);
    inboxItems = inboxItems.filter((x) => !r.claimed.includes(x.id));
    app.me.inbox = inboxItems.length;
    const bits = [];
    if (r.coins + r.refund) bits.push(`${ECONOMY.currency} +${r.coins + r.refund}${ECONOMY.unit}`);
    for (const id of r.items || []) bits.push(`「${ITEMS[id]?.name}」`);
    const conv = (r.converted || []).map((c) => `「${ITEMS[c.item]?.name}」は持っていたので${ECONOMY.currency}${c.refund}${ECONOMY.unit}に`);
    toast((bits.length ? `受け取りました：${bits.join('・')}` : '受け取りました') + (conv.length ? `（${conv.join('、')}）` : ''));
    renderInbox(); renderBadge(); renderRes(); renderPartner();
    await account.refresh();
  }
  $('inboxList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-claim]');
    if (!b) return;
    const id = Number(b.dataset.claim);
    b.disabled = true;
    try {
      await afterClaim(await claim({ id }));
    } catch (err) {
      if (err.data?.choices) {
        picking = id;
        $('inboxPick').hidden = false;
        $('inboxPickGrid').innerHTML = err.data.choices.map((cid) => {
          const it = ITEMS[cid];
          return `<button type="button" class="box-tile r-${it.rarity} m-${it.mat}" data-pick="${cid}" aria-label="${esc(it.name)}（${esc(SKILLS[it.skill]?.name || '')}）"><canvas data-picon="${cid}" aria-hidden="true"></canvas><span class="bt-rar">${it.rarity}</span><span class="bt-pname">${esc(it.name)}</span></button>`;
        }).join('');
        for (const c of document.querySelectorAll('[data-picon]')) { const it = ITEMS[c.dataset.picon]; iconRuler(c, { specKey: it.specKey, art: it.art, level: 1 }); }
        $('inboxPick').scrollIntoView({ block: 'nearest' });
      } else toast(err.message);
    } finally { b.disabled = false; }
  });
  $('inboxPickGrid').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b || picking === null) return;
    try {
      await afterClaim(await claim({ id: picking, pick: b.dataset.pick }));
      picking = null;
      $('inboxPick').hidden = true;
    } catch (err) { toast(err.message); }
  });
  $('inboxPickCancel').addEventListener('click', () => { picking = null; $('inboxPick').hidden = true; });
  $('inboxAll').addEventListener('click', async () => {
    $('inboxAll').disabled = true;
    try { await afterClaim(await claim({})); } catch (err) { toast(err.message); } finally { $('inboxAll').disabled = false; }
  });
  $('inboxBtn').addEventListener('click', openInbox);

  // ---- 下のタブ ----
  function setTab(name) {
    for (const b of document.querySelectorAll('[data-nav]')) {
      if (b.dataset.nav === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    if (name === 'case') {
      // 定規ケースを開いたら、NEW の印を消す
      const newest = Math.max(0, ...Object.values(app.me?.acquired || {}));
      store.set('jogi:caseSeen', String(newest));
    }
    renderNew();
  }
  function renderNew() {
    const seen = Number(store.get('jogi:caseSeen') || 0);
    const acq = app.me?.acquired || {};
    // はじめて開いた人は、今持っている分を見たことにする
    if (!store.get('jogi:caseSeen') && app.me) { store.set('jogi:caseSeen', String(Math.max(0, ...Object.values(acq)))); return renderNew(); }
    $('caseNew').hidden = !Object.values(acq).some((t) => t > seen);
  }
  for (const b of document.querySelectorAll('[data-nav]')) b.addEventListener('click', () => onNav(b.dataset.nav));

  function render() {
    if (!app.me) return;
    renderRes();
    renderPartner();
    renderBadge();
    renderNew();
  }
  window.addEventListener('resize', () => { lastDraw = 0; });
  return { render, renderBadge, renderNew, setTab, openInbox };
}
