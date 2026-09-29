// @ts-check
// Списки выбора: опорные площадки (A1) и добавляемые (A2:A3).
// Индекс в списках не показывается: он виден в плашках сценария.

import { MAX_AREA_HA, isStandalone } from '../domain/combo.js';
import { formatHa } from '../domain/format.js';
import { el } from './dom.js';
import { CATEGORIES, blockedShort } from './messages.js';

/** @typedef {import('../domain/combo.js').Site} Site */
/** @typedef {import('./messages.js').Blocked} Blocked */
/** @typedef {{ ok: true } | Blocked} Availability */

/** @param {Site} site */
const siteArea = (site) => `${formatHa(site.areaHa)} га`;

/**
 * @param {Object} p
 * @param {Site} p.site
 * @param {boolean} p.pressed
 * @param {string[]} p.notes  первая — основная строка, остальные — вторичные (адрес)
 * @param {Availability} [p.availability]
 * @param {() => void} p.onClick
 */
function siteButton({ site, pressed, notes, availability = { ok: true }, onClick }) {
  const blocked = !availability.ok && !pressed;
  // «Сначала выберите опорную» одна на весь список, а не в каждой строке
  const blockedText = !availability.ok && availability.reason !== 'noAnchor' ? blockedShort(availability) : null;
  return el('li', {},
    el('button', {
      className: 'site-row',
      attrs: { type: 'button', 'aria-pressed': String(pressed), 'aria-disabled': blocked ? 'true' : null, 'data-key': `site-${site.id}` },
      on: { click: onClick },
    },
    el('span', { className: 'site-row-id' }, site.id),
    el('span', { className: 'site-row-body' },
      notes.map((n, i) => el('span', { className: i === 0 ? 'site-row-main' : 'site-row-note' }, n)),
      blocked && blockedText ? el('span', { className: 'site-row-blocked' }, blockedText) : null),
    ));
}

/**
 * @param {Site[]} anchors
 * @param {string | null} anchorId
 * @param {(id: string) => void} onPick
 */
export function anchorItems(anchors, anchorId, onPick) {
  return anchors.map((site) => siteButton({
    site,
    pressed: site.id === anchorId,
    notes: [
      isStandalone(site) ? `${siteArea(site)} · больше ${MAX_AREA_HA} га, самостоятельная` : siteArea(site),
      site.name,
    ].filter(Boolean),
    onClick: () => onPick(site.id),
  }));
}

/**
 * @param {Object} p
 * @param {Site[]} p.sites
 * @param {Set<string>} p.selected
 * @param {(site: Site) => Availability} p.availability
 * @param {(id: string) => void} p.onToggle
 */
export function addItems({ sites, selected, availability, onToggle }) {
  return sites.map((site) => siteButton({
    site, pressed: selected.has(site.id),
    notes: [`${CATEGORIES[site.category].label} · ${siteArea(site)}`, site.name].filter(Boolean),
    availability: availability(site),
    onClick: () => onToggle(site.id),
  }));
}

/**
 * Переключатель: вкладки или фильтр. Каждая кнопка — { key, label, count? }.
 * @param {Object} p
 * @param {'tab' | 'chip'} p.kind
 * @param {string} p.label  подпись группы для скринридера
 * @param {{ key: string, label: string, count?: number }[]} p.options
 * @param {string} p.current
 * @param {(key: string) => void} p.onChange
 * @param {string} [p.controls]  id панели, которой управляют вкладки
 * @param {string} [p.className]
 */
export function switcher({ kind, label, options, current, onChange, controls, className = '' }) {
  const isTab = kind === 'tab';
  return el('div', {
    className: `${isTab ? 'tabs' : 'chips'} ${className}`.trim(),
    attrs: { role: isTab ? 'tablist' : 'group', 'aria-label': label },
    on: isTab ? { keydown: (e) => moveTabFocus(/** @type {KeyboardEvent} */ (e), options, current, onChange) } : {},
  }, options.map((o) => el('button', {
    className: isTab ? 'tab' : 'chip',
    attrs: {
      type: 'button', 'data-key': `${kind}-${o.key}`,
      role: isTab ? 'tab' : null,
      'aria-selected': isTab ? String(o.key === current) : null,
      'aria-controls': isTab ? controls : null,
      tabindex: isTab && o.key !== current ? '-1' : null,
      'aria-pressed': isTab ? null : String(o.key === current),
    },
    on: { click: () => onChange(o.key) },
  }, o.label, o.count !== undefined && el('span', { className: 'count' }, o.count))));
}

/**
 * Стрелки влево/вправо переключают вкладки (паттерн WAI-ARIA Tabs).
 * @param {KeyboardEvent} event
 * @param {{ key: string }[]} options
 * @param {string} current
 * @param {(key: string) => void} onChange
 */
function moveTabFocus(event, options, current, onChange) {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (!step) return;
  event.preventDefault();
  const index = options.findIndex((o) => o.key === current);
  const next = options[(index + step + options.length) % options.length].key;
  onChange(next);
  /** @type {HTMLElement | null} */ (document.querySelector(`[data-key="tab-${next}"]`))?.focus();
}
