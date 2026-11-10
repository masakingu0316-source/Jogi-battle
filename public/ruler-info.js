// 定規のレベル・属性の表示（ホーム・定規ケース・部屋・対戦で共用）
import Physics from './shared/physics.js';
import { ITEMS, MATERIAL_INFO, matInfo, levelInfo, levelBonus } from './shared/catalog.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const rulerOf = (id) => (ITEMS[id]?.kind === 'ruler' ? ITEMS[id] : null);
export const levelOfRuler = (me, id) => levelInfo(me?.exp?.[id] || 0);

// 属性のしるし（色つきの小さな札）
export function matChip(mat) {
  const m = MATERIAL_INFO[mat];
  return m ? `<span class="mat mat-${mat}">${m.name}</span>` : '';
}
// 「ラバーに強い・メタルに弱い」
export function affinityText(mat) {
  const m = matInfo(mat);
  return `${MATERIAL_INFO[m.strong].name}に強い・${MATERIAL_INFO[m.weak].name}に弱い`;
}
// レベルと経験値のバー
export function levelHtml(info, { bar = true } = {}) {
  const pct = info.max ? 100 : Math.round((info.into / info.need) * 100);
  return `<span class="lv${info.max ? ' max' : ''}">Lv.${info.level}</span>${bar ? `<span class="xp" role="img" aria-label="${info.max ? '最大レベル' : `次のレベルまで${info.need - info.into}点`}"><i style="width:${pct}%"></i></span>` : ''}`;
}
export function nextText(info) {
  return info.max ? '最大レベル' : `次のレベルまで あと${info.need - info.into}点`;
}
// 定規の性能の説明（重さは素材と形で決まる。レベルの分も見せる）
export function specText(id, level) {
  const r = rulerOf(id);
  if (!r) return '';
  const spec = Physics.RULERS[r.specKey];
  const bonus = levelBonus(level);
  const lv = bonus ? `　レベルで 重さ・はじく力 +${(bonus * 100).toFixed(1)}%` : '';
  return `重さ${spec.mass}g・${MATERIAL_INFO[r.mat].desc}（${affinityText(r.mat)}）${lv}`;
}
export function rulerTitle(id) {
  const r = rulerOf(id);
  return r ? esc(r.name) : '';
}
