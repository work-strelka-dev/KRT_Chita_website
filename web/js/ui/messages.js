// @ts-check
// Тексты интерфейса, которые зависят от данных.

import { MAX_ADDITIONAL, MAX_AREA_HA } from '../domain/combo.js';
import { formatHa, plural } from '../domain/format.js';

/** @typedef {import('../domain/combo.js').Site} Site */
/** @typedef {{ ok: false, reason: 'standalone' | 'notAddable' | 'full' | 'area' | 'noAnchor', remainingHa: number }} Blocked */

/** Короткая причина в строке списка. @param {Blocked} b */
export function blockedShort(b) {
  switch (b.reason) {
    case 'noAnchor': return 'сначала выберите опорную';
    case 'standalone': return 'опорная рассматривается самостоятельно';
    case 'notAddable': return `больше ${MAX_AREA_HA} га, не присоединяется`;
    case 'full': return `уже ${MAX_ADDITIONAL} ${plural(MAX_ADDITIONAL, ['площадка', 'площадки', 'площадок'])}`;
    case 'area': return `не помещается: осталось ${formatHa(Math.max(0, b.remainingHa))} га`;
  }
}

/** Полное объяснение: что случилось и что делать. @param {Site} site @param {Blocked} b @param {string | null} anchorId */
export function blockedLong(site, b, anchorId) {
  switch (b.reason) {
    case 'noAnchor': return 'Сначала выберите опорную площадку в списке выше.';
    case 'standalone':
      return `Опорная ${anchorId} больше ${MAX_AREA_HA} га и рассматривается самостоятельно: присоединять к ней площадки нельзя.`;
    case 'notAddable': return `Площадку ${site.id} нельзя присоединить: её площадь больше ${MAX_AREA_HA} га.`;
    case 'full':
      return `Добавлено максимум площадок: ${MAX_ADDITIONAL}. Уберите одну, чтобы добавить ${site.id}.`;
    case 'area':
      return `Площадка ${site.id} (${formatHa(site.areaHa)} га) не помещается: осталось ${formatHa(Math.max(0, b.remainingHa))} га из ${MAX_AREA_HA}.`;
  }
}

/** @param {string[]} ids @param {string} anchorId */
export function droppedMessage(ids, anchorId) {
  const noun = ids.length === 1 ? 'Снята площадка' : 'Сняты площадки';
  return `${noun} ${ids.join(', ')}: с опорной ${anchorId} не помещаются в ${MAX_AREA_HA} га.`;
}

/** @param {string} siteId @param {string} anchorId */
export function assignedMessage(siteId, anchorId) {
  return `В рекомендуемом наборе ${siteId} закреплена за опорной ${anchorId}.`;
}

/**
 * Категории: подпись в строке списка, фильтр и буква для миниатюр плашек.
 * Опорной буква не нужна: в миниатюрах она не показывается.
 * @type {Record<string, { label: string, filter?: string, letter?: string }>}
 */
export const CATEGORIES = {
  'опорная': { label: 'опорная' },
  'нейтральная площадка': { label: 'нейтральная', filter: 'Нейтральная', letter: 'Н' },
  'обременение': { label: 'обременение', filter: 'Обременение', letter: 'О' },
  'вознаграждение': { label: 'вознаграждение', filter: 'Вознаграждение', letter: 'В' },
};
