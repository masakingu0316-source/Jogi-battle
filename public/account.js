// ログイン・マイページ（定規ケース・ガチャ・戦績）
import {
  ITEMS, RARITIES, ECONOMY, GACHA_POOL, odds, accText as accTextOf, defaultConfig, levelInfo, STAGE_LEVEL_MAX,
  rulerList, rulerOdds, RULER_RARITY, RARITY_ORDER, applyConfig, brandSkill,
} from './shared/catalog.js';
import { MODES, TRAITS, traitDesc, SKILLS } from './shared/rules.js';
import { previewRuler, iconRuler } from './ruler-paint.js';
import { matChip, levelHtml, levelOfRuler, nextText, specText, skillText } from './ruler-info.js';

// 定規の一覧は設定（追加した銘柄）で変わるので、そのつど読む
const allRulers = () => rulerList();
const RANK = { N: 1, R: 2, SR: 3, SSR: 4 };

export function createAccount(ctx) {
  const { app, $, esc, toast } = ctx;
  let tab = 'case';
  let editing = null; // 定規ケースで選んでいる定規
  let picking = false; // 部屋から開いた：選んだ定規で戦う（選んだら部屋に戻る）
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
    try { const c = await api('/api/config'); if (c.game) { app.game = c.game; applyConfig(app.game); } } catch { /* 前の値のまま */ }
  }

  // ---- ログイン状態 ----
  async function load() {
    try { app.config = await api('/api/config'); } catch { app.config = { login: false }; }
    app.game = app.config.game || defaultConfig();
    applyConfig(app.game); // 設定で変えた銘柄・追加した銘柄を一覧に入れる
    if (app.config.login) await refresh(true);
    updateHeader();
  }

  async function refresh(showBonus = false) {
    try {
      const data = await api('/api/me');
      app.me = data.user;
      if (showBonus && data.dailyBonus) toast(`毎日ボーナス（${ECONOMY.currency}${data.dailyBonus}${ECONOMY.unit}）が受け取り箱に届きました`);
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
    if (!$('mypage').hidden && tab === 'gacha') { renderGachaButtons(); renderRulerGacha(); }
    if (!$('resCoins').closest('[hidden]')) $('resCoins').textContent = n;
  }

  // ---- 画面の出し入れ ----
  // opt.edit：相棒の定規の編集をすぐ開く（ホームの相棒を押したとき・部屋から）
  // opt.pick：部屋から「定規ケースから選ぶ」で開いた（選んだら、その定規で部屋に戻る）
  function open(which = 'case', opt = {}) {
    if (!app.me) return;
    app.view = 'mypage';
    ctx.show('mypage');
    picking = !!(opt.pick && app.state && app.state.phase !== 'aim');
    // 部屋にいるときは、下のタブの代わりに「部屋に戻る」を出す
    $('myHead').hidden = !app.state;
    $('pickNote').hidden = !picking;
    $('mypage').classList.toggle('picking', picking);
    window.scrollTo(0, 0);
    select(which);
    ctx.onTab?.(which);
    if (which === 'case' && opt.edit) {
      editing = app.me.selectedRuler;
      renderEditor();
      const d = $('rulerSheet');
      if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
    }
  }
  function close() {
    picking = false;
    $('mypage').classList.remove('picking');
    if ($('rulerSheet').open) $('rulerSheet').close?.();
    if (app.state) { app.view = 'room'; ctx.render(); }
    else ctx.showHome();
  }
  function select(which) {
    tab = which;
    for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === which));
    for (const t of ['case', 'gacha', 'record', 'other']) $('tab-' + t).hidden = t !== which;
    if (which === 'case') renderCase();
    if (which === 'gacha') { reloadGame().then(renderGacha); renderGacha(); }
    if (which === 'record') renderRecord();
    if (which === 'other') renderOther();
  }

  $('meChip').addEventListener('click', () => open('case'));
  $('myBack').addEventListener('click', close);

  // ---- 定規ケース ----
  const owned = () => new Set(app.me?.owned || []);
  const ownedOf = (kind) => [...owned()].map((id) => ITEMS[id]).filter((it) => it && it.kind === kind)
    .sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || a.name.localeCompare(b.name, 'ja'));
  const rarityTag = (r) => `<span class="rar" style="background:${RULER_RARITY[r]?.color || RARITIES[r]?.color || '#ccc'}">${r}</span>`;
  const lookOf = (rulerId, setup) => ({ specKey: ITEMS[rulerId].specKey, art: ITEMS[rulerId].art, level: levelOfRuler(app.me, rulerId).level, pattern: setup?.pattern || null, sticker: setup?.sticker || null });
  // 対人の上限（Lv.10）を超えたら、ステージでのレベルも見せる
  const stageLvText = (id) => {
    const x = levelInfo(app.me?.exp?.[id] || 0, STAGE_LEVEL_MAX);
    return x.level > 10 ? `<small class="stage-lv">ステージLv.${x.level}</small>` : '';
  };
  function setupSummary(setup) {
    const bits = [];
    if (setup?.pattern) bits.push(ITEMS[setup.pattern]?.name);
    if (setup?.sticker) bits.push(ITEMS[setup.sticker]?.name);
    if (setup?.acc) bits.push(`${ITEMS[setup.acc]?.name}（${accText(setup.acc)}）`);
    return bits.filter(Boolean).join('・');
  }

  // ---- 定規ケース（ゲームの BOX のように、正方形のアイコンで並べる） ----
  const SORTS = {
    got: { name: '取得順', note: '新しく手に入れた順' },
    level: { name: 'レベル順', note: '経験値の多い順' },
    rarity: { name: 'レア度順', note: 'めずらしい順' },
    shape: { name: '形順', note: '形・素材の順' },
  };
  const MATS = { all: 'すべて', acrylic: 'アクリル', metal: 'メタル', rubber: 'ラバー' };
  const RANK_FULL = { basic: 0, N: 1, R: 2, SR: 3, SSR: 4, stage: 5 };
  const NEW_MS = 3 * 24 * 3600 * 1000;
  const pref = (k, def) => { try { return localStorage.getItem('jogi:case:' + k) || def; } catch { return def; } };
  const savePref = (k, v) => { try { localStorage.setItem('jogi:case:' + k, v); } catch { /* 保存できなくても動く */ } };
  let caseSort = SORTS[pref('sort', 'got')] ? pref('sort', 'got') : 'got';
  let caseMat = MATS[pref('mat', 'all')] ? pref('mat', 'all') : 'all';
  const orderOf = (id) => allRulers().findIndex((r) => r.id === id);
  const howToGet = (r) => (r.stage ? 'ステージ「可変定規編」をすべてクリアするともらえる' : r.gacha ? `定規ガチャで出る（${RULER_RARITY[r.rarity]?.name || r.rarity}）` : '今は手に入りません');

  function sortedRulers() {
    const me = app.me, have = owned();
    const exp = (id) => me.exp?.[id] || 0;
    const got = (id) => me.acquired?.[id] ?? 0;
    const list = allRulers().filter((r) => caseMat === 'all' || r.mat === caseMat);
    const cmp = {
      got: (a, b) => got(b.id) - got(a.id) || orderOf(a.id) - orderOf(b.id),
      level: (a, b) => exp(b.id) - exp(a.id) || orderOf(a.id) - orderOf(b.id),
      rarity: (a, b) => RANK_FULL[b.rarity] - RANK_FULL[a.rarity] || orderOf(a.id) - orderOf(b.id),
      shape: (a, b) => orderOf(a.id) - orderOf(b.id),
    }[caseSort];
    // 持っている定規を先に、まだ持っていない定規はうしろに（形順だけは図鑑のように元の並び）
    return list.sort((a, b) => (caseSort === 'shape' ? 0 : (have.has(b.id) ? 1 : 0) - (have.has(a.id) ? 1 : 0)) || cmp(a, b));
  }

  function renderCase() {
    const me = app.me;
    const have = owned();
    const all = allRulers().length;
    const mine = allRulers().filter((r) => have.has(r.id)).length;
    $('caseCount').textContent = mine;
    $('caseTotal').textContent = all;
    $('caseMeter').style.width = `${Math.round((mine / all) * 100)}%`;
    const got = [...have].filter((id) => ITEMS[id] && ITEMS[id].kind !== 'ruler').length;
    const byRar = RARITY_ORDER.map((k) => `${k} ${allRulers().filter((r) => r.rarity === k && have.has(r.id)).length}/${allRulers().filter((r) => r.rarity === k).length}`).join('・');
    $('collection').textContent = `${byRar}　飾り ${got}／${GACHA_POOL.length}`;
    $('caseFilter').innerHTML = Object.entries(MATS).map(([k, n]) => `<button type="button" data-mat="${k}" aria-pressed="${k === caseMat}">${n}</button>`).join('');
    const sortOpts = Object.entries(SORTS).map(([k, x]) => `<option value="${k}">${x.name}</option>`).join('');
    if ($('caseSort').dataset.opts !== sortOpts) { $('caseSort').innerHTML = sortOpts; $('caseSort').dataset.opts = sortOpts; }
    $('caseSort').value = caseSort;
    const list = sortedRulers();
    const now = Date.now();
    $('rulerList').innerHTML = list.map((r) => {
      const has = have.has(r.id);
      const lv = levelOfRuler(me, r.id);
      const slv = levelInfo(me.exp?.[r.id] || 0, STAGE_LEVEL_MAX);
      const fresh = has && (me.acquired?.[r.id] || 0) > now - NEW_MS;
      const using = r.id === me.selectedRuler;
      const sk = SKILLS[brandSkill(r, app.game)];
      const label = (has ? `${r.name} Lv.${lv.level}${slv.level > lv.level ? `（ステージLv.${slv.level}）` : ''}${using ? '・使用中' : ''}` : `${r.name}（まだ持っていません）`) + (sk ? `・必殺技「${sk.name}」` : '');
      return `<button type="button" class="box-tile r-${r.rarity} m-${r.mat}${has ? '' : ' locked'}${using ? ' using' : ''}" data-ruler="${r.id}" aria-label="${esc(label)}">
        <canvas data-icon="${r.id}" aria-hidden="true"></canvas>
        <span class="bt-rar">${r.rarity}</span>
        ${using ? '<span class="bt-use">使用中</span>' : fresh ? '<span class="bt-new">NEW</span>' : ''}
        ${has ? `<span class="bt-lv${lv.max ? ' max' : ''}">Lv${slv.level > lv.level ? slv.level : lv.level}</span>` : '<span class="bt-q">？</span>'}
        ${sk ? `<span class="bt-sk${sk.ssr ? ' ssr' : ''}${[...sk.name].length > 3 ? ' long' : ''}" style="--sk:${sk.color}" aria-hidden="true">${esc(sk.name)}</span>` : ''}
      </button>`;
    }).join('') || '<p class="box-empty">この素材の定規はまだありません</p>';
    $('caseChip').textContent = `${list.filter((r) => have.has(r.id)).length}/${list.length}`;
    for (const c of document.querySelectorAll('[data-icon]')) {
      const id = c.dataset.icon;
      const look = { ...lookOf(id, me.setups[id]), art: ITEMS[id].art, level: levelInfo(me.exp?.[id] || 0, STAGE_LEVEL_MAX).level };
      iconRuler(c, look, { locked: !have.has(id) });
    }
    if ($('rulerSheet').open) renderEditor();
  }
  $('rulerList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ruler]');
    if (!b) return;
    editing = b.dataset.ruler;
    renderEditor();
    const d = $('rulerSheet');
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  });
  $('caseFilter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mat]');
    if (!b) return;
    caseMat = b.dataset.mat; savePref('mat', caseMat);
    renderCase();
  });
  $('caseSort').addEventListener('change', () => { caseSort = $('caseSort').value; savePref('sort', caseSort); renderCase(); });
  $('caseHelpBtn').addEventListener('click', () => {
    const open = $('caseHelp').hidden;
    $('caseHelp').hidden = !open;
    $('caseHelpBtn').setAttribute('aria-expanded', String(open));
  });
  const closeSheet = () => { const d = $('rulerSheet'); if (d.open) { if (d.close) d.close(); else d.removeAttribute('open'); } };
  $('sheetClose').addEventListener('click', closeSheet);
  // 外側（暗いところ）を押しても閉じる
  $('rulerSheet').addEventListener('click', (e) => { if (e.target === $('rulerSheet')) closeSheet(); });

  function fillSelect(el, kind, value, label) {
    el.innerHTML = '<option value="">なし</option>' + ownedOf(kind).map((it) =>
      `<option value="${it.id}">${esc(it.name)}${label ? `（${label(it)}）` : ''} [${it.rarity}]</option>`).join('');
    el.value = value || '';
  }
  function renderEditor() {
    const me = app.me;
    if (!editing) return;
    const has = owned().has(editing);
    $('edEdit').hidden = !has;
    $('edActions').hidden = !has;
    if (!has) {
      // まだ持っていない定規：形と手に入れ方だけ見せる
      const r = ITEMS[editing];
      previewRuler($('previewBig'), { specKey: r.specKey, art: r.art, level: 1 });
      $('edTitle').innerHTML = `${esc(r.name)} ${matChip(r.mat)} ${rarityTag(r.rarity)}`;
      $('edLevel').innerHTML = '<span class="xp-note">まだ持っていません</span>';
      $('accDesc').textContent = `${howToGet(r)}\n${r.desc}\n${traitLine(editing)}${skillText(editing, app.game)}`;
      return;
    }
    const s = me.setups[editing] || {};
    fillSelect($('edPattern'), 'pattern', s.pattern);
    fillSelect($('edSticker'), 'sticker', s.sticker);
    fillSelect($('edAcc'), 'acc', s.acc, (it) => accText(it.id));
    $('saveSetup').textContent = picking ? 'この定規で戦う' : editing === me.selectedRuler ? '保存する（相棒）' : '相棒にする';
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
    $('edTitle').innerHTML = `${esc(r.name)} ${matChip(r.mat)} ${rarityTag(r.rarity)}`;
    const slv = levelInfo(app.me?.exp?.[e.ruler] || 0, STAGE_LEVEL_MAX);
    $('edLevel').innerHTML = `${levelHtml(lv)}<span class="xp-note">${lv.max ? `対人は最大レベル・ステージ Lv.${slv.level}${slv.max ? '（最大）' : `（次まで あと${slv.need - slv.into}点）`}` : nextText(lv)}</span>`;
    const base = specText(e.ruler, lv.level, app.game);
    $('accDesc').textContent = (e.acc ? `${base}　アクセサリ：${accText(e.acc)}` : base) + `\n${traitLine(e.ruler)}${skillText(e.ruler, app.game)}`;
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
      if (picking) {
        // 部屋から選んだときは、そのまま部屋に戻る
        ctx.toast?.(`「${ITEMS[e.ruler].name}」で戦います`);
        close();
        return;
      }
      renderCase();
      $('saveNote').textContent = '保存しました';
    } catch (err) {
      $('saveNote').textContent = err.message;
    } finally {
      $('saveSetup').disabled = false;
    }
  });

  // 特性の説明（SR以上）
  function traitLine(id) {
    const it = ITEMS[id];
    if (!it?.trait) return '';
    const pct = game().traits?.[it.trait] ?? TRAITS[it.trait].pct;
    return `特性「${TRAITS[it.trait].name}」：${traitDesc(it.trait, pct)}\n`;
  }

  // ---- その他 ----
  function renderOther() {
    $('myNameInput').value = app.me.name;
    $('myId').textContent = app.me.id;
    $('adminLink').hidden = !app.me.admin;
  }

  // ---- ガチャ（定規ガチャ／飾りガチャ） ----
  let gachaKind = 'ruler';
  document.querySelector('.gacha-switch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-gacha]');
    if (!b) return;
    gachaKind = b.dataset.gacha;
    renderGacha();
  });
  function renderRulerGacha() {
    const c = app.me?.coins ?? 0;
    const g = game().rulerGacha;
    $('rpull1').textContent = `1回引く（${g.pull1}${ECONOMY.unit}）`;
    $('rpull10').textContent = `10回引く（${g.pull10}${ECONOMY.unit}）`;
    $('rpull1').disabled = c < g.pull1;
    $('rpull10').disabled = c < g.pull10;
    const pity = app.me?.pity ?? 0;
    $('pity').hidden = !g.pity;
    if (g.pity) {
      $('pityBar').style.width = `${Math.min(100, (pity / g.pity) * 100)}%`;
      $('pityText').textContent = `あと${g.pity - pity}回（${pity}／${g.pity}）`;
    }
    const e = game().economy;
    $('rgachaNote').textContent = c < g.pull1
      ? `${ECONOMY.currency}が足りません（いま${c}本、1回に${g.pull1}本必要）。対戦に参加すると${e.play}本（勝つと${e.play + e.win}本）、毎日ボーナスで${e.daily}本もらえます。`
      : c < g.pull10 ? `いまは${c}本。10回引くにはあと${g.pull10 - c}本必要です。` : '';
    $('roddsTable').innerHTML = `<table><thead><tr><th>レア度</th><th>確率</th><th>1本あたり</th><th>中身</th></tr></thead><tbody>${
      rulerOdds(game()).filter((o) => o.items.length).map((o) => `<tr><td>${rarityTag(o.rarity)} ${o.name}</td><td>${o.percent.toFixed(1)}%</td><td>${o.each.toFixed(2)}%</td>
        <td>${o.items.map((id) => esc(ITEMS[id].name)).join('、')}</td></tr>`).join('')
    }</tbody></table><p class="wait">10回引くときの最後の1本は、SR以上のなかから上の比率で選ばれます。${g.pity ? `${g.pity}回引くごとに、受け取り箱に「SSR交換券」が届き、ガチャに出るSSRから好きな1本を選べます。` : ''}持っている定規が出たら、えんぴつに変えて返します（${RARITY_ORDER.map((k) => `${k} ${g.refund[k]}本`).join('・')}）。</p>`;
  }
  async function pullRuler(count) {
    $('rpull1').disabled = $('rpull10').disabled = true;
    const dome = document.querySelector('#gachaRuler .dome');
    dome.classList.remove('spin'); void dome.offsetWidth; dome.classList.add('spin');
    try {
      const r = await api('/api/ruler-gacha', { count });
      for (const x of r.results) if (!x.dup && !app.me.owned.includes(x.id)) { app.me.owned.push(x.id); (app.me.acquired ||= {})[x.id] = Date.now(); }
      app.me.pity = r.pity;
      setCoins(r.coins);
      if (r.tickets) { app.me.inbox = (app.me.inbox || 0) + r.tickets; toast('天井に届きました！ 受け取り箱に「SSR交換券」が届いています'); }
      $('rgachaResults').innerHTML = r.results.map((x, i) => {
        const it = ITEMS[x.id];
        return `<div class="rprize r-${it.rarity}${x.dup ? '' : ' new'}" style="animation-delay:${i * 70}ms">
          <span class="box-tile r-${it.rarity} m-${it.mat}"><canvas data-rprize="${x.id}" aria-hidden="true"></canvas><span class="bt-rar">${it.rarity}</span>${x.dup ? '' : '<span class="bt-new">NEW</span>'}</span>
          <span class="p-name">${esc(it.name)}</span>
          <span class="p-sub">${x.dup ? `持っている → ${ECONOMY.currency}+${x.refund}` : esc(it.trait ? `特性 ${TRAITS[it.trait].name}` : RULER_RARITY[it.rarity].theme)}</span></div>`;
      }).join('');
      for (const c of document.querySelectorAll('[data-rprize]')) { const it = ITEMS[c.dataset.rprize]; iconRuler(c, { specKey: it.specKey, art: it.art, level: 1 }); }
      ctx.onProfile?.();
    } catch (err) {
      toast(err.message);
    } finally {
      renderRulerGacha();
    }
  }
  $('rpull1').addEventListener('click', () => pullRuler(1));
  $('rpull10').addEventListener('click', () => pullRuler(10));

  // ---- 飾りガチャ ----

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
    for (const b of document.querySelectorAll('[data-gacha]')) b.setAttribute('aria-selected', String(b.dataset.gacha === gachaKind));
    $('gachaRuler').hidden = gachaKind !== 'ruler';
    $('gachaDecor').hidden = gachaKind !== 'decor';
    renderRulerGacha();
    renderGachaButtons();
    $('oddsTable').innerHTML = `<table><thead><tr><th>レア度</th><th>確率</th><th>1つあたり</th><th>中身</th></tr></thead><tbody>${
      odds(game()).filter((o) => o.items.length).map((o) => `<tr><td>${rarityTag(o.rarity)} ${o.name}</td><td>${o.percent.toFixed(1)}%</td><td>${o.each.toFixed(2)}%</td>
        <td>${o.items.map((id) => esc(ITEMS[id].name)).join('、')}</td></tr>`).join('')
    }</tbody></table><p class="wait">10回引くときの最後の1回は、Rレア以上のなかから上の比率で選ばれます。</p>`;
  }
  async function pull(count) {
    $('pull1').disabled = $('pull10').disabled = true;
    const dome = document.querySelector('#gachaDecor .dome');
    dome.classList.remove('spin'); void dome.offsetWidth; dome.classList.add('spin');
    try {
      const r = await api('/api/gacha', { count });
      for (const x of r.results) if (!x.dup) app.me.owned.push(x.id);
      setCoins(r.coins);
      $('gachaResults').innerHTML = r.results.map((x, i) => {
        const it = ITEMS[x.id];
        const kind = { ruler: '定規', pattern: '柄', sticker: 'シール', acc: 'アクセサリ' }[it.kind];
        const extra = it.kind === 'acc' ? `・${accText(it.id)}` : '';
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
    await refresh();
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
