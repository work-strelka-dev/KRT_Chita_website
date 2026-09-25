// @ts-check
// Загрузка данных сайта. Всё, что пришло по сети, проверяется до использования.

/** @typedef {import('./domain/combo.js').Site} Site */

/**
 * @typedef {Object} Recommendation
 * @property {'regular' | 'standalone'} type
 * @property {string[]} additional
 */

/**
 * @typedef {Object} Dataset
 * @property {string} version
 * @property {Site[]} sites
 * @property {Map<string, Site>} byId
 * @property {Map<string, Recommendation>} recommended
 * @property {Map<string, string>} assignedTo  неопорная → опорная в рекомендуемом наборе
 * @property {number} coverage
 * @property {number} total
 */

export class DataError extends Error {}

const ID = /^\d{1,3}\.\d$/;
const IMAGE = /^img\/parcels\/\d{1,3}\.\d(\.thumb)?\.webp$/;
const NUMBER_FIELDS = /** @type {const} */ (['areaHa', 'ip', 'avarM2', 'gradM2', 'sppNewM2', 'sppDemolM2', 'imageWidthM']);
const CATEGORIES = new Set(['опорная', 'вознаграждение', 'нейтральная площадка', 'обременение']);

/** @param {unknown} ok @param {string} message @returns {asserts ok} */
function check(ok, message) {
  if (!ok) throw new DataError(message);
}

/** @param {string} path */
async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-cache', credentials: 'same-origin' });
  check(response.ok, `Не удалось загрузить ${path}: HTTP ${response.status}`);
  return response.json();
}

const isSize = (/** @type {unknown} */ v) =>
  Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n > 0);

/** @param {any} s @returns {Site} */
function checkSite(s) {
  check(s && typeof s.id === 'string' && ID.test(s.id), 'Некорректный ID площадки');
  const where = `площадка ${s.id}`;
  check(CATEGORIES.has(s.category), `${where}: неизвестная категория`);
  for (const field of NUMBER_FIELDS) {
    check(Number.isFinite(s[field]) && s[field] >= 0, `${where}: поле ${field} не число`);
  }
  check(IMAGE.test(s.image) && IMAGE.test(s.thumb), `${where}: некорректный путь к схеме`);
  check(isSize(s.imageSize) && isSize(s.thumbSize), `${where}: некорректный размер схемы`);
  check(typeof s.addable === 'boolean', `${where}: нет признака addable`);
  check(s.reason === null || typeof s.reason === 'string', `${where}: некорректная причина`);
  check(typeof s.name === 'string', `${where}: некорректное название`);
  return s;
}

/**
 * @param {any} raw
 * @param {Map<string, Site>} byId
 * @returns {Map<string, Recommendation>}
 */
function checkRecommended(raw, byId) {
  check(raw && typeof raw.byAnchor === 'object', 'recommended.json: нет byAnchor');
  const result = new Map();
  for (const [anchorId, rec] of Object.entries(raw.byAnchor)) {
    const anchor = byId.get(anchorId);
    check(anchor && anchor.category === 'опорная', `Рекомендация для неизвестной опорной ${anchorId}`);
    check(rec && (rec.type === 'regular' || rec.type === 'standalone'), `Рекомендация ${anchorId}: тип`);
    check(Array.isArray(rec.additional) && rec.additional.every((id) => byId.get(id)?.addable),
      `Рекомендация ${anchorId}: неизвестная площадка в составе`);
    result.set(anchorId, { type: rec.type, additional: [...rec.additional] });
  }
  return result;
}

/** @returns {Promise<Dataset>} */
export async function loadDataset() {
  const [sitesRaw, recRaw] = await Promise.all([fetchJson('data/sites.json'), fetchJson('data/recommended.json')]);
  check(sitesRaw && Array.isArray(sitesRaw.sites), 'sites.json: нет списка площадок');
  const sites = sitesRaw.sites.map(checkSite);
  const byId = new Map(sites.map((s) => [s.id, s]));
  check(byId.size === sites.length, 'sites.json: повторяющиеся ID');

  const recommended = checkRecommended(recRaw, byId);
  const assignedTo = new Map();
  for (const [anchorId, rec] of recommended) rec.additional.forEach((id) => assignedTo.set(id, anchorId));
  check(Number.isInteger(recRaw.coverage) && Number.isInteger(recRaw.total), 'recommended.json: нет охвата');

  return {
    version: String(sitesRaw.version ?? ''),
    sites, byId, recommended, assignedTo,
    coverage: recRaw.coverage, total: recRaw.total,
  };
}
