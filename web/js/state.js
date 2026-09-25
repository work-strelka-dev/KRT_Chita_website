// @ts-check
// Состояние = { anchorId, selectedIds }. Всё остальное вычисляется.
// Состояние и вкладка сценария живут в URL (?a=11.2&s=17.2,20.4&tab=opt),
// чтобы ссылкой можно было поделиться.

import { ANCHOR_CATEGORY, MAX_ADDITIONAL, canAdd } from './domain/combo.js';

/** @typedef {import('./domain/combo.js').Site} Site */
/** @typedef {{ anchorId: string | null, selectedIds: string[] }} State */

/** @typedef {'rec' | 'opt'} Scenario  рекомендуемый сценарий / оптимизация сценария */

export const EMPTY_STATE = /** @type {State} */ ({ anchorId: null, selectedIds: [] });

/** @param {string} search @returns {Scenario} */
export function readScenario(search) {
  return new URLSearchParams(search).get('tab') === 'opt' ? 'opt' : 'rec';
}

/**
 * Состав комбинации: опорная первой.
 * @param {State} state
 * @param {Map<string, Site>} byId
 * @returns {Site[]}
 */
export function members(state, byId) {
  const anchor = state.anchorId ? byId.get(state.anchorId) : undefined;
  if (!anchor) return [];
  return [anchor, ...state.selectedIds.map((id) => /** @type {Site} */ (byId.get(id)))];
}

/**
 * Приводит состояние к допустимому: известные ID, без повторов, в лимитах методики.
 * Площадки, которые не помещаются, снимаются по порядку и возвращаются в dropped.
 * @param {State} state
 * @param {Map<string, Site>} byId
 * @returns {{ state: State, dropped: string[] }}
 */
export function normalize(state, byId) {
  const anchor = state.anchorId ? byId.get(state.anchorId) : undefined;
  if (!anchor || anchor.category !== ANCHOR_CATEGORY) return { state: EMPTY_STATE, dropped: [] };

  /** @type {Site[]} */
  const kept = [anchor];
  const dropped = [];
  for (const id of new Set(state.selectedIds)) {
    const site = byId.get(id);
    if (!site) continue;
    if (canAdd(kept, site).ok) kept.push(site);
    else dropped.push(id);
  }
  return { state: { anchorId: anchor.id, selectedIds: kept.slice(1).map((s) => s.id) }, dropped };
}

/**
 * Состояние из строки запроса. Неизвестные значения молча отбрасываются.
 * @param {string} search
 * @param {Map<string, Site>} byId
 * @returns {State}
 */
export function readUrl(search, byId) {
  const params = new URLSearchParams(search);
  const selectedIds = (params.get('s') ?? '').split(',').filter((id) => byId.has(id)).slice(0, MAX_ADDITIONAL);
  return normalize({ anchorId: params.get('a'), selectedIds }, byId).state;
}

/** @param {State} state @param {Scenario} scenario */
export function writeUrl(state, scenario) {
  const params = new URLSearchParams();
  if (state.anchorId) params.set('a', state.anchorId);
  if (state.selectedIds.length) params.set('s', state.selectedIds.join(','));
  if (scenario === 'opt') params.set('tab', 'opt');
  const query = params.toString().replaceAll('%2C', ',');
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}
