// ログイン・マイページ（定規ケース・ガチャ・戦績）
import { ITEMS, RARITIES, ECONOMY, GACHA_POOL, odds, accText as accTextOf, defaultConfig } from './shared/catalog.js';
import { MODES } from './shared/rules.js';
import { previewRuler } from './ruler-paint.js';
import { matChip, levelHtml, levelOfRuler, nextText, specText, skillText } from './ruler-info.js';

const ALL_RULERS = Object.values(ITEMS).filter((it) => it.kind === 'ruler');

const RANK = { basic: 0, N: 1, R: 2, SR: 3, SSR: 4 };

export function createAccount(ctx) {
  const { app, $, esc, toast } = ctx;
  let tab = 'case';
  let editing = null; // 定規ケースで選んでいる定規
  // 値段・確率・アクセサリの効き目は、管理者の設定（/api/config）に合わせる
  const game = () => app.game || defaultConfig();
  const accText = (id) => accTextOf(id, game());

  async function api(path, body) {
    const opt = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
    const res = await fetch(path, opt);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '通信に失敗しました。もう一度お試しください。');
    return data;
  }

  async function reloadGame() {
    try { const c = await api('/api/config'); if (c.game) app.game = c.game; } catch { /* 前の値のまま */ }
  }

  // ---- ログイン状態 ----
  async function load() {
    try { app.config = await api('/api/config'); } catch { app.config = { login: false }; }
    app.game = app.config.game || defaultConfig();
    if (app.config.login) await refresh(true);
    updateHeader();
  }

  async function refresh(showBonus = false) {
    try {
      const data = await api('/api/me');
      app.me = data.user;
      if (showBonus && data.dailyBonus) toast(`ログインボーナス：${ECONOMY.currency}${data.dailyBonus}${ECONOMY.unit}`);
    } catch { /* 読めなければログインしていない扱い */ }
    updateHeader();
  }

  function updateHeader() {
    $('account').hidden = !app.me;
    if (app.me) {
      $('meName').textContent = app.me.name;
      $('meCoins').textContent = app.me.coins;
    }
  }

  function setCoins(n) {
    if (!app.me) return;
    app.me.coins = n;
    $('meCoins').textContent = n;
    if (!$('mypage').hidden && tab === 'gacha') renderGachaButtons();
  }

  // ---- 画面の出し入れ ----
  function open(which = 'case') {
    if (!app.me) return;
    app.view = 'mypage';
    ctx.show('mypage');
    $('myBack').textContent = app.state ? '← 部屋に戻る' : '← ホームに戻る';
    select(which);
  }
  function close() {
    if (app.state) { app.view = 'room'; ctx.render(); }
    else ctx.showHome();
  }
  function select(which) {
    tab = which;
    for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === which));
    for (const t of ['case', 'gacha', 'record']) $('tab-' + t).hidden = t !== which;
    if (which === 'case') renderCase();
    if (which === 'gacha') { reloadGame().then(renderGacha); renderGacha(); }
    if (which === 'record') renderRecord();
  }

  $('meChip').addEventListener('click', () => open('case'));
  $('myBack').addEventListener('click', close);
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) select(b.dataset.tab);
  });
  $('openCase').addEventListener('click', () => open('case'));

  // ---- 定規ケース ----
  const owned = () => new Set(app.me?.owned || []);
  const ownedOf = (kind) => [...owned()].map((id) => ITEMS[id]).filter((it) => it && it.kind === kind)
    .sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || a.name.localeCompare(b.name, 'ja'));
  const rarityTag = (r) => (r === 'basic' ? '' : `<span class="rar" style="background:${RARITIES[r].color}">${r}</span>`);
  const lookOf = (rulerId, setup) => ({ specKey: ITEMS[rulerId].specKey, level: levelOfRuler(app.me, rulerId).level, pattern: setup?.pattern || null, sticker: setup?.sticker || null });
  function setupSummary(setup) {
    const bits = [];
    if (setup?.pattern) bits.push(ITEMS[setup.pattern]?.name);
    if (setup?.sticker) bits.push(ITEMS[setup.sticker]?.name);
    if (setup?.acc) bits.push(`${ITEMS[setup.acc]?.name}（${accText(setup.acc)}）`);
    return bits.filter(Boolean).join('・');
  }

  function renderCase() {
    const me = app.me;
    const have = owned();
    if (!editing || !have.has(editing)) editing = me.selectedRuler;
    const got = [...have].filter((id) => ITEMS[id] && ITEMS[id].rarity !== 'basic').length;
    $('collection').textContent = `集めたアイテム ${got} / ${GACHA_POOL.length}`;
    // 形ごとに並べる。持っていない定規は、どこで手に入るかだけ見せる
    $('rulerList').innerHTML = ALL_RULERS.map((r) => {
      if (!have.has(r.id)) {
        return `<div class="ruler-card locked" aria-label="${esc(r.name)}（まだ持っていません）">
          <canvas data-preview="${r.id}" aria-hidden="true"></canvas>
          <span class="rc-name">${esc(r.name)} ${rarityTag(r.rarity)}</span>
          <span class="rc-sub">ガチャで出ます</span></div>`;
      }
      const lv = levelOfRuler(me, r.id);
      return `<button type="button" class="ruler-card" data-ruler="${r.id}" aria-pressed="${r.id === editing}">
        <canvas data-preview="${r.id}" aria-hidden="true"></canvas>
        <span class="rc-name">${esc(r.name)} ${rarityTag(r.rarity)}${r.id === me.selectedRuler ? '<span class="badge you">使用中</span>' : ''}</span>
        <span class="rc-lv">${matChip(r.mat)}${levelHtml(lv)}</span>
        <span class="rc-sub">${esc(setupSummary(me.setups[r.id]) || '飾りなし')}</span>
      </button>`;
    }).join('');
    for (const c of document.querySelectorAll('[data-preview]')) previewRuler(c, lookOf(c.dataset.preview, me.setups[c.dataset.preview]));
    renderEditor();
  }
  $('rulerList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ruler]');
    if (!b) return;
    editing = b.dataset.ruler;
    for (const x of document.querySelectorAll('[data-ruler]')) x.setAttribute('aria-pressed', String(x.dataset.ruler === editing));
    renderEditor();
  });

  function fillSelect(el, kind, value, label) {
    el.innerHTML = '<option value="">なし</option>' + ownedOf(kind).map((it) =>
      `<option value="${it.id}">${esc(it.name)}${label ? `（${label(it)}）` : ''} [${it.rarity}]</option>`).join('');
    el.value = value || '';
  }
  function renderEditor() {
    const me = app.me;
    $('editor').hidden = !editing;
    if (!editing) return;
    const s = me.setups[editing] || {};
    fillSelect($('edPattern'), 'pattern', s.pattern);
    fillSelect($('edSticker'), 'sticker', s.sticker);
    fillSelect($('edAcc'), 'acc', s.acc, (it) => accText(it.id));
    $('saveSetup').textContent = editing === me.selectedRuler ? '保存する' : 'この定規を使う';
    $('saveNote').textContent = '';
    updatePreview();
  }
  function currentEdit() {
    return { ruler: editing, pattern: $('edPattern').value || null, sticker: $('edSticker').value || null, acc: $('edAcc').value || null };
  }
  function updatePreview() {
    const e = currentEdit();
    previewRuler($('previewBig'), lookOf(e.ruler, e));
    const r = ITEMS[e.ruler], lv = levelOfRuler(app.me, e.ruler);
    $('edTitle').innerHTML = `${esc(r.name)} ${matChip(r.mat)}`;
    $('edLevel').innerHTML = `${levelHtml(lv)}<span class="xp-note">${nextText(lv)}</span>`;
    const base = specText(e.ruler, lv.level, app.game);
    $('accDesc').textContent = (e.acc ? `${base}　アクセサリ：${accText(e.acc)}` : base) + `\n${skillText(e.ruler, app.game)}`;
  }
  for (const id of ['edPattern', 'edSticker', 'edAcc']) $(id).addEventListener('change', updatePreview);

  $('saveSetup').addEventListener('click', async () => {
    const e = currentEdit();
    $('saveSetup').disabled = true;
    try {
      await api('/api/me/setup', e);
      app.me.setups[e.ruler] = { pattern: e.pattern, sticker: e.sticker, acc: e.acc };
      app.me.selectedRuler = e.ruler;
      ctx.onProfile?.();
      // 待合室にいれば、部屋の定規もすぐに入れ替える
      if (app.state && app.state.phase !== 'aim') ctx.send({ t: 'ruler', ruler: e.ruler });
      renderCase();
      $('saveNote').textContent = '保存しました';
    } catch (err) {
      $('saveNote').textContent = err.message;
    } finally {
      $('saveSetup').disabled = false;
    }
  });

  // ---- ガチャ ----
  function renderGachaButtons() {
    const c = app.me?.coins ?? 0;
    const e = game().economy;
    $('pull1').textContent = `1回引く（${e.pull1}${ECONOMY.unit}）`;
    $('pull10').textContent = `10回引く（${e.pull10}${ECONOMY.unit}）`;
    $('pull1').disabled = c < e.pull1;
    $('pull10').disabled = c < e.pull10;
    // 押せない理由と、えんぴつのため方を出す
    const how = `対戦に参加すると${e.play}本（勝つと${e.play + e.win}本）、毎日のログインで${e.daily}本もらえます。`;
    $('gachaNote').textContent = c < e.pull1
      ? `${ECONOMY.currency}が足りません（いま${c}本、1回に${e.pull1}本必要）。${how}`
      : c < e.pull10 ? `いまは${c}本。10回引くにはあと${e.pull10 - c}本必要です。` : '';
  }
  function renderGacha() {
    renderGachaButtons();
    $('oddsTable').innerHTML = `<table><thead><tr><th>レア度</th><th>確率</th><th>1つあたり</th><th>中身</th></tr></thead><tbody>${
      odds(game()).filter((o) => o.items.length).map((o) => `<tr><td>${rarityTag(o.rarity)} ${o.name}</td><td>${o.percent.toFixed(1)}%</td><td>${o.each.toFixed(2)}%</td>
        <td>${o.items.map((id) => esc(ITEMS[id].name)).join('、')}</td></tr>`).join('')
    }</tbody></table><p class="wait">10回引くときの最後の1回は、Rレア以上のなかから上の比率で選ばれます。</p>`;
  }
  async function pull(count) {
    $('pull1').disabled = $('pull10').disabled = true;
    const dome = document.querySelector('.dome');
    dome.classList.remove('spin'); void dome.offsetWidth; dome.classList.add('spin');
    try {
      const r = await api('/api/gacha', { count });
      for (const x of r.results) if (!x.dup) app.me.owned.push(x.id);
      setCoins(r.coins);
      $('gachaResults').innerHTML = r.results.map((x, i) => {
        const it = ITEMS[x.id];
        const kind = { ruler: '定規', pattern: '柄', sticker: 'シール', acc: 'アクセサリ' }[it.kind];
        const extra = it.kind === 'acc' ? `・${accText(it.id)}` : it.kind === 'ruler' ? `・${ITEMS[it.id].desc.split('。')[1]}` : '';
        return `<div class="prize${x.dup ? '' : ' new'}" style="animation-delay:${i * 60}ms; border-color:${RARITIES[it.rarity].color}">
          <span class="p-name">${rarityTag(it.rarity)} ${esc(it.name)}</span>
          <span class="p-sub">${kind}${extra}　${x.dup ? `かぶり → ${ECONOMY.currency}+${x.refund}` : 'NEW'}</span></div>`;
      }).join('');
    } catch (err) {
      toast(err.message);
    } finally {
      renderGachaButtons();
    }
  }
  $('pull1').addEventListener('click', () => pull(1));
  $('pull10').addEventListener('click', () => pull(10));

  // ---- 戦績 ----
  async function renderRecord() {
    $('myNameInput').value = app.me.name;
    await refresh();
    $('myId').textContent = app.me.id;
    $('adminLink').hidden = !app.me.admin;
    const st = app.me.stats;
    const rate = st.games ? Math.round(st.wins / st.games * 100) + '%' : '—';
    const tiles = [['対戦', st.games], ['勝ち', st.wins], ['勝率', rate], ['落とした数', st.kos], ['自滅', st.selfOuts]];
    $('statRow').innerHTML = tiles.map(([k, v]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
    $('modeTable').innerHTML = `<thead><tr><th>モード</th><th>対戦</th><th>勝ち</th><th>勝率</th></tr></thead><tbody>${
      Object.entries(MODES).map(([k, m]) => {
        const r = st.byMode[k] || { games: 0, wins: 0 };
        return `<tr><td>${m.name}</td><td>${r.games}</td><td>${r.wins}</td><td>${r.games ? Math.round(r.wins / r.games * 100) + '%' : '—'}</td></tr>`;
      }).join('')}</tbody>`;
    try {
      const { matches } = await api('/api/me/matches');
      $('history').innerHTML = matches.length ? matches.map((m) => {
        const others = m.names.filter((_, i) => i !== m.seat).map(esc).join('・');
        const d = new Date(m.playedAt);
        const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const extra = [m.kos ? `${m.kos}人落とした` : '', m.selfOut ? '自滅' : ''].filter(Boolean).join('・');
        return `<li><span class="res${m.won ? ' win' : ''}">${m.won ? '勝ち' : '負け'}</span>
          <span class="detail">${MODES[m.mode]?.name || m.mode}　vs ${others}<small>${when}・${esc(ITEMS[m.ruler]?.name || '')}${extra ? '・' + extra : ''}</small></span>
          <span class="gain">${m.coins ? `+${m.coins}${ECONOMY.unit}` : ''}</span></li>`;
      }).join('') : '<li class="empty">まだ対戦の記録がありません。ログインした状態で対戦すると、ここに残ります。</li>';
    } catch (err) {
      $('history').innerHTML = `<li class="empty">${esc(err.message)}</li>`;
    }
  }
  $('renameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/me/name', { name: $('myNameInput').value });
      app.me.name = r.name;
      updateHeader();
      toast('表示名を変えました。次に部屋に入ったときから反映されます');
    } catch (err) { toast(err.message); }
  });
  $('logout').addEventListener('click', async () => {
    try { await fetch('/auth/logout', { method: 'POST' }); } catch { }
    app.me = null;
    updateHeader();
    ctx.onLogout();
    toast('ログアウトしました');
  });

  return { load, refresh, updateHeader, setCoins, open, close };
}
