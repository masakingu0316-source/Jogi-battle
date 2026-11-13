// ステージ選択の画面（マップの一覧・マップの中身・使う定規・続きから）
import { STAGES, STAGE_ORDER, ENEMIES, REWARD, enemyLook, stageMaxHp, deskText, enemyMaxHp, diffOf, PAINT } from './shared/stage.js';
import { ITEMS, levelInfo, levelBonus, STAGE_LEVEL_MAX, LEVEL_MAX, MATERIAL_INFO } from './shared/catalog.js';
import { previewRuler } from './ruler-paint.js';
import { stageRun } from './stage-client.js';

export function createStageUI({ app, $, esc, show, onStart, onResume, onAbandon }) {
  // 最後に選んだ編（この端末だけで覚える）
  const STAGE_KEY = 'jogi.stage';
  let remembered = null;
  try { remembered = localStorage.getItem(STAGE_KEY); } catch { /* 使えなくても動く */ }
  const ui = { stage: STAGES[remembered] ? remembered : STAGE_ORDER[0], map: null, run: null };
  const stage = () => STAGES[ui.stage];
  const progress = () => app.me?.stage?.[ui.stage] || { cleared: 0, maps: {} };
  const stageLevel = (id) => levelInfo(app.me?.exp?.[id] || 0, STAGE_LEVEL_MAX);

  async function open(errorText) {
    app.view = 'stage';
    show('stagePick');
    window.scrollTo(0, 0);
    const p = progress();
    const last = stage().maps.length;
    if (!ui.map || ui.map > p.cleared + 1) ui.map = Math.min(p.cleared + 1, last);
    render();
    setError(errorText || '');
    ui.run = null;
    renderResume();
    ui.run = await stageRun();
    renderResume();
  }
  function setError(text) {
    $('stageError').textContent = text || '';
    $('stageError').hidden = !text;
  }

  function renderResume() {
    const r = ui.run;
    const live = r && r.state?.phase === 'aim';
    $('stageResume').hidden = !live;
    if (live) {
      const s = r.state.stage;
      $('stageResumeText').textContent = `${s.name} マップ${s.map}「${s.mapName}」の盤面${s.board + 1}を攻略中です`;
    }
  }

  // 編を選ぶ（可変定規編・破天荒編。どちらから遊んでもよい）
  function renderTabs() {
    $('stageTabs').innerHTML = STAGE_ORDER.map((id, i) => {
      const st = STAGES[id];
      const p = app.me?.stage?.[id] || { cleared: 0 };
      const all = p.cleared >= st.maps.length;
      const on = id === ui.stage;
      return `<button type="button" role="tab" class="stage-tab st-${id}${on ? ' on' : ''}${all ? ' done' : ''}" data-stage="${id}" aria-selected="${on}">
        <span class="stt-no">第${i + 1}編・${esc(st.place || '')}</span>
        <span class="stt-name">${esc(st.name)}</span>
        <span class="stt-prog">${all ? '全クリア' : `${p.cleared}／${st.maps.length}`}</span>
      </button>`;
    }).join('');
  }
  // この編に出てくる敵の種類（出てくる順）
  function foesOf(id) {
    const seen = [];
    for (const m of STAGES[id].maps) for (const b of m.boards) for (const f of b.foes) if (!seen.includes(f.t)) seen.push(f.t);
    return seen;
  }
  const hpOf = (t, n) => enemyMaxHp(t, ENEMIES[t]?.boss ? n : diffOf(ui.stage, n), app.game);

  function render() {
    const st = stage(), p = progress();
    renderTabs();
    $('stageKicker').textContent = `第${STAGE_ORDER.indexOf(ui.stage) + 1}編・${st.place || ''}`;
    $('stageTitle').textContent = st.name;
    $('stageLead').textContent = `${st.lead ? `${st.lead}。` : ''}マップを1から順に攻略します。最後のマップでは「${st.boss}」が待っています。${p.cleared}／${st.maps.length} クリア`;
    $('mapList').innerHTML = st.maps.map((m, i) => {
      const n = i + 1;
      const rec = p.maps[n];
      const open = n <= p.cleared + 1;
      const state = rec?.clears ? `クリア ${rec.clears}回` : open ? '挑戦できる' : '未開放';
      const boss = n === st.maps.length;
      return `<li><button type="button" class="map-item${n === ui.map ? ' on' : ''}${rec?.clears ? ' done' : ''}${boss ? ' boss' : ''}" data-map="${n}" ${open ? '' : 'disabled'} aria-pressed="${n === ui.map}">
        <span class="mi-no">${n}</span>
        <span class="mi-name">${esc(m.name)}</span>
        <span class="mi-state">${state}</span>
      </button></li>`;
    }).join('');
    renderDetail();
    $('foeBookTitle').textContent = `${st.name}の敵の図鑑`;
    const paint = ui.stage === 'hatenko'
      ? Object.values(PAINT.colors).map((c) => `<li class="paint"><span class="foe-dot puddle" style="background:${c.color}"></span><b>${esc(c.name)}の水たまり</b><em class="still">絵の具</em><span>${esc(c.desc)}${c.name === '赤' || c.name === '青' ? '（上を通っている間だけ）' : ''}。敵にも同じように効く</span></li>`).join('')
        + `<li class="paint"><span class="foe-dot bolt"></span><b>落雷</b><em class="still">予告</em><span>墨の円で落ちる場所を予告。半径の中の定規にダメージ30と、外向きの強い吹き飛ばし。パレットに当たると絵の具がはねる</span></li>`
      : '';
    $('foeList').innerHTML = foesOf(ui.stage).map((k) => {
      const d = ENEMIES[k];
      return `<li><span class="foe-dot" style="background:${d.color}"></span><b>${esc(k === 'ruler' ? '敵の定規' : d.name)}</b>${d.move ? '<em>動く</em>' : '<em class="still">置物</em>'}<span>${esc(d.desc)}</span></li>`;
    }).join('') + paint;
  }

  function renderDetail() {
    const st = stage(), p = progress();
    const n = ui.map;
    const m = st.maps[n - 1];
    const rec = p.maps[n];
    $('mdNo').textContent = `マップ ${n}${n === st.maps.length ? '・ラスボス' : ''}`;
    $('mdTitle').textContent = m.name;
    $('mdNote').textContent = `${m.note}。ライフは3つ（2回までは落ちても盤面に戻れる）`;
    $('mdBoards').innerHTML = m.boards.map((b, i) => {
      const foes = b.foes.map((f) => {
        const lk = enemyLook({ ...f, spec: f.spec || ENEMIES[f.t].spec });
        const hp = hpOf(f.t, n);
        return `<span class="foe-chip${ENEMIES[f.t]?.boss ? ' boss' : ''}" title="体力 ${hp}"><i style="background:${lk.color}"></i>${esc(lk.name)}<b class="foe-hp">${hp}</b></span>`;
      }).join('');
      // はじめから机にある水たまり（色ごとの数）と、場のイベントの落雷
      const pools = {};
      for (const pl of b.pools || []) pools[pl.c] = (pools[pl.c] || 0) + 1;
      const extra = Object.entries(pools).map(([c, k]) => `<span class="foe-chip puddle" title="${esc(PAINT.colors[c].desc)}"><i style="background:${PAINT.colors[c].color}"></i>${esc(PAINT.colors[c].name)}の水たまり${k > 1 ? `×${k}` : ''}</span>`).join('')
        + (m.bolts ? `<span class="foe-chip bolt" title="1周ごとに予告して、次の周の初めに落ちる"><i></i>落雷${m.bolts}か所</span>` : '');
      return `<li><span class="bd-no">盤面${i + 1}</span><span class="bd-desk">${esc(deskText(b))}</span><span class="bd-foes">${foes}${extra}</span></li>`;
    }).join('');
    const item = n === st.maps.length && st.reward ? ITEMS[st.reward] : null;
    const firstDone = !!rec?.clears;
    $('mdReward').innerHTML = `クリアするたび：使った定規に経験値 +${REWARD.exp(n)}<br>`
      + `初クリア：えんぴつ ${REWARD.coins(n)}本${item ? `と「${esc(item.name)}」` : ''}${firstDone ? '（もらいました）' : ''}`
      + (rec?.best ? `<br>いちばん少ない打った回数：${rec.best}回` : '');
    renderRuler();
  }

  function renderRuler() {
    const me = app.me;
    if (!me) return;
    const ids = Object.keys(ITEMS).filter((id) => ITEMS[id].kind === 'ruler' && me.owned.includes(id));
    const opts = ids.map((id) => `<option value="${id}">${esc(ITEMS[id].name)} Lv.${stageLevel(id).level}</option>`).join('');
    const sel = $('stageRuler');
    if (sel.dataset.opts !== opts) { sel.innerHTML = opts; sel.dataset.opts = opts; }
    const want = ui.ruler && ids.includes(ui.ruler) ? ui.ruler : ids.includes(me.selectedRuler) ? me.selectedRuler : ids[0];
    sel.value = want;
    ui.ruler = want;
    const it = ITEMS[want];
    const lv = stageLevel(want);
    const setup = me.setups?.[want] || {};
    previewRuler($('stagePreview'), { specKey: it.specKey, art: it.art, level: lv.level, pattern: setup.pattern, sticker: setup.sticker });
    const bonus = levelBonus(lv.level, STAGE_LEVEL_MAX) * 100;
    $('stageRulerNote').innerHTML = `<span class="mat mat-${it.mat}">${MATERIAL_INFO[it.mat].name}</span> ステージのレベル <b>Lv.${lv.level}</b>（対人ではLv.${Math.min(lv.level, LEVEL_MAX)}）`
      + `<br>体力 ${stageMaxHp(lv.level)}・重さとはじく力 +${bonus.toFixed(1)}%${lv.max ? '' : `・次のレベルまで あと${lv.need - lv.into}点`}`;
  }

  $('stageTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-stage]');
    if (!b || b.dataset.stage === ui.stage) return;
    ui.stage = b.dataset.stage;
    try { localStorage.setItem(STAGE_KEY, ui.stage); } catch { /* 覚えられなくてもよい */ }
    const p = progress();
    ui.map = Math.min(p.cleared + 1, stage().maps.length);
    render();
    setError('');
  });
  $('mapList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-map]');
    if (!b || b.disabled) return;
    ui.map = +b.dataset.map;
    render();
    setError('');
    if (window.matchMedia('(max-width: 760px)').matches) $('mapDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('stageRuler').addEventListener('change', () => { ui.ruler = $('stageRuler').value; renderRuler(); });
  $('stageStart').addEventListener('click', async () => {
    setError('');
    $('stageStart').disabled = true;
    try { await onStart(ui.stage, ui.map, ui.ruler); }
    finally { $('stageStart').disabled = false; }
  });
  $('resumeBtn').addEventListener('click', () => { if (ui.run) onResume(ui.run); });
  $('abandonBtn').addEventListener('click', async () => { await onAbandon(); ui.run = null; renderResume(); });

  // ホームの「ステージ」の欄
  function homeNote() {
    if (!app.me) return;
    $('stageHomeNote').textContent = STAGE_ORDER.map((id) => {
      const st = STAGES[id], p = app.me?.stage?.[id] || { cleared: 0 };
      return `${st.short || st.name} ${p.cleared >= st.maps.length ? '全クリア' : `${p.cleared}／${st.maps.length}`}`;
    }).join('・');
  }

  return { open, render, homeNote, setError, get selection() { return { stage: ui.stage, map: ui.map, ruler: ui.ruler }; }, set map(v) { ui.map = v; }, set stage(v) { if (STAGES[v]) ui.stage = v; } };
}
