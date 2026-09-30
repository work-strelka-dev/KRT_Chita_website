// @ts-check
// Панель схемы опорной (B1:B2) и параметры сценариев в нижней плашке.

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
        fact('Градпотенциал', `${formatK0(anchor.gradM2)} тыс. м²`))),
    anchor.name && el('p', { className: 'anchor-name' }, anchor.name),
    siteFigure(anchor, 'image'),
  ];
}

/** @param {string} label @param {string} value */
const fact = (label, value) => el('div', {}, el('dt', {}, label), el('dd', {}, value));

/** @param {string} label @param {string} value */
const row = (label, value) => el('div', { className: 'check-row' }, el('dt', {}, label), el('dd', {}, value));

const MAX_SITES = MAX_ADDITIONAL + 1;
const IP_SCALE_MAX = 2; // шкала индекса 0…2, порог 1 — посередине

/** @param {number} share 0…1 */
const percent = (share) => `${Math.min(100, Math.max(0, share * 100))}%`;

/** Сплошная шкала; marker — отметка порога в долях ширины. @param {number} share @param {number} [marker] */
const bar = (share, marker) =>
  el('span', { className: 'gauge-bar' },
    el('span', { className: 'gauge-fill', style: { width: percent(share) } }),
    marker !== undefined && el('span', { className: 'gauge-marker', style: { left: percent(marker) } }));

/** Шкала из делений: по одному на площадку. @param {number} filled @param {number} total */
const segments = (filled, total) =>
  el('span', { className: 'gauge-bar gauge-bar--segments' },
    Array.from({ length: total }, (_, i) => el('span', { className: i < filled ? 'gauge-fill' : 'gauge-empty' })));

/**
 * Правило методики: подпись, шкала, значение с ✓ / ✗ (статус не только цветом).
 * @param {string} label @param {HTMLElement} scale @param {string} value @param {boolean} ok
 */
const gauge = (label, scale, value, ok) =>
  el('div', { className: `gauge gauge--${ok ? 'ok' : 'bad'}` },
    el('dt', {}, label),
    el('dd', {},
      el('span', { attrs: { 'aria-hidden': 'true' } }, scale),
      el('span', { className: 'gauge-value' },
        el('span', { className: 'check-mark', attrs: { 'aria-hidden': 'true' } }, ok ? '✓' : '✗'),
        el('span', { className: 'visually-hidden' }, ok ? 'выполнено: ' : 'не выполнено: '), value)));

/** Без комбинации — те же строки с пустыми шкалами и прочерками: высота плашки не меняется. */
const emptyGauge = (/** @type {string} */ label, /** @type {HTMLElement} */ scale) =>
  el('div', { className: 'gauge' }, el('dt', {}, label),
    el('dd', {}, el('span', { attrs: { 'aria-hidden': 'true' } }, scale), el('span', { className: 'gauge-value' }, '—')));

/** @param {ComboSummary | null} s */
function checks(s) {
  if (!s) {
    return el('dl', { className: 'gauges', attrs: { 'aria-label': 'Правила методики' } },
      emptyGauge('Площадь', bar(0)), emptyGauge('Площадок', segments(0, MAX_SITES)),
      emptyGauge('Индекс', bar(0, 1 / IP_SCALE_MAX)));
  }
  return el('dl', { className: 'gauges', attrs: { 'aria-label': 'Правила методики' } },
    gauge('Площадь', bar(s.areaHa / MAX_AREA_HA),
      s.areaFits ? `${formatHa(s.areaHa)} из ${MAX_AREA_HA} га` : `${formatHa(s.areaHa)} га > ${MAX_AREA_HA}`, s.areaFits),
    gauge('Площадок', segments(s.count, MAX_SITES), `${s.count} из ${MAX_SITES}`, s.count <= MAX_SITES),
    gauge('Индекс', bar(s.ip / IP_SCALE_MAX, 1 / IP_SCALE_MAX),
      s.ipValid ? `${formatIp(s.ip)} > 1` : `${formatIp(s.ip)}, нужно > 1`, s.ipValid));
}

/**
 * @typedef {Object} Comparison  разница target − base по 4 показателям; без данных — прочерки
 * @property {string} title
 * @property {ComboSummary | null} base
 * @property {ComboSummary | null} target
 */

/**
 * Разница с долей от базы: «+1,2 (+5 %)». База 0 — только разница.
 * @param {Comparison} cmp @param {(x: ComboSummary) => number} pick @param {(v: number) => string} fmt
 */
function diff({ base, target }, pick, fmt) {
  if (!base || !target) return '—';
  const d = pick(target) - pick(base);
  const b = pick(base);
  return b ? `${fmt(d)} (${signed.pct(d / b)})` : fmt(d);
}

/**
 * Параметры сценариев: правила методики (шкалы) и сравнение плашек. Предельные эффекты
 * не показываются: заказчик счёл их путающими (сумма по присоединённым, а не прирост).
 * Сворачиваются по нажатию на заголовок. Структура одна при любых данных: без комбинации — прочерки.
 * @param {ComboSummary | null} s  комбинация плашки, в которой стоит блок
 * @param {Comparison} cmp
 * @param {{ open: boolean, onToggle: () => void }} fold
 */
export function scenarioParams(s, cmp, fold) {
  return el('div', { className: 'params' },
    el('h3', { className: 'params-title' },
      el('button', {
        className: 'fold-toggle',
        attrs: { type: 'button', 'aria-expanded': String(fold.open), 'aria-controls': 'params-body', 'data-key': 'params-toggle' },
        on: { click: fold.onToggle },
      }, 'Параметры сценариев')),
    el('div', { className: 'params-body', attrs: { id: 'params-body', hidden: !fold.open } }, checks(s),
      el('h4', { className: 'panel-subtitle' }, cmp.title),
      el('dl', { className: 'check-list check-list--numbers' },
        row('Индекс инвестиционного потенциала', diff(cmp, (x) => x.ip, signed.ip)),
        row('Площадь, га', diff(cmp, (x) => x.areaHa, signed.ha)),
        row('Градпотенциал, тыс. м²', diff(cmp, (x) => x.gradM2, signed.k0)),
        row('Аварийное жильё, тыс. м²', diff(cmp, (x) => x.avarM2, signed.k1)))));
}
