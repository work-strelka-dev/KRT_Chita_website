// @ts-check
// Оптимизация выбора: к оставленным площадкам добавляются те, что дают лучшую
// комбинацию при соблюдении методики (≤ 45 га, ≤ 5 площадок, IP > 1).
// Зеркало tools/optimize_reference.py: меняются только вместе, с пересборкой golden.
//
// Лексикографические цели методики (input_data/Промпт_воспроизведение_оптимизации_КРТ.md, п. 4),
// перенесённые на одну комбинацию:
//   1. охват: больше площадок в комбинации;
//   2. компактность: при зафиксированном охвате на одну комбинацию не влияет;
//   3. Парето обеспечивается шагами 4–6;
//   4. Δ аварийного фонда ↑   5. Δ новой жилой застройки ↑   6. Δ прочей сносимой застройки ↓
//   (Δ — по всем неопорным площадкам комбинации, как в методике);
//   7. меньшие ID в естественном порядке — только для однозначности.

import { MAX_ADDITIONAL, isIpValid, isStandalone, remainingAreaHa } from './combo.js';

/** @typedef {import('./combo.js').Site} Site */
/**
 * @typedef {{ status: 'ok', added: Site[] }
 *   | { status: 'standalone' | 'full' | 'infeasible', added: [] }} OptimizeResult
 */

/** @param {Site} s */
const tenths = (s) => Math.round(s.areaHa * 10);

/** Естественный порядок ID: 2.1 < 10.1. @param {string} a @param {string} b */
export function compareIds(a, b) {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
}

/** @param {Site[]} members опорная первой */
const score = (members) => {
  const added = members.slice(1);
  const delta = (/** @type {(s: Site) => number} */ f) => added.reduce((acc, s) => acc + f(s), 0);
  return [members.length, delta((s) => s.avarM2), delta((s) => s.sppNewM2), -delta((s) => s.sppDemolM2)];
};

/**
 * true, если вариант a лучше b.
 * @param {{ score: number[], ids: string[] }} a
 * @param {{ score: number[], ids: string[] }} b
 */
function isBetter(a, b) {
  for (let i = 0; i < a.score.length; i += 1) {
    if (a.score[i] !== b.score[i]) return a.score[i] > b.score[i];
  }
  for (let i = 0; i < a.ids.length; i += 1) {
    const cmp = compareIds(a.ids[i], b.ids[i]);
    if (cmp !== 0) return cmp < 0;
  }
  return false;
}

/**
 * @param {Site[]} kept  опорная первой, затем оставленные площадки
 * @param {Site[]} pool  кандидаты на добавление (без kept)
 * @returns {OptimizeResult}
 */
export function optimizeCombo(kept, pool) {
  if (isStandalone(kept[0])) return { status: 'standalone', added: [] };
  const slots = MAX_ADDITIONAL - (kept.length - 1);
  if (slots <= 0) return { status: 'full', added: [] };

  // Сортировка по площади: как только площадка не влезает, дальше не влезет ни одна.
  const sorted = [...pool].sort((a, b) => tenths(a) - tenths(b) || compareIds(a.id, b.id));
  /** @type {{ score: number[], ids: string[], added: Site[] } | null} */
  let best = null;
  /** @type {Site[]} */
  const stack = [];

  const consider = () => {
    const members = [...kept, ...stack];
    if (!isIpValid(members)) return;
    const added = [...stack].sort((a, b) => compareIds(a.id, b.id));
    const candidate = { score: score(members), ids: added.map((s) => s.id), added };
    if (!best || isBetter(candidate, best)) best = candidate;
  };

  /** @param {number} start @param {number} budget остаток площади в десятых га */
  const search = (start, budget) => {
    consider();
    if (stack.length === slots) return;
    for (let i = start; i < sorted.length; i += 1) {
      const site = sorted[i];
      if (tenths(site) > budget) break;
      stack.push(site);
      search(i + 1, budget - tenths(site));
      stack.pop();
    }
  };
  search(0, Math.round(remainingAreaHa(kept) * 10));

  const found = /** @type {{ added: Site[] } | null} */ (best);
  return found ? { status: 'ok', added: found.added } : { status: 'infeasible', added: [] };
}
