// 着せ替えの画面（ホームのアバターを押して開く）
import { AVATAR_SLOTS, SLOT_INFO, partsOf, partOf, partId, randomAvatar, avatarKey } from './shared/avatar.js';
import { drawAvatar, avatarImage } from './avatar-paint.js';
import { TITLES, CLEAR_REWARD, defaultClassmates, TEACHER_NO } from './shared/dojo.js';

// 部位ごとに、パーツの見本をどう切り出すか
const THUMB = {
  skin: 'face', hair: 'face', hairColor: 'face', eyes: 'face', face: 'face', head: 'face',
  outfit: 'full', jacket: 'full', item: 'full', bg: 'full',
};

// 称号のタブ（部位のタブの最後）
const TITLE_TAB = 'title';

export function createAvatarEditor({ app, $, esc, toast, show, onClose }) {
  let draft = null, saved = null, slot = 'hair', leaveArmed = false;
  let title = null, savedTitle = null;
  const owns = (s, p) => p.basic || app.me?.owned.includes(partId(s, p.key));
  const dirty = () => saved && (avatarKey(draft) !== avatarKey(saved) || title !== savedTitle);
  // 手に入れ方（バトル道場のだれに勝つと手に入るか）
  function howToGet(id) {
    if (CLEAR_REWARD.includes(id)) return 'バトル道場：30人破り';
    const list = Array.isArray(app.game?.classmates) && app.game.classmates.length ? app.game.classmates : defaultClassmates();
    const c = list.find((x) => x.reward?.includes(id));
    if (c) return `バトル道場：${c.no === TEACHER_NO ? '担任の先生' : `${c.no}番 ${c.name}`}`;
    return '道場の報酬など';
  }

  function open() {
    if (!app.me) return;
    saved = { ...app.me.avatar };
    draft = { ...saved };
    savedTitle = title = app.me.title || null;
    slot = 'hair';
    leaveArmed = false;
    app.view = 'avatar';
    show('avatarScreen');
    $('avNew').hidden = !!app.me.avatarSet;
    render();
  }
  function render() {
    renderPreview(); renderSlots(); renderParts(); renderActions();
  }
  function renderPreview() {
    const c = $('avCanvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = c.clientWidth || 160, h = c.clientHeight || 240;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawAvatar(ctx, draft, { x: 0, y: 0, w, h, view: 'full', bg: true });
  }
  function renderSlots() {
    const t = TITLES.find((x) => x.id === title);
    $('avSlots').innerHTML = AVATAR_SLOTS.map((s) => {
      const p = partOf(s.key, draft[s.key]);
      return `<button type="button" role="tab" class="av-slot${s.key === slot ? ' on' : ''}" data-slot="${s.key}" aria-selected="${s.key === slot}">
        <b>${esc(s.name)}</b><small>${esc(p ? p.name : 'なし')}</small></button>`;
    }).join('') + `<button type="button" role="tab" class="av-slot${slot === TITLE_TAB ? ' on' : ''}" data-slot="${TITLE_TAB}" aria-selected="${slot === TITLE_TAB}">
        <b>称号</b><small>${esc(t ? t.name : 'なし')}</small></button>`;
    $('avSlots').querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function tile(key, p) {
    const s = SLOT_INFO[slot];
    const on = (draft[slot] ?? null) === key;
    const view = THUMB[slot];
    const has = !p || owns(slot, p);
    const img = avatarImage({ ...draft, [slot]: key }, { view, size: view === 'face' ? 72 : 64, bg: slot === 'bg' });
    const rar = p && !p.basic ? `<span class="av-rar">${p.rarity}</span>` : '';
    return `<button type="button" class="av-tile${on ? ' on' : ''}${has ? '' : ' locked'}" data-key="${key ?? ''}" aria-pressed="${on}"
      aria-label="${esc(s.name)}：${esc(p ? p.name : 'なし')}${has ? '' : '（まだ持っていません）'}">
      <span class="av-thumb ${view}"><img src="${img}" alt="" draggable="false"></span>
      <span class="av-name">${esc(p ? p.name : 'なし')}</span>${rar}
      ${has ? '' : `<span class="av-lock">${esc(howToGet(partId(slot, key)))}</span>`}
    </button>`;
  }
  // 称号：名札とホームのアバターの下に出る
  function titleTile(t) {
    const on = (title ?? null) === (t?.id ?? null);
    const has = !t || app.me?.owned.includes(t.id);
    return `<button type="button" class="av-tile title-tile${on ? ' on' : ''}${has ? '' : ' locked'}" data-title="${t?.id ?? ''}" aria-pressed="${on}"
      aria-label="称号：${esc(t ? t.name : 'なし')}${has ? '' : '（まだ持っていません）'}">
      <span class="av-thumb title">${t ? `<em class="title-chip big" style="--tc:${t.color}">${esc(t.name)}</em>` : '<small>なし</small>'}</span>
      <span class="av-name">${esc(t ? t.name : 'なし')}</span>
      ${has ? '' : `<span class="av-lock">${esc(howToGet(t.id))}</span>`}
    </button>`;
  }
  function renderParts() {
    if (slot === TITLE_TAB) {
      $('avParts').innerHTML = titleTile(null) + TITLES.map(titleTile).join('') + '<p class="av-title-note">称号は、部屋の名札・対戦中の名前・ホームのアバターの下に出ます</p>';
      return;
    }
    const s = SLOT_INFO[slot];
    const list = partsOf(slot).sort((a, b) => (owns(slot, b) - owns(slot, a)) || (b.basic - a.basic));
    $('avParts').innerHTML = (s.none ? tile(null, null) : '') + list.map((p) => tile(p.key, p)).join('');
  }
  function renderActions() {
    $('avUndo').disabled = !dirty();
    $('avSave').disabled = !dirty() && app.me.avatarSet;
    $('avBack').textContent = leaveArmed ? '← 保存しないで戻る' : '← ホーム';
  }

  $('avSlots').addEventListener('click', (e) => {
    const b = e.target.closest('[data-slot]');
    if (!b) return;
    slot = b.dataset.slot;
    renderSlots(); renderParts();
    $('avParts').scrollTop = 0;
  });
  $('avParts').addEventListener('click', (e) => {
    const tb = e.target.closest('[data-title]');
    if (tb) {
      const id = tb.dataset.title || null;
      const t = TITLES.find((x) => x.id === id);
      if (t && !app.me?.owned.includes(t.id)) { toast(`称号「${t.name}」はまだ持っていません（${howToGet(t.id)}）`); return; }
      title = id;
      leaveArmed = false;
      renderSlots(); renderParts(); renderActions();
      return;
    }
    const b = e.target.closest('[data-key]');
    if (!b) return;
    const key = b.dataset.key || null;
    const p = partOf(slot, key);
    if (p && !owns(slot, p)) {
      toast(`「${p.name}」はまだ持っていません（${howToGet(partId(slot, key))}）`);
      return;
    }
    draft[slot] = key;
    leaveArmed = false;
    renderPreview(); renderSlots(); renderParts(); renderActions();
  });
  $('avRandom').addEventListener('click', () => {
    // 持っているパーツの中から、おまかせ
    draft = randomAvatar(`${Date.now()}-${Math.random()}`, { allow: (s, p) => owns(s, p), noneRate: 0.5 });
    leaveArmed = false;
    render();
  });
  $('avUndo').addEventListener('click', () => { draft = { ...saved }; title = savedTitle; leaveArmed = false; render(); });
  $('avSave').addEventListener('click', async () => {
    $('avSave').disabled = true;
    try {
      const res = await fetch('/api/me/avatar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ avatar: draft, title }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '保存できませんでした');
      app.me.avatar = data.avatar;
      app.me.avatarSet = true;
      app.me.title = data.title || null;
      savedTitle = title = app.me.title;
      saved = { ...data.avatar };
      draft = { ...data.avatar };
      toast('アバターを保存しました');
      onClose?.();
    } catch (err) { toast(err.message); renderActions(); }
  });
  $('avBack').addEventListener('click', () => {
    if (dirty() && !leaveArmed) { leaveArmed = true; renderActions(); toast('保存していない着せ替えがあります。もう一度押すと、保存しないで戻ります'); return; }
    leaveArmed = false;
    onClose?.();
  });
  window.addEventListener('resize', () => { if (!$('avatarScreen').hidden) renderPreview(); });
  return { open };
}
