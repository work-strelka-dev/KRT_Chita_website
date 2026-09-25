// @ts-check
// Формулы методики для одной комбинации. Зеркало krt_optimizer/models.py:
// меняются только вместе, с пересборкой tests/golden_cases.json.

/**
 * @typedef {Object} Site
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {number} areaHa
 * @property {number} ip
 * @property {number} avarM2
 * @property {number} gradM2
 * @property {number} sppNewM2
 * @property {number} sppDemolM2
 * @property {string} image
 * @property {[number, number]} imageSize
 * @property {string} thumb
 * @property {[number, number]} thumbSize
 * @property {number} imageWidthM
 * @property {boolean} addable
 * @property {string | null} reason
 */

/**
 * @typedef {Object} ComboSummary
 * @property {number} count
 * @property {number} areaHa
 * @property {number} ip
 * @property {boolean} ipValid
 * @property {boolean} areaFits
 * @property {number} remainingHa
 * @property {number} avarM2
 * @property {number} gradM2
 * @property {number} sppNewM2
 * @property {number} sppDemolM2
 * @property {number} deltaAvarM2
 * @property {number} deltaSppNewM2
 * @property {number} deltaSppDemolM2
 */

export const MAX_AREA_HA = 45;
export const MAX_ADDITIONAL = 4;
export const ANCHOR_CATEGORY = 'опорная';

// Площадь в десятых долях гектара, IP в сотых: в данных ровно столько знаков,
// поэтому сравнения с 45 га и с IP = 1 точные.
const tenthsHa = (/** @type {Site} */ s) => Math.round(s.areaHa * 10);
const MAX_AREA_TENTHS = MAX_AREA_HA * 10;

/** @param {Site[]} sites @param {(s: Site) => number} value */
const sum = (sites, value) => sites.reduce((acc, s) => acc + value(s), 0);

/** Площадь комбинации, га. @param {Site[]} sites */
export function totalAreaHa(sites) {
  return sum(sites, tenthsHa) / 10;
}

/** Интегральный IP: средневзвешенный по площади. @param {Site[]} sites */
export function integralIp(sites) {
  const area = sum(sites, (s) => s.areaHa);
  return area > 0 ? sum(sites, (s) => s.ip * s.areaHa) / area : 0;
}

/** IP > 1 строго, в целых числах: Σ (ip·100 − 100)·(area·10) > 0. @param {Site[]} sites */
export function isIpValid(sites) {
  return sum(sites, (s) => (Math.round(s.ip * 100) - 100) * tenthsHa(s)) > 0;
}

/** Остаток до лимита 45 га (может быть отрицательным у крупной опорной). @param {Site[]} sites */
export function remainingAreaHa(sites) {
  return (MAX_AREA_TENTHS - sum(sites, tenthsHa)) / 10;
}

/** Крупная опорная (> 45 га) рассматривается самостоятельно. @param {Site} anchor */
export function isStandalone(anchor) {
  return tenthsHa(anchor) > MAX_AREA_TENTHS;
}

/**
 * Можно ли добавить площадку к текущему составу (опорная первой).
 * @param {Site[]} members
 * @param {Site} site
 * @returns {{ ok: true } | { ok: false, reason: 'standalone' | 'notAddable' | 'full' | 'area', remainingHa: number }}
 */
export function canAdd(members, site) {
  const remainingHa = remainingAreaHa(members);
  if (isStandalone(members[0])) return { ok: false, reason: 'standalone', remainingHa };
  if (!site.addable) return { ok: false, reason: 'notAddable', remainingHa };
  if (members.length > MAX_ADDITIONAL) return { ok: false, reason: 'full', remainingHa };
  if (tenthsHa(site) > Math.round(remainingHa * 10)) return { ok: false, reason: 'area', remainingHa };
  return { ok: true };
}

/**
 * Показатели комбинации. Суммы — по всей комбинации, Δ — только по присоединённым.
 * @param {Site[]} members опорная первой
 * @returns {ComboSummary}
 */
export function summarize(members) {
  const added = members.slice(1);
  const remainingHa = remainingAreaHa(members);
  return {
    count: members.length,
    areaHa: totalAreaHa(members),
    ip: integralIp(members),
    ipValid: isIpValid(members),
    areaFits: remainingHa >= 0,
    remainingHa,
    avarM2: sum(members, (s) => s.avarM2),
    gradM2: sum(members, (s) => s.gradM2),
    sppNewM2: sum(members, (s) => s.sppNewM2),
    sppDemolM2: sum(members, (s) => s.sppDemolM2),
    deltaAvarM2: sum(added, (s) => s.avarM2),
    deltaSppNewM2: sum(added, (s) => s.sppNewM2),
    deltaSppDemolM2: sum(added, (s) => s.sppDemolM2),
  };
}
