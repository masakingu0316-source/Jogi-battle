// 設定画面（管理者だけ）
import { ITEMS, RARITIES, ECONOMY, ECONOMY_KEYS, ORDER, GACHA_POOL, STATS, odds, sanitizeConfig, configProblem } from './shared/catalog.js';

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
  renderEconomy();
  renderRarities();
  renderItems();
  markChanges();
}

function renderEconomy() {
  $('economy').innerHTML = Object.entries(ECONOMY_KEYS).map(([k, r]) => `
    <label for="e-${k}">${r.name}（${ECONOMY.unit}）
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
  const dirty = !same(sanitizeConfig(draft), saved);
  const problem = configProblem(sanitizeConfig(draft));
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
    }).join('') : '<li class="who" style="color:var(--chalk-dim)">見つかりませんでした</li>';
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
    const r = await api('/api/admin/gift', { userId: id, amount });
    document.querySelector(`[data-coins="${id}"]`).textContent = r.coins;
    toast(`${amount > 0 ? '配りました' : '減らしました'}（いま${r.coins}${ECONOMY.unit}）`);
  } catch (err) { toast(err.message); }
  finally { b.disabled = false; }
});

start();
