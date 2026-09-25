// @ts-check
// Загрузка данных скоринга. Всё, что пришло по сети, проверяется до использования.
// Из компактного формата (общая геометрия, баллы столбцами) собирается та же
// структура профилей, что была вшита в исходную карту.

/** @typedef {import('./model.js').Profiles} Profiles */
/** @typedef {import('./model.js').Feature} Feature */

export class ScoringDataError extends Error {}

const SCORE_KEY = /^crit_\d+_score$/;
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const PLOT_ID = /^\d{1,3}\.\d$/;

/** @param {unknown} ok @param {string} message @returns {asserts ok} */
function check(ok, message) {
  if (!ok) throw new ScoringDataError(message);
}

const isCoord = (/** @type {unknown} */ p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const isRing = (/** @type {unknown} */ r) => Array.isArray(r) && r.length >= 4 && r.every(isCoord);
const isScore = (/** @type {unknown} */ v) => v === null || (typeof v === 'number' && Number.isFinite(v));

/** @param {any} hexes */
function checkHexes(hexes) {
  check(hexes && Array.isArray(hexes.hexId) && Array.isArray(hexes.inKrt) && Array.isArray(hexes.rings), 'hexes.json: нет полей');
  const n = hexes.hexId.length;
  check(n > 0 && hexes.inKrt.length === n && hexes.rings.length === n, 'hexes.json: разная длина столбцов');
  check(hexes.hexId.every(Number.isInteger), 'hexes.json: hex_id не целые');
  check(hexes.inKrt.every((/** @type {unknown} */ v) => typeof v === 'boolean'), 'hexes.json: inKrt не логический');
  check(hexes.rings.every(isRing), 'hexes.json: некорректная геометрия');
  return n;
}

/** @param {string} key @param {any} profile @param {number} n */
function checkProfile(key, profile, n) {
  check(profile && typeof profile.label === 'string' && Array.isArray(profile.layers), `профиль ${key}: нет подписи или слоёв`);
  for (const layer of profile.layers) {
    check(SCORE_KEY.test(layer.key) && typeof layer.label === 'string', `профиль ${key}: некорректный слой`);
    check(['direct', 'inverse'].includes(layer.direction), `профиль ${key}: направление ${layer.key}`);
    const col = profile.scores?.[layer.key];
    check(Array.isArray(col) && col.length === n && col.every(isScore), `профиль ${key}: столбец ${layer.key}`);
  }
}

/** @param {any} plots @param {Set<string>} layerKeys */
function checkPlots(plots, layerKeys) {
  check(plots && Array.isArray(plots.features) && plots.features.length > 0, 'plots.json: нет площадок');
  for (const f of plots.features) {
    const p = f.properties || {};
    check(PLOT_ID.test(p.plot_number), 'plots.json: номер площадки');
    check(typeof p.name === 'string' && COLOR.test(p.status_color), `площадка ${p.plot_number}: название или цвет`);
    check(['Polygon', 'MultiPolygon'].includes(f.geometry?.type), `площадка ${p.plot_number}: геометрия`);
    for (const group of ['criteria_city', 'criteria_investor']) {
      const criteria = p[group] || {};
      check(Object.entries(criteria).every(([k, v]) => layerKeys.has(k) && isScore(v)), `площадка ${p.plot_number}: ${group}`);
    }
  }
}

/**
 * Профили в формате исходной карты: у каждого свои свойства гексов, геометрия общая.
 * @param {any} hexes @param {any} store @returns {Profiles}
 */
export function assembleProfiles(hexes, store) {
  const n = checkHexes(hexes);
  check(store && store.profiles && store.profiles.city && store.profiles.investor, 'profiles.json: нужны профили city и investor');
  const geometries = hexes.rings.map((/** @type {number[][]} */ ring) => ({ type: 'Polygon', coordinates: [ring] }));
  /** @type {Profiles} */
  const profiles = {};
  for (const [key, profile] of Object.entries(store.profiles)) {
    checkProfile(key, profile, n);
    const layers = /** @type {any} */ (profile).layers;
    const scores = /** @type {any} */ (profile).scores;
    const features = hexes.hexId.map((/** @type {number} */ hexId, /** @type {number} */ i) => {
      /** @type {Record<string, any>} */
      const properties = { hex_id: hexId, _in_krt: hexes.inKrt[i] };
      for (const layer of layers) properties[layer.key] = scores[layer.key][i];
      return /** @type {Feature} */ ({ type: 'Feature', id: i, geometry: geometries[i], properties });
    });
    profiles[key] = {
      label: /** @type {any} */ (profile).label,
      sheet_name: /** @type {any} */ (profile).sheet_name,
      layers: layers.map((/** @type {any} */ l) => ({ key: l.key, label: l.label, direction: l.direction, direction_label: l.direction_label })),
      geojson: { type: 'FeatureCollection', features },
    };
  }
  return profiles;
}

/** @param {any} plots @param {Profiles} profiles */
export function checkedPlots(plots, profiles) {
  const layerKeys = new Set(Object.values(profiles).flatMap((p) => p.layers.map((l) => l.key)));
  checkPlots(plots, layerKeys);
  return /** @type {{ type: 'FeatureCollection', features: Feature[] }} */ (plots);
}

/** @param {string} path */
async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-cache', credentials: 'same-origin' });
  check(response.ok, `Не удалось загрузить ${path}: HTTP ${response.status}`);
  return response.json();
}

/** Подложки: токен Mapbox подставляется при сборке и может отсутствовать. */
function checkMapConfig(/** @type {any} */ config) {
  check(config && typeof config === 'object', 'map-config.json: некорректный формат');
  const url = config.mapboxTilesUrl;
  check(url === null || (typeof url === 'string' && url.startsWith('https://api.mapbox.com/')), 'map-config.json: адрес Mapbox');
  return { mapboxTilesUrl: /** @type {string | null} */ (url) };
}

export async function loadScoringData() {
  const [hexes, store, plots, config] = await Promise.all([
    fetchJson('data/scoring/hexes.json'), fetchJson('data/scoring/profiles.json'),
    fetchJson('data/scoring/plots.json'), fetchJson('data/scoring/map-config.json'),
  ]);
  const profiles = assembleProfiles(hexes, store);
  return {
    version: String(store.version ?? ''),
    profiles, plots: checkedPlots(plots, profiles), mapConfig: checkMapConfig(config),
  };
}
