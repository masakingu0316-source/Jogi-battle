// 設定画面（管理者だけ）
import {
  ITEMS, RARITIES, ECONOMY, ECONOMY_KEYS, ORDER, GACHA_POOL, STATS, odds, sanitizeConfig, configProblem, RULER_TUNE_KEYS, rulerTune, rulerTuneDefault,
  applyConfig, defaultBrands, RULER_RARITY, RARITY_ORDER, ARTS, SHAPE_INFO, MATERIAL_INFO, MAT_ORDER, rulerOdds, RARITY_BONUS,
} from './shared/catalog.js';
import { SKILLS, TRAITS, SKILL_TUNE_KEYS, traitDesc, skillDesc } from './shared/rules.js';
import Physics from './shared/physics.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND = { ruler: '定規', pattern: '柄', sticker: 'シール', acc: 'アクセサリ' };

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
  markChanges();
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
  $('skillList').innerHTML = Object.entries(SKILLS).map(([k, v]) => `<li><b>${v.name}</b>${v.ssr ? '（SSR専用）' : ''}（${v.mode === 'now' ? 'ボタンを押した時点で使う' : '構えてからはじく'}）：${esc(skillDesc(k, draft.skillTune))}</li>`).join('');
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
  const skillOpts = Object.entries(SKILLS).map(([k, v]) => [k, `${v.name}${v.ssr ? '（SSR）' : ''}`]);
  const traitOpts = [['', 'なし'], ...Object.entries(TRAITS).map(([k, v]) => [k, v.name])];
  const artOpts = Object.entries(ARTS).map(([k, v]) => [k, `${v.name}（${v.rarity}）`]);
  const rarOpts = RARITY_ORDER.map((k) => [k, k]);
  const shapeOpts = Object.entries(SHAPE_INFO).filter(([k]) => k !== 'folding').map(([k, v]) => [k, v.name]);
  const matOpts = MAT_ORDER.map((k) => [k, MATERIAL_INFO[k].name]);
  $('brands').innerHTML = `<thead><tr><th>ガチャ</th><th>レア度</th><th>名前</th><th>形・素材</th><th>絵柄</th><th>特性</th><th>必殺技</th></tr></thead><tbody>${
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
        <td>${sel([...base, 'skill'], skillOpts, b.skill, '必殺技')}</td></tr>`;
    }).join('')}</tbody>`;
}
$('addBrand').addEventListener('click', () => {
  const a = new Uint8Array(4); crypto.getRandomValues(a);
  const id = 'ruler:x-' + Array.from(a, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 8);
  draft.brands = { ...(draft.brands || {}), [id]: { custom: true, name: '新しい定規', rarity: 'R', shape: 'straight30', mat: 'acrylic', art: 'plain', trait: null, skill: 'power', gacha: true } };
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
    if (p[0] === 'traits' || p[0] === 'skillTune') {
      const small = el.parentElement.querySelector('small');
      if (small && p[0] === 'traits') small.textContent = traitDesc(p[1], val);
    }
    if (p[0] === 'skillTune') renderSkills();
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
        <span class="give"><input type="number" step="1" value="100" aria-label="${esc(u.name)}に配る本数" id="g-${u.id}"><button type="button" data-give="${u.id}">配る</button></span>
      </li>`;
    }).join('') : '<li class="who" style="color:var(--ink-soft)">見つかりませんでした</li>';
  } catch (e) { toast(e.message); }
}
$('searchForm').addEventListener('submit', (e) => { e.preventDefault(); searchUsers($('q').value.trim()); });
$('users').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-give]');
  if (!b) return;
  const id = b.dataset.give;
  const amount = Number($('g-' + id).value);
  b.disabled = true;
  try {
    const r = await api('/api/admin/gift', { userId: id, amount, title: $('giftTitle').value.trim() });
    document.querySelector(`[data-coins="${id}"]`).textContent = r.coins;
    toast(r.inbox ? `受け取り箱に${amount}${ECONOMY.unit}届けました（受け取ると増えます）` : `減らしました（いま${r.coins}${ECONOMY.unit}）`);
  } catch (err) { toast(err.message); }
  finally { b.disabled = false; }
});

start();
