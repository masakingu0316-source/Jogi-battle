// ステージ選択の画面（マップの一覧・マップの中身・使う定規・続きから）
import { STAGES, STAGE_ORDER, ENEMIES, REWARD, enemyLook, stageMaxHp, deskText } from './shared/stage.js';
import { ITEMS, levelInfo, levelBonus, STAGE_LEVEL_MAX, LEVEL_MAX, MATERIAL_INFO } from './shared/catalog.js';
import { previewRuler } from './ruler-paint.js';
import { stageRun } from './stage-client.js';

export function createStageUI({ app, $, esc, show, onStart, onResume, onAbandon }) {
  const ui = { stage: STAGE_ORDER[0], map: null, run: null };
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

  function render() {
    const st = stage(), p = progress();
    $('stageKicker').textContent = `ステージ ${STAGE_ORDER.indexOf(ui.stage) + 1}`;
    $('stageTitle').textContent = st.name;
    $('stageLead').textContent = `マップを1から順に攻略します。最後のマップでは「${st.boss}」が待っています。${p.cleared}／${st.maps.length} クリア`;
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
    $('foeList').innerHTML = Object.entries(ENEMIES).map(([k, d]) => `<li><span class="foe-dot" style="background:${d.color}"></span><b>${esc(k === 'ruler' ? '敵の定規' : d.name)}</b>${d.move ? '<em>動く</em>' : '<em class="still">置物</em>'}<span>${esc(d.desc)}</span></li>`).join('');
  }

  function renderDetail() {
    const st = stage(), p = progress();
    const n = ui.map;
    const m = st.maps[n - 1];
    const rec = p.maps[n];
    $('mdNo').textContent = `マップ ${n}${n === st.maps.length ? '・ラスボス' : ''}`;
    $('mdTitle').textContent = m.name;
    $('mdNote').textContent = m.note;
    $('mdBoards').innerHTML = m.boards.map((b, i) => {
      const foes = b.foes.map((f) => {
        const lk = enemyLook({ ...f, spec: f.spec || ENEMIES[f.t].spec });
        return `<span class="foe-chip${f.t === 'boss' ? ' boss' : ''}"><i style="background:${lk.color}"></i>${esc(lk.name)}</span>`;
      }).join('');
      return `<li><span class="bd-no">盤面${i + 1}</span><span class="bd-desk">${esc(deskText(b))}</span><span class="bd-foes">${foes}</span></li>`;
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
    previewRuler($('stagePreview'), { specKey: it.specKey, level: lv.level, pattern: setup.pattern, sticker: setup.sticker });
    const bonus = levelBonus(lv.level, STAGE_LEVEL_MAX) * 100;
    $('stageRulerNote').innerHTML = `<span class="mat mat-${it.mat}">${MATERIAL_INFO[it.mat].name}</span> ステージのレベル <b>Lv.${lv.level}</b>（対人ではLv.${Math.min(lv.level, LEVEL_MAX)}）`
      + `<br>体力 ${stageMaxHp(lv.level)}・重さとはじく力 +${bonus.toFixed(1)}%${lv.max ? '' : `・次のレベルまで あと${lv.need - lv.into}点`}`;
  }

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
    const st = stage(), p = progress();
    $('stageHomeNote').textContent = p.cleared >= st.maps.length
      ? `${st.name}：全${st.maps.length}マップ クリア！`
      : `${st.name}：${p.cleared}／${st.maps.length} クリア。文房具の敵を倒しながら、マップを順に進みます。`;
  }

  return { open, render, homeNote, setError, get selection() { return { stage: ui.stage, map: ui.map, ruler: ui.ruler }; }, set map(v) { ui.map = v; } };
}
