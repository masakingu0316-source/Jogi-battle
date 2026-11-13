// 設定画面（管理者だけ）
import {
  ITEMS, RARITIES, ECONOMY, ECONOMY_KEYS, ORDER, GACHA_POOL, STATS, odds, sanitizeConfig, configProblem, RULER_TUNE_KEYS, rulerTune, rulerTuneDefault,
  applyConfig, defaultBrands, RULER_RARITY, RARITY_ORDER, ARTS, SHAPE_INFO, MATERIAL_INFO, MAT_ORDER, rulerOdds, RARITY_BONUS,
} from './shared/catalog.js';
import { SKILLS, TRAITS, SKILL_TUNE_KEYS, traitDesc, skillDesc, GAUGE, lapsToFull } from './shared/rules.js';
import { ENEMIES, STAGES, enemyMaxHp } from './shared/stage.js';
import Physics from './shared/physics.js';
import { AVATAR_SLOTS, SLOT_INFO, AVATAR_BASES, DEFAULT_PARTS, PARTS, partId, parsePartId, applyAvatarParts, sanitizeAvatarParts, randomAvatar } from './shared/avatar.js';
import { avatarImage } from './avatar-paint.js';
import { STYLES, SKILL_USES, RANKS, TEACHER_RULER, defaultClassmates, CLEAR_REWARD, tierOf } from './shared/dojo.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND = { ruler: '定規', pattern: '柄', sticker: 'シール', acc: 'アクセサリ', avatar: 'アバター', title: '称号' };

let saved = null;     // 保存されている設定
let defaults = null;  // コードに書いてある初期値
let draft = null;     // 画面で編集中の設定
let resetArmed = false;

let toastTimer = 0;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}

async function api(path, body) {
  const opt = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, opt);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || '通信に失敗しました'); e.data = data; e.status = res.status; throw e; }
  return data;
}

// ---- 入口：ログインと管理者の確認 ----
async function start() {
  try {
    const r = await api('/api/admin/config');
    saved = r.config; defaults = r.defaults; draft = structuredClone(saved);
    $('panel').hidden = false;
    $('savebar').hidden = false;
    renderAll();
    searchUsers('');
  } catch (e) {
    const gate = $('gate');
    gate.hidden = false;
    if (e.status === 401 || e.status === 503) {
      gate.innerHTML = `<p>設定画面を使うには、管理者のアカウントでログインしてください。</p>
        <p><a class="btn-login" href="/auth/login?return=${encodeURIComponent('/admin.html')}">Googleでログイン</a></p>`;
    } else if (e.status === 403) {
      gate.innerHTML = `<p>このアカウントはまだ管理者として登録されていません。</p>
        <p>あなたのアカウントID：<code>${esc(e.data.yourId || '')}</code></p>
        <ol>
          <li>Cloudflare でこの Worker の「設定」→「変数とシークレット」→「追加」</li>
          <li>種類「シークレット」、名前 <code>ADMIN_USER_IDS</code>、値に上のアカウントIDを入れて保存（複数の人を管理者にするときはカンマで区切る）</li>
          <li>1〜2分待ってから、このページを開き直す</li>
        </ol>`;
    } else {
      gate.innerHTML = `<p>${esc(e.message)}</p>`;
    }
  }
}

// ---- 表示 ----
function renderAll() {
  applyConfig(saved);
  renderEconomy();
  renderRarities();
  renderItems();
  renderSkills();
  renderBrands();
  renderRulerGacha();
  renderTraits();
  renderEnemies();
  renderAvatarParts();
  renderClassmates();
  markChanges();
}

// ---- アバターのパーツ・クラスメイト ----
const DEF_PART = Object.fromEntries(DEFAULT_PARTS.map((p) => [partId(p.slot, p.key), p]));
const SAMPLE = { skin: 's2', hair: 'short', hairColor: 'kogecha', eyes: 'maru', outfit: 'gakuran', jacket: null, head: null, face: null, item: null, bg: null };
const THUMB_VIEW = { skin: 'face', hair: 'face', hairColor: 'face', eyes: 'face', face: 'face', head: 'face', outfit: 'full', jacket: 'full', item: 'full', bg: 'full' };
// 編集中のパーツを、絵を描く一覧（PARTS）に反映する
const useDraftParts = () => applyAvatarParts(sanitizeAvatarParts(draft.avatarParts));
function partRowsOf(slotFilter) {
  useDraftParts();
  return AVATAR_SLOTS.filter((s) => !slotFilter || s.key === slotFilter).flatMap((s) => Object.values(PARTS[s.key]));
}
function partThumb(p) {
  const view = THUMB_VIEW[p.slot];
  return avatarImage({ ...SAMPLE, [p.slot]: p.key }, { view, size: view === 'face' ? 52 : 40, bg: p.slot === 'bg' });
}
function renderAvatarParts() {
  if (!$('avSlotFilter').options.length) {
    $('avSlotFilter').innerHTML = `<option value="">すべての部位</option>${AVATAR_SLOTS.map((s) => `<option value="${s.key}">${esc(s.name)}</option>`).join('')}`;
    $('avAddSlot').innerHTML = AVATAR_SLOTS.map((s) => `<option value="${s.key}">${esc(s.name)}</option>`).join('');
    renderAddBase();
  }
  const rows = partRowsOf($('avSlotFilter').value);
  $('avParts').innerHTML = `<thead><tr><th>見本</th><th>部位</th><th>名前</th><th>色</th><th>レア度</th><th>最初から</th><th></th></tr></thead><tbody>${
    rows.map((p) => {
      const id = partId(p.slot, p.key);
      const b = AVATAR_BASES[p.slot]?.[p.base] || {};
      const color = (k, label) => (label ? `<label>${esc(label)} <input type="color" data-av="${id}" data-k="${k}" value="${p[k] || '#888888'}"></label>` : '');
      return `<tr data-avrow="${id}">
        <td><img src="${partThumb(p)}" alt="" height="52" data-avimg="${id}"></td>
        <td>${esc(SLOT_INFO[p.slot].name)}<small>${esc(b.name || '')}${p.custom ? '・足したパーツ' : ''}</small></td>
        <td><input data-av="${id}" data-k="name" maxlength="16" value="${esc(p.name)}" aria-label="名前"><small>${esc(id)}</small></td>
        <td>${color('c1', b.c1)} ${color('c2', b.c2)}</td>
        <td><select data-av="${id}" data-k="rarity" aria-label="レア度">${ORDER.map((k) => `<option${k === p.rarity ? ' selected' : ''}>${k}</option>`).join('')}</select></td>
        <td><input type="checkbox" data-av="${id}" data-k="basic" ${p.basic ? 'checked' : ''} aria-label="最初から選べる"></td>
        <td>${p.custom ? `<button type="button" data-avdel="${id}">消す</button>` : ''}</td></tr>`;
    }).join('')}</tbody>`;
  applyConfig(saved);
}
function renderAddBase() {
  const slot = $('avAddSlot').value;
  $('avAddBase').innerHTML = Object.entries(AVATAR_BASES[slot] || {}).map(([k, b]) => `<option value="${k}">${esc(b.name)}</option>`).join('');
}
function setPart(id, key, value) {
  const cur = { ...(DEF_PART[id] ? {} : draft.avatarParts?.[id]), ...(draft.avatarParts?.[id] || {}) };
  draft.avatarParts = { ...(draft.avatarParts || {}), [id]: { ...cur, [key]: value } };
}
// ---- バトル道場のクラスメイト（31人） ----
// 1人ずつ開いて、名前・係・定規・必殺技・くせ・強さ・せりふ・もらえる物・見た目を変える
const cmOpen = new Set();
const DEF_CM = Object.fromEntries(defaultClassmates().map((c) => [c.id, c]));
const rewardOpts = (cur) => {
  const all = Object.values(ITEMS).filter((it) => (it.kind === 'avatar' && !it.basic) || it.kind === 'pattern' || it.kind === 'title' || it.kind === 'sticker' || it.kind === 'acc');
  const groups = [['avatar', 'アバターのパーツ'], ['pattern', '定規の柄'], ['title', '称号'], ['sticker', 'シール'], ['acc', 'アクセサリ']];
  return `<option value="">（なし）</option>` + groups.map(([k, label]) => `<optgroup label="${label}">${all.filter((it) => it.kind === k)
    .map((it) => `<option value="${it.id}"${it.id === cur ? ' selected' : ''}>${esc(it.name)}${it.dojo ? '・道場' : ''}</option>`).join('')}</optgroup>`).join('');
};
function renderClassmates() {
  useDraftParts();
  applyConfig({ ...saved, avatarParts: draft.avatarParts, brands: draft.brands });
  const slotOpts = (slot, cur) => {
    const s = SLOT_INFO[slot];
    return (s.none ? `<option value=""${cur ? '' : ' selected'}>なし</option>` : '')
      + Object.values(PARTS[slot]).map((p) => `<option value="${p.key}"${p.key === cur ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  };
  const rulers = Object.values(ITEMS).filter((it) => it.kind === 'ruler');
  const rulerOpts = (cur) => rulers.map((it) => `<option value="${it.id}"${it.id === cur ? ' selected' : ''}>[${it.rarity}] ${esc(it.name)}</option>`).join('');
  const skillOpts = (c) => `<option value=""${c.skill === '' ? ' selected' : ''}>定規の技（${esc(c.teacher ? '静かに！' : SKILLS[ITEMS[c.ruler]?.skill]?.name || '')}）</option><option value="none"${c.skill === 'none' ? ' selected' : ''}>使わない</option>`
    + Object.entries(SKILLS).filter(([k, v]) => !v.teacher || c.teacher).map(([k, v]) => `<option value="${k}"${k === c.skill ? ' selected' : ''}>${esc(v.name)}</option>`).join('');
  const sel = (i, k, opts, label) => `<label>${label}<select data-cm="${i}" data-k="${k}">${opts}</select></label>`;
  const num = (i, k, v, label, min, max, step = 1, unit = '') => `<label>${label}<span class="cm-num"><input type="number" data-cm="${i}" data-k="${k}" value="${v}" min="${min}" max="${max}" step="${step}">${unit}</span></label>`;
  const text = (i, k, v, label, max, ph = '') => `<label class="cm-wide">${label}<input data-cm="${i}" data-k="${k}" maxlength="${max}" value="${esc(v || '')}" placeholder="${esc(ph)}"></label>`;
  $('classmates').innerHTML = draft.classmates.map((c, i) => {
    const t = tierOf(c.no), d = DEF_CM[c.id];
    const rank = RANKS[c.rank]?.name;
    const rw = [0, 1, 2, 3].map((k) => sel(i, `reward${k}`, rewardOpts(c.reward[k] || ''), `もらえる物${k + 1}`)).join('');
    return `<details class="cm-card" data-cmcard="${i}"${cmOpen.has(c.id) ? ' open' : ''}>
      <summary><img src="${avatarImage(c.avatar, { view: 'face', size: 40 })}" alt="" width="40" height="40" data-cmimg="${i}">
        <b>${c.teacher ? '担任' : c.no + '番'}</b> <span>${esc(c.name)}</span> <small>${esc(c.role)}${rank && !c.teacher ? '・' + esc(rank) : ''}・${esc(c.teacher ? '黒板用の大きな定規' : ITEMS[c.ruler]?.name || '')} Lv.${c.level}・${esc(STYLES[c.style]?.name || '')}・ずれ±${c.aim}°</small></summary>
      <div class="cm-grid">
        ${text(i, 'name', c.name, '名前', 16)}
        ${text(i, 'role', c.role, '係・委員会', 12)}
        ${c.teacher ? '<label>定規<span class="cm-fixed">黒板用の大きな定規（先生だけ）</span></label>' : sel(i, 'ruler', rulerOpts(c.ruler), '定規')}
        ${num(i, 'level', c.level, '定規のLv', 1, 10)}
        ${sel(i, 'skill', skillOpts(c), '必殺技（道場での）')}
        ${sel(i, 'skillUse', Object.entries(SKILL_USES).map(([k, v]) => `<option value="${k}"${k === c.skillUse ? ' selected' : ''}>${esc(v.name)}</option>`).join(''), '必殺技の使い方')}
        ${sel(i, 'style', Object.entries(STYLES).map(([k, v]) => `<option value="${k}"${k === c.style ? ' selected' : ''}>${esc(v.name)}</option>`).join(''), 'くせ')}
        ${num(i, 'aim', c.aim, '狙いのずれ', 0, 45, 0.5, '±°')}
        ${num(i, 'powerErr', c.powerErr, '力加減の誤差', 0, 80, 1, '±%')}
        ${num(i, 'samples', c.samples, '試すはじき方の数', 1, 40)}
        <p class="cm-note">${esc(STYLES[c.style]?.desc || '')}。番号の段階の初期値：ずれ±${t.aim}°・誤差±${t.powerErr}%・試す数${t.samples}${rank && !c.teacher && c.no < 30 ? '（班長は少し強く：ずれ−1°・誤差−2%・試す数+2）' : ''}。試す数を増やすほど強くなりますが、サーバーの計算が増えます（目安：20まで）</p>
        ${text(i, 'line.enter', c.lines.enter, '登場のせりふ', 40)}
        ${text(i, 'line.win', c.lines.win, '勝ったときのせりふ（あなたが負けたとき）', 40, 'なくてもよい')}
        ${text(i, 'line.lose', c.lines.lose, '負けたときのせりふ（あなたが勝ったとき）', 40, 'なくてもよい')}
        <div class="cm-rewards">${rw}</div>
        <p class="cm-note">初めて勝ったときに受け取り箱に届きます${d ? `（初期値：${d.reward.map((id) => esc(ITEMS[id]?.name || id)).join('、')}）` : ''}</p>
        <div class="cm-look">${AVATAR_SLOTS.map((s) => sel(i, 'av.' + s.key, slotOpts(s.key, c.avatar[s.key]), s.name)).join('')}
          <button type="button" data-cmrand="${i}">見た目をおまかせ</button>
          <img src="${avatarImage(c.avatar, { view: 'full', size: 72, bg: true })}" alt="" width="72" data-cmfull="${i}"></div>
        <button type="button" class="link" data-cmreset="${i}">この人を初期値に戻す</button>
      </div>
    </details>`;
  }).join('') + `<p class="cm-note">30人破りの初回の報酬：${CLEAR_REWARD.map((id) => esc(ITEMS[id]?.name || id)).join('、')}</p>`;
  applyConfig(saved);
}
$('classmates').addEventListener('toggle', (e) => {
  const d = e.target.closest?.('[data-cmcard]');
  if (!d) return;
  const id = draft.classmates[Number(d.dataset.cmcard)]?.id;
  if (d.open) cmOpen.add(id); else cmOpen.delete(id);
}, true);
function onAvatarInput(e) {
  const el = e.target;
  if (!draft) return;
  if (el.dataset.av) {
    const id = el.dataset.av, k = el.dataset.k;
    setPart(id, k, el.type === 'checkbox' ? el.checked : el.value);
    if (k === 'c1' || k === 'c2') {
      useDraftParts();
      const at = parsePartId(id);
      const img = document.querySelector(`[data-avimg="${CSS.escape(id)}"]`);
      if (img && at) img.src = partThumb(PARTS[at.slot][at.key]);
      applyConfig(saved);
    }
  } else if (el.dataset.cm) {
    const i = Number(el.dataset.cm), k = el.dataset.k;
    const list = structuredClone(draft.classmates);
    const c = list[i];
    const v = el.value;
    if (k.startsWith('av.')) c.avatar[k.slice(3)] = v || null;
    else if (k.startsWith('line.')) c.lines[k.slice(5)] = v;
    else if (k.startsWith('reward')) { const r = [...c.reward]; r[Number(k.slice(6))] = v; c.reward = r.filter(Boolean); }
    else if (['level', 'aim', 'powerErr', 'samples'].includes(k)) c[k] = v === '' ? c[k] : Number(v);
    else c[k] = v;
    draft.classmates = list;
    if (k.startsWith('av.')) {
      useDraftParts();
      document.querySelector(`[data-cmimg="${i}"]`).src = avatarImage(c.avatar, { view: 'face', size: 40 });
      document.querySelector(`[data-cmfull="${i}"]`).src = avatarImage(c.avatar, { view: 'full', size: 72, bg: true });
      applyConfig(saved);
    }
    // 選び直したら、見出しの要約や「定規の技」の名前も更新する
    if (e.type === 'change' && !k.startsWith('av.') && !k.startsWith('line.') && k !== 'name' && k !== 'role') renderClassmates();
  } else return;
  markChanges();
}
document.addEventListener('input', onAvatarInput);
document.addEventListener('change', (e) => {
  if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') onAvatarInput(e);
  // パーツの名前を変えたら、クラスメイトの選択肢の名前も変える
  if (e.target.dataset?.av && e.target.dataset.k === 'name') renderClassmates();
});
$('avSlotFilter').addEventListener('change', renderAvatarParts);
$('avAddSlot').addEventListener('change', renderAddBase);
$('avAdd').addEventListener('click', () => {
  const slot = $('avAddSlot').value, base = $('avAddBase').value;
  const a = new Uint8Array(4); crypto.getRandomValues(a);
  const key = 'x-' + Array.from(a, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 6);
  const like = DEFAULT_PARTS.find((p) => p.slot === slot && p.base === base);
  draft.avatarParts = { ...(draft.avatarParts || {}), [partId(slot, key)]: { custom: true, base, name: `新しい${AVATAR_BASES[slot][base].name}`, rarity: 'R', basic: false, c1: like?.c1 || '#7a8a9a', c2: like?.c2 || null } };
  $('avSlotFilter').value = slot;
  renderAvatarParts(); renderClassmates(); markChanges();
  document.querySelector(`[data-avrow="${CSS.escape(partId(slot, key))}"] input[data-k="name"]`)?.focus();
});
$('avParts').addEventListener('click', (e) => {
  const b = e.target.closest('[data-avdel]');
  if (!b) return;
  const { [b.dataset.avdel]: _, ...rest } = draft.avatarParts || {};
  draft.avatarParts = rest;
  renderAvatarParts(); renderClassmates(); markChanges();
});
$('classmates').addEventListener('click', (e) => {
  const r = e.target.closest('[data-cmreset]');
  if (r) {
    const i = Number(r.dataset.cmreset);
    const list = structuredClone(draft.classmates);
    list[i] = structuredClone(DEF_CM[list[i].id]);
    draft.classmates = list;
    renderClassmates(); markChanges();
    return;
  }
  const b = e.target.closest('[data-cmrand]');
  if (!b) return;
  const i = Number(b.dataset.cmrand);
  useDraftParts();
  const list = structuredClone(draft.classmates);
  list[i].avatar = randomAvatar(`${Date.now()}-${i}`, { allow: () => true, noneRate: 0.5 });
  draft.classmates = list;
  renderClassmates(); markChanges();
});

// ---- ステージの敵の体力 ----
// どのマップに出てくるか（表に添える）
const ENEMY_MAPS = (() => {
  // { 種類: ['可変定規編 1・2', '破天荒編 3'] }
  const out = {};
  for (const st of Object.values(STAGES)) {
    const here = {};
    st.maps.forEach((m, i) => m.boards.forEach((b) => b.foes.forEach((f) => { (here[f.t] ||= new Set()).add(i + 1); })));
    for (const [k, v] of Object.entries(here)) (out[k] ||= []).push(`${st.name} ${[...v].sort((a, b) => a - b).join('・')}`);
  }
  return out;
})();
function renderEnemies() {
  $('enemyGrow').value = draft.enemyHpGrow;
  $('enemies').innerHTML = `<thead><tr><th>敵</th><th>動き</th><th>体力（マップ1）</th><th>マップ5</th><th>マップ10</th><th>出てくるマップ</th></tr></thead><tbody>${
    Object.entries(ENEMIES).map(([k, d]) => `<tr>
      <td><span class="enemy-dot" style="background:${d.color}"></span>${esc(k === 'ruler' ? '敵の定規' : d.name)}${d.boss ? '（ラスボス）' : ''}</td>
      <td>${d.move ? '動く' : '置物'}</td>
      <td><input type="number" data-path='${JSON.stringify(['enemyHp', k])}' min="1" max="3000" step="1" value="${draft.enemyHp[k]}" aria-label="${esc(d.name)}の体力"><small>初期 ${defaults.enemyHp[k]}</small></td>
      <td data-ehp="${k}" data-map="5"></td><td data-ehp="${k}" data-map="10"></td>
      <td><small>${(ENEMY_MAPS[k] || []).join('<br>') || '—'}</small></td></tr>`).join('')}</tbody>`;
  refreshEnemyPreview();
}
function refreshEnemyPreview() {
  const c = sanitizeConfig(draft);
  for (const el of document.querySelectorAll('[data-ehp]')) el.textContent = enemyMaxHp(el.dataset.ehp, +el.dataset.map, c);
  $('enemyGrowNote').textContent = `たとえば消しゴム：マップ1で${enemyMaxHp('eraser', 1, c)} → マップ10で${enemyMaxHp('eraser', 10, c)}`;
}

// 定規の性能（形×素材ごと。銘柄はこの性能にレア度の上乗せが掛かる）
function physKeys() {
  return Object.keys(Physics.RULERS).filter((k) => !Physics.RULERS[k].enemy);
}
function renderSkills() {
  const head = Object.values(RULER_TUNE_KEYS).map((r) => `<th title="${esc(r.desc)}">${r.name}${r.unit ? `（${r.unit}）` : ''}</th>`).join('');
  $('skills').innerHTML = `<thead><tr><th>形・素材</th>${head}</tr></thead><tbody>${
    physKeys().map((key) => {
      const cur = rulerTune(key, draft), d = rulerTuneDefault(key);
      const name = Physics.RULERS[key].name;
      const cells = Object.entries(RULER_TUNE_KEYS).map(([k, r]) => `<td><input type="number" id="t-${key}-${k}" data-tune="${key}" data-key="${k}"
          min="${r.min}" max="${r.max}" step="${r.step}" value="${cur[k]}" aria-label="${esc(name)}の${r.name}"><small>初期 ${d[k]}</small></td>`).join('');
      return `<tr><td>${esc(name)}</td>${cells}</tr>`;
    }).join('')}</tbody>`;
  $('tuneHelp').innerHTML = Object.values(RULER_TUNE_KEYS).map((r) => `<li><b>${r.name}</b>：${esc(r.desc)}（${r.min}〜${r.max}${r.unit}）</li>`).join('');
  $('skillList').innerHTML = Object.entries(SKILLS).map(([k, v]) => `<li><b>${v.name}</b>${v.ssr ? '（SSR専用）' : v.teacher ? '（バトル道場の担任の先生だけ）' : ''}（${v.mode === 'now' ? 'ボタンを押した時点で使う' : '構えてからはじく'}）：${esc(skillDesc(k, draft.skillTune))}</li>`).join('');
}

// ---- 銘柄 ----
// 元からある銘柄は、変えた所だけ draft.brands に入れる（保存のときに、初期値と同じ所は消える）
const DEF = Object.fromEntries(defaultBrands().map((b) => [b.id, b]));
const brandOf = (cfg, id) => ({ ...(DEF[id] || {}), ...(cfg.brands?.[id] || {}) });
function brandIds() {
  return [...Object.keys(DEF), ...Object.keys(draft.brands || {}).filter((id) => !DEF[id])];
}
function renderBrands() {
  const sel = (path, opts, cur, label) => `<select data-path='${JSON.stringify(path)}' aria-label="${esc(label)}">${opts.map(([k, n]) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  const skillOpts = Object.entries(SKILLS).filter(([, v]) => !v.teacher).map(([k, v]) => [k, `${v.name}${v.ssr ? '（SSR）' : ''}`]);
  const traitOpts = [['', 'なし'], ...Object.entries(TRAITS).map(([k, v]) => [k, v.name])];
  const artOpts = Object.entries(ARTS).map(([k, v]) => [k, `${v.name}（${v.rarity}）`]);
  const rarOpts = RARITY_ORDER.map((k) => [k, k]);
  const shapeOpts = Object.entries(SHAPE_INFO).filter(([k]) => k !== 'folding').map(([k, v]) => [k, v.name]);
  const matOpts = MAT_ORDER.map((k) => [k, MATERIAL_INFO[k].name]);
  $('brands').innerHTML = `<thead><tr><th>ガチャ</th><th>レア度</th><th>名前</th><th>形・素材</th><th>絵柄</th><th>特性</th><th>必殺技</th><th>ゲージのたまりやすさ<small>1周でたまる量（満タンは100）</small></th></tr></thead><tbody>${
    brandIds().map((id) => {
      const b = brandOf(draft, id);
      const custom = !DEF[id];
      const base = ['brands', id];
      const form = custom
        ? `${sel([...base, 'shape'], shapeOpts, b.shape, '形')}${sel([...base, 'mat'], matOpts, b.mat, '素材')}`
        : `${esc(SHAPE_INFO[b.shape]?.name || '')}・${esc(MATERIAL_INFO[b.mat]?.name || '')}${b.starter ? '<small>はじめから全員が持っている</small>' : ''}`;
      return `<tr data-brand="${esc(id)}">
        <td>${b.stage ? '<small>ステージ報酬</small>' : `<input type="checkbox" data-path='${JSON.stringify([...base, 'gacha'])}' ${b.gacha ? 'checked' : ''} aria-label="${esc(b.name)}をガチャに出す">`}</td>
        <td>${sel([...base, 'rarity'], rarOpts, b.rarity, 'レア度')}</td>
        <td><input data-path='${JSON.stringify([...base, 'name'])}' maxlength="20" value="${esc(b.name)}" aria-label="名前">${custom ? '<small>追加した銘柄</small>' : ''}</td>
        <td>${form}</td>
        <td>${sel([...base, 'art'], artOpts, b.art, '絵柄')}</td>
        <td>${sel([...base, 'trait'], traitOpts, b.trait || '', '特性')}</td>
        <td>${sel([...base, 'skill'], skillOpts, b.skill, '必殺技')}</td>
        <td class="charge"><input type="number" data-path='${JSON.stringify([...base, 'charge'])}' min="${GAUGE.chargeMin}" max="${GAUGE.chargeMax}" step="1" value="${b.charge ?? GAUGE.charge}" aria-label="${esc(b.name)}の必殺ゲージのたまりやすさ（1周でたまる量）"><small data-laps="${esc(id)}">${lapsToFull(b.charge ?? GAUGE.charge)}周で満タン</small></td></tr>`;
    }).join('')}</tbody>`;
}
$('addBrand').addEventListener('click', () => {
  const a = new Uint8Array(4); crypto.getRandomValues(a);
  const id = 'ruler:x-' + Array.from(a, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 8);
  draft.brands = { ...(draft.brands || {}), [id]: { custom: true, name: '新しい定規', rarity: 'R', shape: 'straight30', mat: 'acrylic', art: 'plain', trait: null, skill: 'power', gacha: true, charge: GAUGE.charge } };
  renderBrands(); renderRulerGacha(); markChanges();
  document.querySelector(`[data-brand="${CSS.escape(id)}"] input:not([type=checkbox])`)?.focus();
});

// ---- 定規ガチャ ----
function renderRulerGacha() {
  const g = draft.rulerGacha;
  const clean = sanitizeConfig(draft);
  applyConfig(clean);
  const o = rulerOdds(clean);
  applyConfig(saved);
  const num = (path, v, min, max, step, label) => `<input type="number" data-path='${JSON.stringify(path)}' min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${esc(label)}">`;
  $('rulerGacha').innerHTML = `
    <div class="num-grid">
      <label>1回の値段（本）${num(['rulerGacha', 'pull1'], g.pull1, 1, 10000, 1, '1回の値段')}</label>
      <label>10回の値段（本・SR以上1本確定）${num(['rulerGacha', 'pull10'], g.pull10, 1, 100000, 1, '10回の値段')}</label>
      <label>天井（この回数でSSR交換券。0でなし）${num(['rulerGacha', 'pity'], g.pity, 0, 1000, 1, '天井の回数')}</label>
    </div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>レア度</th><th>重み</th><th>確率</th><th>持っている定規が出たら返す本数</th><th>出る定規</th></tr></thead><tbody>${
      RARITY_ORDER.map((k) => {
        const x = o.find((v) => v.rarity === k);
        return `<tr><td><span class="rar" style="background:${RULER_RARITY[k].color}">${k}</span> ${RULER_RARITY[k].name}</td>
          <td>${num(['rulerGacha', 'weights', k], g.weights[k], 0, 10000, 0.1, `${k}の重み`)}</td>
          <td class="pct">${x.percent.toFixed(1)}%</td>
          <td>${num(['rulerGacha', 'refund', k], g.refund[k], 0, 100000, 1, `${k}の返還`)}</td>
          <td>${x.items.length}本</td></tr>`;
      }).join('')}</tbody></table></div>`;
}

// ---- レア度の上乗せ・特性・SSRの技 ----
function renderTraits() {
  const num = (path, v, min, max, step, label) => `<input type="number" data-path='${JSON.stringify(path)}' min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${esc(label)}">`;
  $('rarityBonus').innerHTML = RARITY_ORDER.map((k) => `<label><span class="rar" style="background:${RULER_RARITY[k].color}">${k}</span> 重さ・はじく力（%）${num(['rarityBonus', k], draft.rarityBonus[k], 0, 15, 0.5, `${k}の上乗せ`)}<small>初期値 ${RARITY_BONUS[k]}</small></label>`).join('');
  $('traits').innerHTML = Object.entries(TRAITS).map(([k, t]) => `<label>${t.name}（%）${num(['traits', k], draft.traits[k], 0, k === 'aim' ? 100 : 30, 0.5, t.name)}<small>${esc(traitDesc(k, draft.traits[k]))}</small></label>`).join('');
  $('skillTune').innerHTML = Object.entries(SKILL_TUNE_KEYS).map(([k, r]) => `<label>${SKILLS[r.skill].name}：${r.name}（${r.unit}）${num(['skillTune', k], draft.skillTune[k], r.min, r.max, 1, r.name)}<small>${r.min}〜${r.max}</small></label>`).join('');
}

// data-path の入力（銘柄・定規ガチャ・特性など）
const getPath = (cfg, path) => (path[0] === 'brands' ? brandOf(cfg, path[1])[path[2]] : path.reduce((o, k) => o?.[k], cfg));
function setPath(path, value) {
  if (path[0] === 'brands') {
    const [, id, key] = path;
    draft.brands = { ...(draft.brands || {}), [id]: { ...(draft.brands?.[id] || {}), [key]: value } };
    return;
  }
  let o = draft;
  for (const k of path.slice(0, -1)) o = o[k] = { ...(o[k] || {}) };
  o[path.at(-1)] = value;
}

function renderEconomy() {
  $('economy').innerHTML = Object.entries(ECONOMY_KEYS).map(([k, r]) => `
    <label for="e-${k}">${r.name}（${r.unit || ECONOMY.unit}）
      <input type="number" id="e-${k}" data-econ="${k}" min="${r.min}" max="${r.max}" step="1" value="${draft.economy[k]}">
      <small>初期値 ${defaults.economy[k]}</small>
    </label>`).join('');
}

function renderRarities() {
  const o = odds(draft);
  $('rarities').innerHTML = `<thead><tr><th>レア度</th><th>重み</th><th>確率</th><th>かぶったときに戻る本数</th><th>出せるアイテム</th></tr></thead><tbody>${
    ORDER.map((k) => {
      const x = o.find((v) => v.rarity === k);
      return `<tr><td><span class="rar" style="background:${RARITIES[k].color}">${k}</span> ${RARITIES[k].name}</td>
        <td><input type="number" id="w-${k}" data-weight="${k}" min="0" max="10000" step="0.1" value="${draft.rarities[k].weight}" aria-label="${k}の重み"></td>
        <td class="pct" data-pct="${k}">${x.percent.toFixed(1)}%</td>
        <td><input type="number" id="r-${k}" data-refund="${k}" min="0" max="100000" step="1" value="${draft.rarities[k].refund}" aria-label="${k}のかぶり返還"></td>
        <td data-count="${k}">${x.items.length}種類</td></tr>`;
    }).join('')}</tbody>`;
}

function renderItems() {
  const rows = [...GACHA_POOL].sort((a, b) => ORDER.indexOf(a.rarity) - ORDER.indexOf(b.rarity) || a.kind.localeCompare(b.kind));
  $('items').innerHTML = `<thead><tr><th>ガチャに出す</th><th>レア度</th><th>名前</th><th>種類</th><th>アクセサリの効き目（%）</th></tr></thead><tbody>${
    rows.map((it) => {
      const on = !draft.disabled.includes(it.id);
      const acc = it.kind === 'acc'
        ? `${STATS[it.stat].name} <input type="number" id="a-${it.id}" data-acc="${it.id}" min="-5" max="5" step="0.5" value="${draft.acc[it.id]}" aria-label="${esc(it.name)}の効き目"> <small style="color:var(--chalk-dim)">初期値 ${defaults.acc[it.id]}</small>`
        : '';
      return `<tr class="${on ? '' : 'off'}" data-row="${it.id}"><td><input type="checkbox" id="c-${it.id}" data-enable="${it.id}" ${on ? 'checked' : ''} aria-label="${esc(it.name)}をガチャに出す"></td>
        <td><span class="rar" style="background:${RARITIES[it.rarity].color}">${it.rarity}</span></td>
        <td>${esc(it.name)}</td><td>${KIND[it.kind]}</td><td>${acc}</td></tr>`;
    }).join('')}</tbody>`;
}

// 確率の列と「出せるアイテム」の数だけを書き直す（入力中のフォーカスを奪わない）
function refreshOdds() {
  for (const x of odds(sanitizeConfig(draft))) {
    const p = document.querySelector(`[data-pct="${x.rarity}"]`);
    if (p) p.textContent = `${x.percent.toFixed(1)}%`;
    const c = document.querySelector(`[data-count="${x.rarity}"]`);
    if (c) c.textContent = `${x.items.length}種類`;
  }
}

function markChanges() {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const el of document.querySelectorAll('[data-econ]')) el.classList.toggle('changed', draft.economy[el.dataset.econ] !== saved.economy[el.dataset.econ]);
  for (const el of document.querySelectorAll('[data-weight]')) el.classList.toggle('changed', draft.rarities[el.dataset.weight].weight !== saved.rarities[el.dataset.weight].weight);
  for (const el of document.querySelectorAll('[data-refund]')) el.classList.toggle('changed', draft.rarities[el.dataset.refund].refund !== saved.rarities[el.dataset.refund].refund);
  for (const el of document.querySelectorAll('[data-acc]')) el.classList.toggle('changed', draft.acc[el.dataset.acc] !== saved.acc[el.dataset.acc]);
  for (const el of document.querySelectorAll('[data-path]')) {
    const p = JSON.parse(el.dataset.path);
    el.classList.toggle('changed', JSON.stringify(getPath(sanitizeConfig(draft), p) ?? null) !== JSON.stringify(getPath(saved, p) ?? null));
  }
  for (const el of document.querySelectorAll('[data-tune]')) el.classList.toggle('changed', rulerTune(el.dataset.tune, sanitizeConfig(draft))[el.dataset.key] !== rulerTune(el.dataset.tune, saved)[el.dataset.key]);
  const dirty = !same(sanitizeConfig(draft), saved);
  const problem = configProblem(sanitizeConfig(draft));
  applyConfig(saved);
  $('status').className = 'status' + (problem ? ' err' : '');
  $('status').textContent = problem || (dirty ? '変更はまだ保存されていません' : '保存されている設定です');
  $('save').disabled = !dirty || !!problem;
  $('revert').disabled = !dirty;
}

// ---- 入力 ----
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!draft) return;
  const v = el.value === '' ? NaN : Number(el.value);
  if (el.dataset.econ) draft.economy[el.dataset.econ] = Number.isFinite(v) ? v : saved.economy[el.dataset.econ];
  else if (el.dataset.weight) draft.rarities[el.dataset.weight].weight = Number.isFinite(v) ? v : 0;
  else if (el.dataset.refund) draft.rarities[el.dataset.refund].refund = Number.isFinite(v) ? v : 0;
  else if (el.dataset.acc) draft.acc[el.dataset.acc] = Number.isFinite(v) ? v : 0;
  else if (el.dataset.path) {
    const p = JSON.parse(el.dataset.path);
    const val = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (Number.isFinite(v) ? v : getPath(saved, p)) : el.tagName === 'SELECT' && p.at(-1) === 'trait' ? (el.value || null) : el.value;
    setPath(p, val);
    if (p[0] === 'rulerGacha' || (p[0] === 'brands' && ['rarity', 'gacha'].includes(p[2]))) { renderRulerGacha(); }
    if (p[0] === 'brands' && p[2] === 'charge') {
      const c = Math.max(GAUGE.chargeMin, Math.min(GAUGE.chargeMax, Number.isFinite(val) ? val : GAUGE.charge));
      const small = document.querySelector(`[data-laps="${CSS.escape(p[1])}"]`);
      if (small) small.textContent = `${lapsToFull(c)}周で満タン`;
    }
    if (p[0] === 'traits' || p[0] === 'skillTune') {
      const small = el.parentElement.querySelector('small');
      if (small && p[0] === 'traits') small.textContent = traitDesc(p[1], val);
    }
    if (p[0] === 'skillTune') renderSkills();
    if (p[0] === 'enemyHp' || p[0] === 'enemyHpGrow') refreshEnemyPreview();
  }
  else if (el.dataset.tune) {
    const k = el.dataset.tune;
    draft.rulers = { ...(draft.rulers || {}), [k]: { ...(draft.rulers?.[k] || {}), [el.dataset.key]: Number.isFinite(v) ? v : rulerTuneDefault(k)[el.dataset.key] } };
  }
  else if (el.dataset.enable) {
    const id = el.dataset.enable;
    draft.disabled = el.checked ? draft.disabled.filter((x) => x !== id) : [...draft.disabled, id];
    document.querySelector(`[data-row="${CSS.escape(id)}"]`)?.classList.toggle('off', !el.checked);
  } else return;
  resetArmed = false;
  $('reset').textContent = '初期値に戻す';
  refreshOdds();
  markChanges();
});

$('save').addEventListener('click', async () => {
  $('save').disabled = true;
  try {
    const r = await api('/api/admin/config', { config: sanitizeConfig(draft) });
    saved = r.config; draft = structuredClone(saved);
    renderAll();
    toast('保存しました。30秒ほどで全体に反映されます');
  } catch (e) {
    $('status').className = 'status err';
    $('status').textContent = e.message;
    $('save').disabled = false;
  }
});

$('revert').addEventListener('click', () => {
  draft = structuredClone(saved);
  renderAll();
});

// 初期値に戻すのは2回押したときだけ（確認ダイアログの代わり）
$('reset').addEventListener('click', async () => {
  if (!resetArmed) {
    resetArmed = true;
    $('reset').textContent = 'もう一度押すと初期値に戻します';
    return;
  }
  resetArmed = false;
  $('reset').textContent = '初期値に戻す';
  try {
    const r = await api('/api/admin/config/reset', {});
    saved = r.config; draft = structuredClone(saved);
    renderAll();
    toast('すべて初期値に戻しました');
  } catch (e) { toast(e.message); }
});

// ---- ユーザーとえんぴつ ----
async function searchUsers(q) {
  try {
    const { users } = await api('/api/admin/users?q=' + encodeURIComponent(q));
    $('users').innerHTML = users.length ? users.map((u) => {
      const d = new Date(u.createdAt);
      return `<li data-user="${u.id}">
        <span class="who">${esc(u.name)}　<b data-coins="${u.id}">${u.coins}</b>${ECONOMY.unit}
          <small>ID ${u.id}・対戦${u.games}回・登録 ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}</small></span>
        <span class="give"><input type="number" step="1" value="100" aria-label="${esc(u.name)}に配る本数" id="g-${u.id}"><button type="button" data-give="${u.id}">配る</button>
          <button type="button" data-items="${u.id}" data-name="${esc(u.name)}">アイテム</button></span>
      </li>`;
    }).join('') : '<li class="who" style="color:var(--ink-soft)">見つかりませんでした</li>';
  } catch (e) { toast(e.message); }
}
$('searchForm').addEventListener('submit', (e) => { e.preventDefault(); searchUsers($('q').value.trim()); });
$('users').addEventListener('click', async (e) => {
  const it = e.target.closest('[data-items]');
  if (it) { openGiftPanel(it.dataset.items, it.dataset.name); return; }
  const b = e.target.closest('[data-give]');
  if (!b) return;
  const id = b.dataset.give;
  const amount = Number($('g-' + id).value);
  b.disabled = true;
  try {
    const r = await api('/api/admin/gift', { userId: id, amount, title: $('giftTitle').value.trim() });
    document.querySelector(`[data-coins="${id}"]`).textContent = r.coins;
    toast(r.inbox ? `受け取り箱に${amount}${ECONOMY.unit}届けました（受け取ると増えます）` : `減らしました（いま${r.coins}${ECONOMY.unit}）`);
    if (gp.user === id && !$('giftPanel').hidden) loadGiftUser();
  } catch (err) { toast(err.message); }
  finally { b.disabled = false; }
});

// ---- アイテムを配る ----
const gp = { user: null, name: '', owned: new Set(), pending: [], pick: new Set() };
const RAR_ORDER = { N: 0, R: 1, SR: 2, SSR: 3 };
// もう持っているアイテムを受け取ったときのえんぴつ（ガチャでかぶったときと同じ）
const dupRefund = (id) => {
  const it = ITEMS[id];
  return (it.kind === 'ruler' ? saved.rulerGacha?.refund?.[it.rarity] : saved.rarities?.[it.rarity]?.refund) ?? 0;
};
async function openGiftPanel(userId, name) {
  gp.user = userId; gp.name = name; gp.pick.clear();
  document.querySelectorAll('.users li').forEach((li) => li.classList.toggle('on', li.dataset.user === userId));
  $('gpTitle').textContent = `${name} さんにアイテムを配る`;
  $('giftPanel').hidden = false;
  await loadGiftUser();
  $('giftPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function loadGiftUser() {
  try {
    const r = await api('/api/admin/user-items?userId=' + encodeURIComponent(gp.user));
    gp.owned = new Set(r.owned);
    gp.pending = r.pending;
  } catch (e) { toast(e.message); }
  renderGiftItems(); renderPending();
}
function renderGiftItems() {
  const kind = $('gpKind').value, rar = $('gpRarity').value, q = $('gpQ').value.trim();
  const hideOwned = $('gpHideOwned').checked, allowOwned = $('gpAllowOwned').checked;
  const waiting = new Set(gp.pending.filter((x) => x.item).map((x) => x.item));
  const list = Object.values(ITEMS)
    .filter((it) => KIND[it.kind] && (!kind || it.kind === kind) && (!rar || it.rarity === rar) && (!q || it.name.includes(q)))
    .filter((it) => !(hideOwned && gp.owned.has(it.id)))
    .sort((a, b) => Object.keys(KIND).indexOf(a.kind) - Object.keys(KIND).indexOf(b.kind) || RAR_ORDER[b.rarity] - RAR_ORDER[a.rarity] || a.name.localeCompare(b.name, 'ja'));
  // 選べなくなったもの（持っていて、送らない設定）は選択から外す
  for (const id of [...gp.pick]) if (gp.owned.has(id) && !allowOwned) gp.pick.delete(id);
  $('gpItems').innerHTML = `<tr><th></th><th>種類</th><th>レア度</th><th>名前</th><th>この人</th></tr>` + (list.length ? list.map((it) => {
    const own = gp.owned.has(it.id);
    const st = own ? `<span class="tag-own">持っている（受け取るとえんぴつ${dupRefund(it.id)}本）</span>` : waiting.has(it.id) ? '<span class="tag-wait">受け取り箱にある</span>' : '持っていない';
    const dis = own && !allowOwned;
    return `<tr class="${own ? 'owned' : ''}"><td><input type="checkbox" data-pick="${it.id}" ${gp.pick.has(it.id) ? 'checked' : ''} ${dis ? 'disabled' : ''} aria-label="${esc(it.name)}を選ぶ"></td>
      <td>${KIND[it.kind]}</td><td>${it.rarity}</td><td>${esc(it.name)}<small style="display:block;color:var(--ink-soft)">${it.id}</small></td><td class="st">${st}</td></tr>`;
  }).join('') : '<tr><td colspan="5">当てはまるアイテムはありません</td></tr>');
  $('gpCount').textContent = `${gp.pick.size}個選択中`;
  $('gpSend').disabled = !gp.pick.size;
}
function renderPending() {
  $('gpPending').innerHTML = gp.pending.length ? gp.pending.map((x) => {
    const d = new Date(x.at);
    const what = [x.coins ? `えんぴつ${x.coins}本` : '', x.item ? `「${ITEMS[x.item]?.name || x.item}」` : '', x.kind === 'ticket' ? 'SSR交換券' : ''].filter(Boolean).join('・');
    return `<li><span>${esc(x.title)}：${esc(what)} <small>${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}</small></span>
      ${x.kind === 'gift' ? `<button type="button" data-cancel="${x.id}">取り消す</button>` : '<small>（運営からのものではないので取り消せません）</small>'}</li>`;
  }).join('') : '<li><small>ありません</small></li>';
}
for (const id of ['gpKind', 'gpRarity', 'gpHideOwned', 'gpAllowOwned']) $(id).addEventListener('change', renderGiftItems);
$('gpQ').addEventListener('input', renderGiftItems);
$('gpClose').addEventListener('click', () => { $('giftPanel').hidden = true; document.querySelectorAll('.users li.on').forEach((li) => li.classList.remove('on')); });
$('gpItems').addEventListener('change', (e) => {
  const c = e.target.closest('[data-pick]');
  if (!c) return;
  if (c.checked) gp.pick.add(c.dataset.pick); else gp.pick.delete(c.dataset.pick);
  $('gpCount').textContent = `${gp.pick.size}個選択中`;
  $('gpSend').disabled = !gp.pick.size;
});
$('gpSend').addEventListener('click', async () => {
  const items = [...gp.pick];
  $('gpSend').disabled = true;
  try {
    const r = await api('/api/admin/gift-items', { userId: gp.user, items, title: $('giftTitle').value.trim(), allowOwned: $('gpAllowOwned').checked });
    const names = (ids) => ids.map((id) => `「${ITEMS[id]?.name}」`).join('');
    toast(`${gp.name} さんの受け取り箱に${r.sent.length}個送りました${r.skipped.length ? `（もう持っている${names(r.skipped)}は送りませんでした）` : ''}`);
    gp.pick.clear();
    await loadGiftUser();
  } catch (e) { toast(e.message); $('gpSend').disabled = false; }
});
$('gpPending').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cancel]');
  if (!b) return;
  b.disabled = true;
  try {
    await api('/api/admin/gift-cancel', { userId: gp.user, id: Number(b.dataset.cancel) });
    toast('取り消しました');
    await loadGiftUser();
  } catch (err) { toast(err.message); b.disabled = false; }
});

start();
