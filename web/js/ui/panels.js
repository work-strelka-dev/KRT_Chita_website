// @ts-check
// Панели схемы опорной (B1:B2) и проверки методики (C3).

import { MAX_ADDITIONAL, MAX_AREA_HA } from '../domain/combo.js';
import { formatHa, formatIp, formatK0, signed } from '../domain/format.js';
import { el } from './dom.js';
import { siteFigure } from './figure.js';

/** @typedef {import('../domain/combo.js').Site} Site */
/** @typedef {import('../domain/combo.js').ComboSummary} ComboSummary */

/** @param {Site | null} anchor */
export function schemeBody(anchor) {
  if (!anchor) {
    return [el('p', { className: 'empty' }, 'Выберите опорную площадку в списке слева: здесь появится схема её территории.')];
  }
  return [
    el('div', { className: 'anchor-head' },
      el('span', { className: 'anchor-id' }, anchor.id),
      el('dl', { className: 'anchor-facts' },
        fact('Площадь', `${formatHa(anchor.areaHa)} га`),
        fact('Индекс', formatIp(anchor.ip)),
        fact('Градпотенциал', `${formatK0(anchor.gradM2)} тыс. м²`))),
    el('h3', { className: 'panel-subtitle' }, 'Схема территории'),
    siteFigure(anchor, 'image'),
  ];
}

/** @param {string} label @param {string} value */
const fact = (label, value) => el('div', {}, el('dt', {}, label), el('dd', {}, value));

/** @param {string} label @param {Node | string} value @param {'ok' | 'bad' | null} [status] */
const row = (label, value, status = null) =>
  el('div', { className: `check-row${status ? ` check-row--${status}` : ''}` },
    el('dt', {}, label),
    el('dd', {}, status && el('span', { className: 'check-mark', attrs: { 'aria-hidden': 'true' } }, status === 'ok' ? '✓' : '✗'), value));

/** @param {ComboSummary} s */
function areaRow(s) {
  const share = Math.min(100, (s.areaHa / MAX_AREA_HA) * 100);
  const text = s.areaFits
    ? `${formatHa(s.areaHa)} из ${MAX_AREA_HA} га, осталось ${formatHa(s.remainingHa)}`
    : `${formatHa(s.areaHa)} га > ${MAX_AREA_HA}, самостоятельная`;
  return row('Площадь', el('span', { className: 'meter-wrap' },
    el('span', { className: 'meter', attrs: { 'aria-hidden': 'true' } }, el('span', { style: { width: `${share}%` } })),
    text), s.areaFits ? 'ok' : null);
}

/**
 * @typedef {Object} Comparison  разница target − base по 4 показателям; без данных — прочерки
 * @property {string} title
 * @property {ComboSummary | null} base
 * @property {ComboSummary | null} target
 */

/**
 * @param {ComboSummary | null} s  выбранная
 * @param {Comparison} cmp  выводится всегда, чтобы высота панели не менялась
 */
export function checkBody(s, cmp) {
  if (!s) return [el('p', { className: 'empty' }, 'Появится после выбора опорной площадки.')];
  const blocks = [
    el('dl', { className: 'check-list' },
      areaRow(s),
      row('Площадок', `${s.count} из ${MAX_ADDITIONAL + 1}`, 'ok'),
      row('Индекс > 1', s.ipValid ? `проходит: ${formatIp(s.ip)}` : `не проходит: ${formatIp(s.ip)} ≤ 1`, s.ipValid ? 'ok' : 'bad')),
    el('h3', { className: 'panel-subtitle' }, 'Предельные эффекты присоединённых, тыс. м²'),
    el('dl', { className: 'check-list check-list--numbers' },
      row('Аварийный фонд', signed.k1(s.deltaAvarM2)),
      row('Новая жилая застройка', signed.k1(s.deltaSppNewM2)),
      row('Прочая сносимая застройка', signed.k1(s.deltaSppDemolM2))),
  ];
  const { base: b, target: t } = cmp;
  /** @param {(x: ComboSummary) => number} pick @param {(v: number) => string} fmt */
  const diff = (pick, fmt) => (b && t ? fmt(pick(t) - pick(b)) : '—');
  blocks.push(
    el('h3', { className: 'panel-subtitle' }, cmp.title),
    el('dl', { className: 'check-list check-list--numbers' },
      row('Индекс', diff((x) => x.ip, signed.ip)),
      row('Площадь, га', diff((x) => x.areaHa, signed.ha)),
      row('Градпотенциал, тыс. м²', diff((x) => x.gradM2, signed.k0)),
      row('Аварийное жильё, тыс. м²', diff((x) => x.avarM2, signed.k1))));
  return blocks;
}
