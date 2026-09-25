// @ts-check
// Скоринговая карта: отрисовка и события. Поведение и структура — как у исходной
// krt_map_updated.html; DOM строится без innerHTML, обработчики — через addEventListener.

import { el, renderInto } from '../ui/dom.js';
import { ScoringDataError, loadScoringData } from './data.js';
import { downloadKrtRankingExcel } from './excel.js';
import {
  COMBINED_LAYER_KEYS, COMBINED_PROFILE, KRT_DYNAMIC_STATUS_COLORS, KRT_PROFILE,
  buildCombinedGeoJSON, calcCombinedIntegral, calcProfileIntegral, calculateKrtRanking, clampWeight,
  createWeights, formatKrtValue, formatScore, scoreFillOpacity, valToRgb,
} from './model.js';

/** @typedef {import('./model.js').Profiles} Profiles */
/** @typedef {import('./model.js').Feature} Feature */
/** @typedef {import('./model.js').Layer} Layer */

const L = /** @type {any} */ (window).L;
const COMBINED_LABEL = 'Общий';
const KRT_LABEL = 'КРТ Площадки';
const DEFAULT_VIEW = /** @type {[number, number]} */ ([52.01047683440441, 113.15491749455917]);
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAPBOX_ATTRIBUTION = '© <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> '
  + '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const KRT_STATUS_ORDER = ['Нужно пересмотреть конфигурацию', 'Нужны стимулы', 'Нейтральный статус', 'Безусловный приоритет'];

/** @param {string} id */
const node = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

// ── Состояние ───────────────────────────────────────────────────────────────
/** @type {Profiles} */
let PROFILES = {};
/** @type {{ type: 'FeatureCollection', features: Feature[] }} */
let KRT_PLOTS = { type: 'FeatureCollection', features: [] };
const weights = createWeights();
let activeProfile = 'investor';
let lastCityProfile = activeProfile;
/** @type {{ type: 'FeatureCollection', features: Feature[] }} */
let GEOJSON = { type: 'FeatureCollection', features: [] };
/** @type {Layer[]} */
let LAYERS = [];
/** @type {{ type: 'FeatureCollection', features: Feature[] }} */
let COMBINED_GEOJSON = { type: 'FeatureCollection', features: [] };
let activeKey = '_integral';
/** @type {any} */
let hexLayer = null;
/** @type {any} */
let krtLayer = null;
/** @type {any} */
let map = null;
/** @type {Record<string, any>} */
let TILE_LAYERS = {};
let activeBasemap = 'osm';

const hasCombinedProfile = () => Boolean(PROFILES.city && PROFILES.investor);
const isCombinedView = () => activeProfile === COMBINED_PROFILE || activeProfile === KRT_PROFILE;

/** @param {string} key */
function profileLabel(key) {
  if (key === COMBINED_PROFILE) return COMBINED_LABEL;
  if (key === KRT_PROFILE) return KRT_LABEL;
  return (PROFILES[key] || {}).label || key;
}

function orderedProfileKeys() {
  /** @type {Record<string, number>} */
  const priority = { city: 0, investor: 1, combined: 2 };
  const keys = Object.keys(PROFILES).filter((key) => key !== COMBINED_PROFILE);
  if (hasCombinedProfile()) keys.push(COMBINED_PROFILE);
  return keys.sort((a, b) => {
    const pa = priority[a] ?? 10;
    const pb = priority[b] ?? 10;
    if (pa !== pb) return pa - pb;
    return String(profileLabel(a)).localeCompare(String(profileLabel(b)), 'ru');
  });
}

// ── Расчёты (формулы — в model.js) ──────────────────────────────────────────
/** @param {string} profileKey */
const calcProfile = (profileKey) => calcProfileIntegral(PROFILES, profileKey, weights);

function calcCombined() {
  if (!hasCombinedProfile()) return;
  const cityFeatures = PROFILES.city.geojson.features;
  if (!(COMBINED_GEOJSON.features.length === cityFeatures.length && cityFeatures.length > 0)) {
    COMBINED_GEOJSON = buildCombinedGeoJSON(cityFeatures);
  }
  calcCombinedIntegral(PROFILES, COMBINED_GEOJSON, weights);
}

const ranking = () => calculateKrtRanking(KRT_PLOTS, PROFILES, weights);

// ── Вкладки ─────────────────────────────────────────────────────────────────
function renderScopeTabs() {
  const krtActive = activeProfile === KRT_PROFILE;
  const tab = (/** @type {string} */ scope, /** @type {string} */ label, /** @type {boolean} */ active) => el('button', {
    className: `scope-tab${active ? ' active' : ''}`, attrs: { type: 'button', 'data-scope': scope },
    on: { click: () => selectScope(scope) },
  }, label);
  renderInto(node('scope-tabs'), [tab('city', 'Весь город', !krtActive), tab('krt', 'Площадки КРТ', krtActive)]);
}

function renderProfileTabs() {
  const holder = node('profile-tabs');
  if (activeProfile === KRT_PROFILE) {
    holder.style.display = 'none';
    renderInto(holder, []);
    return;
  }
  holder.style.display = 'flex';
  renderInto(holder, orderedProfileKeys().map((key) => el('button', {
    className: `profile-tab${key === activeProfile ? ' active' : ''}`,
    attrs: { type: 'button', 'data-profile': key },
    on: { click: () => selectProfile(key) },
  }, profileLabel(key))));
}

/** @param {string} scope */
function selectScope(scope) {
  if (scope === 'krt') {
    selectProfile(KRT_PROFILE);
    return;
  }
  const available = orderedProfileKeys();
  const target = available.indexOf(lastCityProfile) >= 0
    ? lastCityProfile
    : (available.indexOf(COMBINED_PROFILE) >= 0 ? COMBINED_PROFILE : available[0]);
  selectProfile(target);
}

// ── Легенда ─────────────────────────────────────────────────────────────────
function krtStatusLegend() {
  return el('div', { className: 'krt-status-legend' },
    el('div', { className: 'krt-status-title' }, 'Статус площадки'),
    KRT_STATUS_ORDER.map((label) => el('div', { className: 'krt-status-row' },
      el('span', { className: 'krt-status-swatch', style: { background: KRT_DYNAMIC_STATUS_COLORS[label] } }),
      el('span', {}, label))));
}

function renderLegendPanel() {
  const isKrt = activeProfile === KRT_PROFILE;
  node('score-legend').style.display = isKrt ? 'none' : 'block';
  const krtLegend = node('krt-legend');
  krtLegend.hidden = !isKrt;
  renderInto(krtLegend, isKrt ? [krtStatusLegend()] : []);
}

// ── Панель слоёв и веса ─────────────────────────────────────────────────────
/** @param {Layer} layer */
function directionChip(layer) {
  const direction = layer && layer.direction;
  if (direction !== 'direct' && direction !== 'inverse') return null;
  const label = layer.direction_label || (direction === 'inverse' ? 'Обратная' : 'Прямая');
  return el('span', { className: `scale-chip ${direction}` }, label);
}

/**
 * Строка слоя: радиокнопка, подпись, при наличии — вес с кнопками ±.
 * @param {{ key: string, label: string, checked?: boolean, integral?: boolean, chip?: Node | null,
 *           note?: string, weight?: { value: number, attrs: Record<string, string> } }} p
 */
function layerItem({ key, label, checked = false, integral = false, chip = null, note, weight }) {
  return el('div', { className: `layer-item${checked ? ' active' : ''}`, attrs: { id: `item-${key}` } },
    el('div', { className: 'layer-item-header' },
      el('input', {
        attrs: { type: 'radio', name: 'active-layer', value: key, id: `radio-${key}`, checked, 'data-key': `radio-${key}` },
        on: { change: () => selectLayer(key) },
      }),
      el('label', { className: `layer-label${integral ? ' layer-label--integral' : ''}`, attrs: { for: `radio-${key}` } },
        el('span', { className: 'layer-label-text' }, label), chip)),
    note && el('div', { className: 'integral-chip' }, note),
    weight && el('div', { className: 'weight-row' },
      el('span', { className: 'weight-label' }, 'Вес (1–10):'),
      el('button', { className: 'weight-step', attrs: { type: 'button', 'data-delta': '-1', 'aria-label': 'Уменьшить вес' } }, '−'),
      el('input', {
        className: 'weight-input',
        attrs: { type: 'number', min: '1', max: '10', step: '1', value: weight.value, 'aria-label': `Вес: ${label}`, ...weight.attrs },
      }),
      el('button', { className: 'weight-step', attrs: { type: 'button', 'data-delta': '1', 'aria-label': 'Увеличить вес' } }, '+')));
}

function standardLayers() {
  return [
    layerItem({ key: '_integral', label: 'Интегральный слой', checked: true, integral: true,
      note: 'Σ(балл × вес) / Σвес → нормировка 0–10' }),
    ...LAYERS.map((layer) => layerItem({
      key: String(layer.key), label: layer.label || String(layer.key), chip: directionChip(layer),
      weight: {
        value: weights.criterion(activeProfile, String(layer.key)),
        attrs: { id: `weight-${layer.key}`, 'data-weight-scope': 'criterion', 'data-profile-key': activeProfile,
          'data-layer-key': String(layer.key), 'data-key': `weight-${layer.key}` },
      },
    })),
  ];
}

function combinedLayers() {
  const items = [layerItem({ key: COMBINED_LAYER_KEYS.result, label: 'Результирующий интегральный слой',
    checked: true, integral: true, note: 'взвешенное среднее → min–max 0–10' })];
  if (activeProfile !== KRT_PROFILE) {
    for (const [source, layerKey, label] of /** @type {const} */ ([
      ['city', COMBINED_LAYER_KEYS.city, 'Интегральный слой города'],
      ['investor', COMBINED_LAYER_KEYS.investor, 'Интегральный слой инвестора'],
    ])) {
      items.push(layerItem({
        key: layerKey, label,
        weight: {
          value: weights.combined(source),
          attrs: { id: `combined-weight-${source}`, 'data-weight-scope': 'combined', 'data-layer-key': source,
            'data-key': `combined-weight-${source}` },
        },
      }));
    }
  }
  return items;
}

function renderLayersPanel() {
  const holder = node('layers-scroll');
  renderInto(holder, isCombinedView() ? combinedLayers() : standardLayers());
  holder.querySelectorAll('.weight-input').forEach((input) => {
    input.addEventListener('input', onWeightChange);
    input.addEventListener('change', onWeightChange);
  });
  holder.querySelectorAll('.weight-step').forEach((button) => {
    button.addEventListener('click', () => {
      const input = /** @type {HTMLInputElement | null} */ (button.parentElement?.querySelector('.weight-input') ?? null);
      if (!input) return;
      input.value = String(clampWeight(Number(input.value) + Number(/** @type {HTMLElement} */ (button).dataset.delta || 0)));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
}

/** @param {Event} event */
function onWeightChange(event) {
  const input = /** @type {HTMLInputElement} */ (event.currentTarget);
  const { weightScope: scope, layerKey: key = '' } = input.dataset;
  const weight = clampWeight(input.value);
  input.value = String(weight);

  if (scope === 'combined') {
    weights.set(COMBINED_PROFILE, key, weight);
  } else {
    const profileKey = input.dataset.profileKey || activeProfile;
    weights.set(profileKey, key, weight);
    calcProfile(profileKey);
  }
  calcCombined();
  ranking();
  refreshKrtLayerStyles();
  repaint();
}

// ── Профиль и слой ──────────────────────────────────────────────────────────
/** @param {string} key */
function activateProfileData(key) {
  if (key === COMBINED_PROFILE || key === KRT_PROFILE) {
    if (!hasCombinedProfile()) return false;
    calcProfile('city');
    calcProfile('investor');
    calcCombined();
    activeProfile = key;
    GEOJSON = COMBINED_GEOJSON;
    LAYERS = [];
    activeKey = COMBINED_LAYER_KEYS.result;
    return true;
  }
  const profile = PROFILES[key];
  if (!profile) return false;
  activeProfile = key;
  GEOJSON = profile.geojson;
  LAYERS = profile.layers;
  calcProfile(key);
  activeKey = '_integral';
  return true;
}

/** @param {string} key */
function selectLayer(key) {
  activeKey = key;
  document.querySelectorAll('.layer-item').forEach((item) => item.classList.remove('active'));
  document.getElementById(`item-${key}`)?.classList.add('active');
  const radio = /** @type {HTMLInputElement | null} */ (document.getElementById(`radio-${key}`));
  if (radio) radio.checked = true;
  repaint();
}

/** @param {string} key */
function selectProfile(key) {
  if (!activateProfileData(key)) return;
  if (key !== KRT_PROFILE) lastCityProfile = key;
  if (key === KRT_PROFILE) ranking();
  syncKrtMode();
  renderScopeTabs();
  renderProfileTabs();
  renderLegendPanel();
  renderLayersPanel();
  initHexLayer();
  refreshKrtLayerStyles();
  fitToBounds();
}

function syncKrtMode() {
  const krt = activeProfile === KRT_PROFILE;
  map.getPane('krtPane').style.pointerEvents = krt ? 'auto' : 'none';
  node('krt-export-top').style.display = krt ? 'block' : 'none';
}

// ── Подсказки ───────────────────────────────────────────────────────────────
/** @param {string} dim @param {Node | string} value @param {string} [valueClass] @param {string} [rowClass] */
const ttRow = (dim, value, valueClass = 'tt-val', rowClass = '') => el('div', { className: `tt-row${rowClass}` },
  el('span', { className: 'tt-dim' }, dim), el('span', { className: valueClass }, value));
/** @param {string} text @param {number} weight */
const weighted = (text, weight) => [text, el('span', { className: 'tt-dim' }, ` ×${weight}`)];
/** @param {number | null | undefined} v @param {number} digits @param {string} empty */
const fixed = (v, digits, empty) => (v != null ? v.toFixed(digits) : empty);

/** @param {Feature} feature */
function buildTooltip(feature) {
  const p = feature.properties;
  const idv = p.hex_id != null ? p.hex_id : (p.id != null ? p.id : '-');
  const box = el('div', {}, el('div', { className: 'tt-title' }, `Ячейка ${idv}`));

  if (isCombinedView()) {
    const cityValue = p[COMBINED_LAYER_KEYS.city];
    const investorValue = p[COMBINED_LAYER_KEYS.investor];
    if (activeKey === COMBINED_LAYER_KEYS.result) {
      box.append(
        el('div', { className: 'tt-integral' }, `Общий нормализованный балл: ${fixed(p[COMBINED_LAYER_KEYS.result], 2, 'нет данных')}`),
        ttRow('До нормировки', fixed(p._combined_integral_raw, 3, '—')),
        el('div', { className: 'tt-block tt-block--hex' },
          el('div', { className: 'tt-row' }, el('span', { className: 'tt-dim' }, 'Интеграл города'),
            el('span', { className: 'tt-val' }, ...weighted(fixed(cityValue, 2, '—'), weights.combined('city')))),
          el('div', { className: 'tt-row' }, el('span', { className: 'tt-dim' }, 'Интеграл инвестора'),
            el('span', { className: 'tt-val' }, ...weighted(fixed(investorValue, 2, '—'), weights.combined('investor'))))));
    } else {
      const isCity = activeKey === COMBINED_LAYER_KEYS.city;
      box.append(ttRow(isCity ? 'Интегральный слой города' : 'Интегральный слой инвестора',
        fixed(isCity ? cityValue : investorValue, 2, 'нет данных')));
    }
    return box;
  }

  if (activeKey === '_integral') {
    box.append(
      el('div', { className: 'tt-integral' }, `Интеграл: ${fixed(p._integral, 2, 'нет данных')}`),
      el('div', { className: 'tt-block tt-block--hex' }, LAYERS.map((layer) => el('div', { className: 'tt-row' },
        el('span', { className: 'tt-dim' }, layer.label),
        el('span', { className: 'tt-val tt-score' },
          ...weighted(p[layer.key] != null ? formatScore(p[layer.key]) : '—', weights.criterion(activeProfile, layer.key)))))));
  } else {
    const layer = LAYERS.find((l) => l.key === activeKey);
    const v = p[activeKey];
    box.append(ttRow(layer ? layer.label : activeKey, v != null ? formatScore(v) : 'нет данных', 'tt-val tt-score'));
  }
  return box;
}

/** @param {Feature} feature */
function buildKrtTooltip(feature) {
  const p = feature.properties || {};
  const rows = ranking();
  const row = rows.find((r) => String(r.plot_number) === String(p.plot_number || ''));
  const rankText = row && row.rank != null ? `${row.rank} из ${rows.length}` : '—';
  return el('div', {},
    el('div', { className: 'tt-title' }, `Площадка № ${p.plot_number || '—'}`),
    el('div', { className: 'tt-name' }, p.name || '—'),
    ttRow('Градостроительная политика', p.status || '—'),
    ttRow('Площадь', `${formatKrtValue(p.area_ha, 1)} га`),
    ttRow('Градпотенциал', `${formatKrtValue(p.potential_thsqm, 1)} тыс. м²`),
    el('div', { className: 'tt-block' },
      ttRow('Интегральный балл города', formatKrtValue(row ? row.city_score : null, 1), 'tt-integral'),
      ttRow('Интегральный балл инвестора', formatKrtValue(row ? row.investor_score : null, 1), 'tt-integral'),
      ttRow('Итоговый балл площадки', formatKrtValue(row ? row.combined_score : null, 1), 'tt-integral'),
      ttRow('Место в рейтинге', rankText, 'tt-integral', ' tt-row--rank')));
}

// ── Слои карты ──────────────────────────────────────────────────────────────
/** @param {Feature} feature */
function featureStyle(feature) {
  const value = feature.properties[activeKey];
  const outsideKrt = activeProfile === KRT_PROFILE && !feature.properties._in_krt;
  return {
    fillColor: valToRgb(value),
    fillOpacity: outsideKrt ? 0.20 : scoreFillOpacity(value, false),
    weight: 0.35,
    color: '#1f2937',
    opacity: activeProfile === KRT_PROFILE ? 0.15 : 1,
  };
}

function initHexLayer() {
  if (hexLayer) map.removeLayer(hexLayer);
  hexLayer = L.geoJSON(GEOJSON, {
    renderer: L.canvas({ padding: 0.1 }),
    style: featureStyle,
    onEachFeature: (/** @type {Feature} */ feature, /** @type {any} */ layer) => {
      layer.bindTooltip('', { sticky: true, opacity: 1.0 });
      layer.on('mouseover', function onOver() {
        const outsideKrt = activeProfile === KRT_PROFILE && !feature.properties._in_krt;
        layer.setTooltipContent(buildTooltip(feature));
        layer.setStyle({
          weight: 1.5, color: '#f1f5f9',
          fillOpacity: outsideKrt ? 0.28 : scoreFillOpacity(feature.properties[activeKey], true),
        });
        layer.bringToFront();
      });
      layer.on('mouseout', () => { if (hexLayer) hexLayer.resetStyle(layer); });
    },
  }).addTo(map);
}

const repaint = () => { if (hexLayer) hexLayer.setStyle(featureStyle); };

/** @param {Feature} feature */
function krtPlotStyle(feature) {
  const statusColor = feature && feature.properties ? feature.properties.status_color : null;
  const krt = activeProfile === KRT_PROFILE;
  return { color: '#000000', weight: 2, opacity: 1, fill: krt, fillColor: statusColor || '#000000', fillOpacity: krt ? 1 : 0 };
}

function refreshKrtLayerStyles() {
  if (!krtLayer) return;
  /** @type {Record<string, Record<string, any>>} */
  const byPlot = {};
  KRT_PLOTS.features.forEach((f) => { byPlot[String((f.properties || {}).plot_number || '')] = f.properties; });
  krtLayer.eachLayer((/** @type {any} */ layer) => {
    const feature = layer.feature || {};
    const properties = feature.properties || {};
    const current = byPlot[String(properties.plot_number || '')];
    if (current && current !== properties) {
      for (const key of ['city_score', 'investor_score', 'combined_score', 'rank', 'city_tertile', 'investor_tertile', 'status', 'status_color']) {
        properties[key] = current[key];
      }
    }
    layer.setStyle(krtPlotStyle(feature));
  });
}

function initKrtLayer() {
  map.createPane('krtPane');
  map.getPane('krtPane').style.zIndex = 450;
  map.getPane('krtPane').style.pointerEvents = 'none';
  krtLayer = L.geoJSON(KRT_PLOTS, {
    renderer: L.canvas({ pane: 'krtPane', padding: 0.1 }),
    pane: 'krtPane',
    style: krtPlotStyle,
    onEachFeature: (/** @type {Feature} */ feature, /** @type {any} */ layer) => {
      layer.bindTooltip('', { sticky: true, opacity: 1.0, direction: 'auto' });
      layer.on('mouseover', () => {
        if (activeProfile !== KRT_PROFILE) return;
        layer.setTooltipContent(buildKrtTooltip(feature));
        layer.openTooltip();
      });
      layer.on('mouseout', () => layer.closeTooltip());
    },
  }).addTo(map);
}

function fitToBounds() {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  GEOJSON.features.forEach((f) => {
    if (!f.geometry || !f.geometry.coordinates || !f.geometry.coordinates[0]) return;
    f.geometry.coordinates[0].forEach((/** @type {number[]} */ pt) => {
      const [lon, lat] = pt;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    });
  });
  if (minLat < maxLat) map.fitBounds([[minLat, minLon], [maxLat, maxLon]], { padding: [24, 24] });
  else map.setView(DEFAULT_VIEW, 12);
}

// ── Подложка ────────────────────────────────────────────────────────────────
/** @param {string | null} mapboxTilesUrl */
function initBasemaps(mapboxTilesUrl) {
  TILE_LAYERS = { osm: L.tileLayer(OSM_URL, { attribution: OSM_ATTRIBUTION, maxZoom: 19 }) };
  if (mapboxTilesUrl) {
    TILE_LAYERS.mapbox = L.tileLayer(mapboxTilesUrl, { attribution: MAPBOX_ATTRIBUTION, maxZoom: 20, tileSize: 256 });
  }
  activeBasemap = mapboxTilesUrl ? 'mapbox' : 'osm';
  TILE_LAYERS[activeBasemap].addTo(map);
  const mapboxButton = /** @type {HTMLButtonElement} */ (node('bm-mapbox'));
  if (!mapboxTilesUrl) {
    mapboxButton.disabled = true;
    mapboxButton.title = 'Задайте MAPBOX_TOKEN перед сборкой данных';
  }
  document.querySelectorAll('.bm-btn').forEach((button) => {
    button.addEventListener('click', () => setBasemap(/** @type {HTMLElement} */ (button).dataset.basemap || 'osm'));
  });
  markBasemap();
}

/** @param {string} key */
function setBasemap(key) {
  if (!TILE_LAYERS[key]) return;
  map.removeLayer(TILE_LAYERS[activeBasemap]);
  activeBasemap = key;
  TILE_LAYERS[key].addTo(map);
  markBasemap();
}

function markBasemap() {
  document.querySelectorAll('.bm-btn').forEach((b) => b.classList.remove('active'));
  node(`bm-${activeBasemap}`).classList.add('active');
}

// ── Запуск ──────────────────────────────────────────────────────────────────
/** @param {string} message */
function showError(message) {
  document.querySelector('.scoring-stage')?.append(
    el('div', { className: 'map-error', attrs: { role: 'alert' } }, el('div', {}, message)));
}

async function start() {
  if (!L) {
    showError('Не удалось загрузить картографическую библиотеку. Обновите страницу.');
    return;
  }
  let data;
  try {
    data = await loadScoringData();
  } catch (error) {
    const details = error instanceof ScoringDataError ? error.message : 'сервер недоступен или вернул некорректный ответ';
    showError(`Не удалось загрузить данные скоринга. Обновите страницу; если ошибка повторится, сообщите команде проекта. Подробности: ${details}.`);
    return;
  }
  PROFILES = data.profiles;
  KRT_PLOTS = data.plots;

  map = L.map('map', { zoomControl: false, preferCanvas: true });
  L.control.zoom({ position: 'topright' }).addTo(map);
  map.attributionControl.setPrefix(false);
  initBasemaps(data.mapConfig.mapboxTilesUrl);
  initKrtLayer();
  node('krt-export-top').addEventListener('click', () => downloadKrtRankingExcel(ranking()));

  if (((activeProfile === COMBINED_PROFILE || activeProfile === KRT_PROFILE) && !hasCombinedProfile())
      || (!isCombinedView() && !PROFILES[activeProfile])) {
    activeProfile = orderedProfileKeys()[0];
  }
  activateProfileData(activeProfile);
  syncKrtMode();
  renderScopeTabs();
  renderProfileTabs();
  renderLegendPanel();
  renderLayersPanel();
  initHexLayer();
  fitToBounds();
  // Страховка: пересчёт размера карты после отрисовки DOM
  setTimeout(() => map.invalidateSize(), 200);
}

start();
