// バトル道場の画面：次の相手・座席表（30人＋担任の先生）・使う定規・挑むボタン
import { ITEMS, levelInfo, LEVEL_MAX, brandSkill } from './shared/catalog.js';
import { SKILLS } from './shared/rules.js';
import { defaultClassmates, DOJO_SIZE, TEACHER_NO, RANKS, hanOf, TEACHER_RULER, CLEAR_REWARD } from './shared/dojo.js';
import { SLOT_INFO, parsePartId } from './shared/avatar.js';
import { avatarImage } from './avatar-paint.js';
import { previewRuler } from './ruler-paint.js';
import { dojoApi } from './dojo-client.js';

// 持ち物の名前（パーツは「名前（部位）」、柄は「定規の柄「…」」、称号は「称号「…」」）
export function rewardName(id) {
  const it = ITEMS[id];
  if (!it) return '';
  if (it.kind === 'pattern') return `定規の柄「${it.name}」`;
  if (it.kind === 'title') return `称号「${it.name}」`;
  if (it.kind === 'avatar') return `${it.partName}（${SLOT_INFO[parsePartId(id)?.slot]?.name || ''}）`;
  return it.name;
}
export const classmatesOf = (app) => (Array.isArray(app.game?.classmates) && app.game.classmates.length ? app.game.classmates : defaultClassmates());
export const noLabel = (c) => (c.no === TEACHER_NO ? '担任' : `${c.no}番`);

export function createDojoUI({ app, $, esc, show, toast, onStart, onPickRuler }) {
  let progress = null;
  let selected = null; // 座席表で選んでいる番号

  const list = () => classmatesOf(app);
  const byNo = (no) => list().find((c) => c.no === no) || null;
  const rulerName = (c) => (c.ruler === TEACHER_RULER ? '黒板用の大きな定規' : ITEMS[c.ruler]?.name || '');
  const skillName = (c) => {
    if (c.skill === 'none') return 'なし';
    const k = SKILLS[c.skill] ? c.skill : ITEMS[c.ruler] ? brandSkill(ITEMS[c.ruler], app.game) : 'shizuka';
    return SKILLS[k]?.name || '';
  };
  const beaten = (c) => !!progress?.beaten?.includes(c.id);

  async function open(errorText = '') {
    if (!app.me) return;
    app.view = 'dojo';
    show('dojoScreen');
    setError(errorText);
    if (app.me.dojo) progress = app.me.dojo;
    render();
    try {
      const d = await dojoApi('state');
      progress = d.progress;
      if (app.me) app.me.dojo = progress;
      if (d.lost) toast(`${d.lost.teacher ? '担任の先生' : `${d.lost.no}番 ${d.lost.name}`}との試合は途中で終わったので、負けになりました${d.lost.teacher ? '' : '。1番からやり直しです'}`);
    } catch (e) {
      if (!errorText) setError(e.message);
    }
    if (app.view === 'dojo') render();
  }
  function setError(text) {
    $('dojoError').textContent = text || '';
    $('dojoError').hidden = !text;
  }

  function render() {
    if (!app.me) return;
    const p = progress || { next: 1, best: 0, clears: 0, teacherOpen: false, teacherWins: 0, beaten: [] };
    if (selected === null || (selected === TEACHER_NO && !p.teacherOpen)) selected = p.next;
    $('dojoStats').innerHTML = `最高 <b>${p.best}</b>番・30人破り <b>${p.clears}</b>回${p.teacherWins ? `・先生に <b>${p.teacherWins}</b>勝` : ''}`;
    renderCard(p);
    renderClass(p);
    renderRuler();
    const teacher = selected === TEACHER_NO && p.teacherOpen;
    const next = byNo(p.next);
    $('dojoStart').innerHTML = teacher ? '<small>30人破りのあとの相手</small><b>担任の先生に挑む</b>'
      : `<small>${p.next}番 ${esc(next?.name || '')}</small><b>${p.next === 1 ? '道場に挑む' : '続きから挑む'}</b>`;
    $('dojoStart').setAttribute('aria-label', teacher ? '担任の先生に挑む' : `${p.next}番 ${next?.name || ''}に挑む`);
    $('dojoStart').classList.toggle('teacher', teacher);
  }

  function renderCard(p) {
    const c = byNo(selected) || byNo(p.next);
    if (!c) { $('dojoCard').innerHTML = ''; return; }
    const isNext = c.no === p.next;
    const teacher = c.no === TEACHER_NO;
    const rank = RANKS[c.rank]?.name;
    const head = teacher ? (p.teacherOpen ? '30人破りのあとの相手' : '30人破りを達成すると挑める')
      : isNext ? (p.next === 1 ? '最初の相手' : '次の相手') : c.no < p.next ? '今回、勝ち抜いた相手' : `${c.no - p.next}人あと`;
    const got = beaten(c);
    const rewards = c.reward.map((id) => `<span class="dc-rw${got ? ' got' : ''}">${esc(rewardName(id))}</span>`).join('');
    $('dojoCard').className = `dojo-card${teacher ? ' teacher' : ''}${rank && !teacher ? ' leader' : ''}`;
    $('dojoCard').innerHTML = `
      <img class="dc-av" src="${avatarImage(c.avatar, { view: 'bust', size: 104, bg: true })}" alt="" draggable="false">
      <div class="dc-body">
        <span class="dc-head">${esc(head)}</span>
        <span class="dc-title"><span class="dc-no">${esc(noLabel(c))}</span><b class="dc-name">${esc(c.name)}</b></span>
        <span class="dc-role">${esc(c.role)}${rank && !teacher ? `<em class="dc-rank">${esc(rank)}</em>` : ''}</span>
        ${c.lines?.enter ? `<p class="dc-line">${esc(c.lines.enter)}</p>` : ''}
        <span class="dc-meta">${esc(rulerName(c))} Lv.${c.level}・必殺技：${esc(skillName(c))}</span>
        <span class="dc-rewards"><small>${got ? 'もらった' : '初めて勝つと'}</small>${rewards}</span>
      </div>`;
  }

  function seat(c, p) {
    const teacher = c.no === TEACHER_NO;
    const locked = teacher && !p.teacherOpen;
    const cls = ['ds-seat',
      c.no === selected ? 'sel' : '',
      !teacher && c.no === p.next ? 'cur' : '',
      !teacher && c.no < p.next ? 'run' : '',
      beaten(c) ? 'won' : '',
      c.rank === 'leader' || c.rank === 'president' ? 'lead' : '',
      locked ? 'locked' : '',
    ].filter(Boolean).join(' ');
    const label = `${noLabel(c)} ${c.name}${beaten(c) ? '（勝ったことがある）' : ''}${!teacher && c.no === p.next ? '（次の相手）' : ''}${locked ? '（30人破りで挑める）' : ''}`;
    return `<button type="button" class="${cls}" data-no="${c.no}" role="listitem" aria-label="${esc(label)}">
      <img src="${avatarImage(c.avatar, { view: 'face', size: 40 })}" alt="" draggable="false">
      <span class="ds-no">${teacher ? '先生' : c.no}</span>
    </button>`;
  }
  function renderClass(p) {
    const all = list();
    const teacher = all.find((c) => c.no === TEACHER_NO);
    const rows = [];
    rows.push(`<div class="dc-row teacher-row"><span class="dc-han">教卓</span>${teacher ? seat(teacher, p) : ''}</div>`);
    for (let h = 1; h <= DOJO_SIZE / 5; h++) {
      const mates = all.filter((c) => c.no !== TEACHER_NO && hanOf(c.no) === h).sort((a, b) => a.no - b.no);
      rows.push(`<div class="dc-row"><span class="dc-han">${h}班</span>${mates.map((c) => seat(c, p)).join('')}</div>`);
    }
    $('dojoClass').innerHTML = rows.join('');
  }

  function renderRuler() {
    const id = app.me.selectedRuler;
    const it = ITEMS[id];
    if (!it) return;
    const lv = levelInfo(app.me.exp?.[id] || 0, LEVEL_MAX).level;
    const s = app.me.setups?.[id] || {};
    previewRuler($('dojoRulerPreview'), { specKey: it.specKey, art: it.art, level: lv, pattern: s.pattern, sticker: s.sticker });
    $('dojoRulerName').innerHTML = `<span class="rar-mini">${esc(it.rarity)}</span>${esc(it.name)} <small>Lv.${lv}</small>`;
  }

  $('dojoClass').addEventListener('click', (e) => {
    const b = e.target.closest('[data-no]');
    if (!b) return;
    selected = Number(b.dataset.no);
    if (selected === TEACHER_NO && !progress?.teacherOpen) toast('担任の先生には、30人破りを達成すると挑めます');
    render();
  });
  $('dojoRuler').addEventListener('click', () => onPickRuler?.());
  $('dojoStart').addEventListener('click', () => {
    setError('');
    const teacher = selected === TEACHER_NO && !!progress?.teacherOpen;
    onStart?.({ teacher, ruler: app.me.selectedRuler });
  });

  function homeNote() {
    const p = app.me?.dojo;
    $('dojoHomeNote').textContent = !p ? '' : p.clears ? `30人破り${p.clears}回` : p.best ? `次は${p.next}番` : '30人破り';
  }

  return {
    open, render, homeNote, setError,
    get progress() { return progress; },
    set progress(v) { progress = v; selected = null; },
    selectNext() { selected = null; },
  };
}

export { CLEAR_REWARD };
