// @ts-check
// Плашка комбинации: рекомендуемая, выбранная или расчётная. Миниатюры и 4 показателя.

import { MAX_ADDITIONAL } from '../domain/combo.js';
import { formatHa, formatIp, formatK0, formatK1 } from '../domain/format.js';
import { el } from './dom.js';
import { siteFigure } from './figure.js';
import { CATEGORIES } from './messages.js';

/** @typedef {import('../domain/combo.js').Site} Site */
/** @typedef {import('../domain/combo.js').ComboSummary} ComboSummary */
/** @typedef {'rec' | 'sel' | 'opt'} CardVariant */

/**
 * @param {Site} site
 * @param {boolean} isNew  добавлена оптимизацией
 * @param {((id: string) => void) | undefined} onRemove
 */
function tile(site, isNew, onRemove) {
  const letter = CATEGORIES[site.category].letter;
  return el('li', { className: `tile${isNew ? ' tile--new' : ''}` },
    letter && el('abbr', { className: 'tile-letter', attrs: { title: CATEGORIES[site.category].label } }, letter),
    el('span', { className: 'badge' }, site.id),
    siteFigure(site, 'thumb'),
    isNew && el('span', { className: 'visually-hidden' }, 'добавлена оптимизацией'),
    // Снятие — в правом нижнем углу, напротив масштабной линейки
    onRemove && el('button', {
      className: 'tile-remove',
      attrs: { type: 'button', 'aria-label': `Убрать площадку ${site.id}`, title: 'Убрать', 'data-key': `remove-${site.id}` },
      on: { click: () => onRemove(site.id) },
    }));
}

/**
 * Ряд миниатюр всегда из 4 ячеек, сообщение — поверх пустого ряда:
 * высота плашки не зависит от содержимого, и сетка не «прыгает».
 * @param {Site[]} added
 * @param {Set<string>} newIds
 * @param {string} emptyText
 * @param {string | null} message
 * @param {((id: string) => void) | undefined} onRemove
 */
function tiles(added, newIds, emptyText, message, onRemove) {
  const slots = Array.from({ length: MAX_ADDITIONAL - added.length }, (_, i) =>
    el('li', { className: 'tile tile--empty', attrs: { 'aria-hidden': 'true' } },
      !message && i === 0 && added.length === 0 ? emptyText : ''));
  return el('div', { className: 'tiles-wrap' },
    el('ul', { className: `tiles${message ? ' tiles--muted' : ''}`, attrs: { 'aria-label': 'Присоединённые площадки' } },
      added.map((s) => tile(s, newIds.has(s.id), onRemove)), slots),
    message && el('p', { className: 'card-message' }, message));
}

/** @param {string} label @param {string} value */
const metric = (label, value) =>
  el('div', { className: 'metric' }, el('dt', {}, label), el('dd', { className: 'metric-value' }, value));

/** @param {ComboSummary | null} s */
function metrics(s) {
  const dash = '—';
  return el('dl', { className: `metrics${s && !s.ipValid ? ' metrics--invalid' : ''}` },
    metric('Индекс инвести\u00ADционного потен\u00ADциала', s ? formatIp(s.ip) : dash),
    metric('Площадь участков, га', s ? formatHa(s.areaHa) : dash),
    metric('Градострои\u00ADтельный потенциал, тыс.\u00A0м²', s ? formatK0(s.gradM2) : dash),
    metric('Аварийное жильё, тыс.\u00A0м²', s ? formatK1(s.avarM2) : dash));
}

/**
 * Содержимое секции-плашки вместе с заголовком.
 * @param {Object} p
 * @param {string} p.titleId
 * @param {string} p.title
 * @param {(string | null)[]} [p.notes]  пояснения в колонках 2–3 шапки
 * @param {Site[]} p.members  опорная первой; пусто — плашка без данных
 * @param {ComboSummary | null} p.summary
 * @param {string} [p.emptyText]  текст в пустой ячейке миниатюр
 * @param {string | null} [p.message]  текст вместо миниатюр
 * @param {Set<string>} [p.newIds]  площадки, добавленные оптимизацией
 * @param {(id: string) => void} [p.onRemove]
 * @param {(HTMLElement | false)[]} [p.actions]  кнопка в 4-й колонке шапки
 * @param {HTMLElement} [p.footer]  блок под плашкой (параметры сценариев)
 */
export function comboCard({ titleId, title, notes = [], members, summary, emptyText = '', message = null,
  newIds = new Set(), onRemove, actions = [], footer }) {
  const invalid = summary !== null && !summary.ipValid;
  return [
    // Шапка по сетке миниатюр: название | пояснения (2 колонки) | кнопка
    el('div', { className: 'card-head' },
      el('h2', { className: 'panel-title', attrs: { id: titleId } }, title),
      el('div', { className: 'card-notes' },
        notes.filter(Boolean).map((n) => el('p', { className: 'card-note' }, n)),
        invalid && el('p', { className: 'metric-warning' }, 'Не проходит методику: индекс должен быть строго больше 0')),
      el('div', { className: 'card-actions' }, actions.filter(Boolean))),
    el('div', { className: 'card-body' },
      tiles(message ? [] : members.slice(1), newIds, emptyText, message, onRemove),
      metrics(summary)),
    footer,
  ];
}
