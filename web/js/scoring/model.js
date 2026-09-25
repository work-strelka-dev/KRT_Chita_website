// @ts-check
// Алгоритмы скоринговой карты: перенесены из generate_map.py (шаблон итоговой карты
// krt_map_updated.html) без изменения формул, порядка операций и округлений.
// Эталон — tests/scoring_golden.json, снятый с исходной страницы.

/**
 * @typedef {{ key: string, label: string, direction?: string, direction_label?: string }} Layer
 * @typedef {{ type: 'Feature', id?: number, geometry: any, properties: Record<string, any> }} Feature
 * @typedef {{ label: string, sheet_name: string, layers: Layer[], geojson: { type: 'FeatureCollection', features: Feature[] } }} Profile
 * @typedef {Record<string, Profile>} Profiles
 */

export const COMBINED_PROFILE = 'combined';
export const KRT_PROFILE = 'krt';
export const COMBINED_LAYER_KEYS = { result: '_combined_integral', city: '_city_integral', investor: '_investor_integral' };
export const DEFAULT_WEIGHT = 5;
export const DEFAULT_COMBINED_WEIGHTS = { investor: 6, city: 4 };

// ── Цветовая шкала ──────────────────────────────────────────────────────────
export const COLOR_STOPS = /** @type {[number, [number, number, number]][]} */ ([
  [0, [44, 66, 149]],          // #2C4295
  [1.1111, [98, 99, 157]],     // #62639D
  [2.2222, [152, 137, 161]],   // #9889A1
  [3.3333, [204, 178, 159]],   // #CCB29F
  [4.4444, [255, 221, 148]],   // #FFDD94
  [5.5556, [254, 199, 0]],     // #FEC700
  [6.6667, [215, 195, 61]],    // #D7C33D
  [7.7778, [166, 188, 106]],   // #A6BC6A
  [8.8889, [98, 179, 140]],    // #62B38C
  [10, [0, 167, 167]],         // #00A7A7
]);

/** @param {number | null | undefined} val */
export function valToRgb(val) {
  if (val == null || isNaN(val)) return 'rgba(75,85,99,0.55)';
  const v = Math.max(0, Math.min(10, val));
  let i = 0;
  while (i < COLOR_STOPS.length - 2 && v > COLOR_STOPS[i + 1][0]) i++;
  const [v0, c0] = COLOR_STOPS[i];
  const [v1, c1] = COLOR_STOPS[i + 1];
  const t = (v - v0) / (v1 - v0);
  const lerp = (/** @type {number} */ a, /** @type {number} */ b) => Math.round(a + t * (b - a));
  return 'rgb(' + lerp(c0[0], c1[0]) + ',' + lerp(c0[1], c1[1]) + ',' + lerp(c0[2], c1[2]) + ')';
}

/** Нулевой балл — валидное значение: контур остаётся, заливки нет. @param {any} val @param {boolean} highlighted */
export function scoreFillOpacity(val, highlighted) {
  if (val != null && !isNaN(val) && Number(val) === 0) return 0;
  return highlighted ? 0.92 : 0.78;
}

// ── Веса ────────────────────────────────────────────────────────────────────
/** @param {any} value */
export function clampWeight(value) {
  const v = parseFloat(value);
  return (isNaN(v) || v < 1) ? 1 : v > 10 ? 10 : v;
}

/** Веса живут только в памяти страницы, как в исходной карте. */
export function createWeights() {
  /** @type {Record<string, Record<string, number>>} */
  const store = {};
  const profile = (/** @type {string} */ key) => (store[key] ??= {});
  return {
    profile,
    /** @param {string} profileKey @param {string} key */
    criterion(profileKey, key) {
      const weights = profile(profileKey);
      if (weights[key] == null) weights[key] = DEFAULT_WEIGHT;
      return weights[key];
    },
    /** @param {'city' | 'investor'} sourceKey */
    combined(sourceKey) {
      const weights = profile(COMBINED_PROFILE);
      if (weights[sourceKey] == null) weights[sourceKey] = DEFAULT_COMBINED_WEIGHTS[sourceKey];
      return weights[sourceKey];
    },
    /** @param {string} profileKey @param {string} key @param {number} value */
    set(profileKey, key, value) { profile(profileKey)[key] = value; },
  };
}
/** @typedef {ReturnType<typeof createWeights>} Weights */

// ── Интегральные баллы ──────────────────────────────────────────────────────
/** min–max в 0–10 с округлением до 3 знаков; при min = max все валидные — 0. @param {(number | null)[]} values */
export function normalizeRelative(values) {
  const valid = values.filter((v) => v != null && !isNaN(v));
  if (valid.length === 0) return values.map(() => null);
  const lo = Math.min.apply(null, /** @type {number[]} */ (valid));
  const hi = Math.max.apply(null, /** @type {number[]} */ (valid));
  if (hi === lo) return values.map((v) => ((v == null || isNaN(v)) ? null : 0));
  return values.map((v) => {
    if (v == null || isNaN(v)) return null;
    return parseFloat((((v - lo) / (hi - lo)) * 10.0).toFixed(3));
  });
}

/**
 * Интеграл профиля: Σ(балл × вес) / Σвес по непустым критериям → min–max 0–10.
 * Пишет _integral_raw и _integral в свойства гексов.
 * @param {Profiles} profiles @param {string} profileKey @param {Weights} weights
 */
export function calcProfileIntegral(profiles, profileKey, weights) {
  const profile = profiles[profileKey];
  if (!profile) return;
  const features = profile.geojson.features;
  const rawValues = features.map((f) => {
    let num = 0, den = 0;
    profile.layers.forEach((layer) => {
      const s = f.properties[layer.key];
      if (s != null && !isNaN(s)) {
        const w = weights.criterion(profileKey, layer.key);
        num += s * w;
        den += w;
      }
    });
    return den > 0 ? parseFloat((num / den).toFixed(3)) : null;
  });
  const normalized = normalizeRelative(rawValues);
  features.forEach((f, idx) => {
    f.properties._integral_raw = rawValues[idx];
    f.properties._integral = normalized[idx];
  });
}

/** @param {Feature} feature @param {number} index */
export function featureIdentity(feature, index) {
  const props = feature && feature.properties ? feature.properties : {};
  if (props.hex_id != null) return 'hex:' + props.hex_id;
  if (feature && feature.id != null) return 'id:' + feature.id;
  return 'idx:' + index;
}

/** Виртуальный слой «Общий» на геометрии города. @param {Feature[]} cityFeatures */
export function buildCombinedGeoJSON(cityFeatures) {
  return {
    type: /** @type {const} */ ('FeatureCollection'),
    features: cityFeatures.map((feature, index) => {
      const props = feature.properties || {};
      return {
        type: /** @type {const} */ ('Feature'),
        id: feature.id,
        geometry: feature.geometry,
        properties: {
          hex_id: props.hex_id != null ? props.hex_id : index,
          _source_identity: featureIdentity(feature, index),
          _city_integral: null, _investor_integral: null,
          _combined_integral_raw: null, _combined_integral: null,
        },
      };
    }),
  };
}

/** @param {Feature[]} features */
function indexFeatures(features) {
  /** @type {Record<string, Feature>} */
  const result = {};
  features.forEach((feature, index) => { result[featureIdentity(feature, index)] = feature; });
  return result;
}

/**
 * Общий слой: взвешенное среднее интегралов города и инвестора → повторная min–max 0–10.
 * Интегралы профилей должны быть посчитаны заранее.
 * @param {Profiles} profiles @param {{ features: Feature[] }} combined @param {Weights} weights
 */
export function calcCombinedIntegral(profiles, combined, weights) {
  const cityFeatures = profiles.city.geojson.features;
  const investorFeatures = profiles.investor.geojson.features;
  const cityById = indexFeatures(cityFeatures);
  const investorById = indexFeatures(investorFeatures);
  const cityWeight = weights.combined('city');
  const investorWeight = weights.combined('investor');

  const rawValues = combined.features.map((feature, index) => {
    const identity = feature.properties._source_identity || featureIdentity(feature, index);
    const allowIndexFallback = identity.indexOf('idx:') === 0;
    const cityFeature = cityById[identity] || (allowIndexFallback ? cityFeatures[index] : null);
    const investorFeature = investorById[identity] || (allowIndexFallback ? investorFeatures[index] : null);
    const cityValue = cityFeature && cityFeature.properties ? cityFeature.properties._integral : null;
    const investorValue = investorFeature && investorFeature.properties ? investorFeature.properties._integral : null;

    let numerator = 0, denominator = 0;
    if (cityValue != null && !isNaN(cityValue)) { numerator += cityValue * cityWeight; denominator += cityWeight; }
    if (investorValue != null && !isNaN(investorValue)) { numerator += investorValue * investorWeight; denominator += investorWeight; }
    const rawCombined = denominator > 0 ? numerator / denominator : null;

    feature.properties._city_integral = cityValue;
    feature.properties._investor_integral = investorValue;
    feature.properties._combined_integral_raw = rawCombined;
    return rawCombined;
  });

  const normalized = normalizeRelative(rawValues);
  combined.features.forEach((feature, index) => { feature.properties._combined_integral = normalized[index]; });
}

// ── Площадки КРТ: рейтинг и динамический статус ─────────────────────────────
export const KRT_DYNAMIC_STATUS_COLORS = /** @type {Record<string, string>} */ ({
  'Нужно пересмотреть конфигурацию': '#2C4295',
  'Нужны стимулы': '#CCB29F',
  'Нейтральный статус': '#FEC700',
  'Безусловный приоритет': '#00A7A7',
});

/** Терциль по доле значений не больше данного. @param {number | null} value @param {(number | null)[]} values */
export function krtTertile(value, values) {
  if (value == null || isNaN(Number(value))) return null;
  const valid = values.filter((item) => item != null && !isNaN(Number(item)));
  if (!valid.length) return null;
  const notGreater = valid.filter((item) => Number(item) <= Number(value) + 1e-9).length;
  const percentile = (notGreater / valid.length) * 100;
  if (percentile >= 200 / 3) return 'Высокая';
  if (percentile < 100 / 3) return 'Низкая';
  return 'Средняя';
}

/** @param {string | null} cityTertile @param {string | null} investorTertile */
export function krtDynamicStatus(cityTertile, investorTertile) {
  if (cityTertile === 'Высокая' && investorTertile === 'Низкая') return 'Нужны стимулы';
  if (cityTertile === 'Высокая' && (investorTertile === 'Высокая' || investorTertile === 'Средняя')) {
    return 'Безусловный приоритет';
  }
  if (cityTertile === 'Средняя' && investorTertile === 'Средняя') return 'Нейтральный статус';
  return 'Нужно пересмотреть конфигурацию';
}

/**
 * Баллы профиля по площадкам: среднее баллов гексов площадки с весами → min–max 0–10.
 * @param {{ features: Feature[] }} plots @param {Profiles} profiles @param {string} profileKey @param {Weights} weights
 */
export function calculateKrtProfileScores(plots, profiles, profileKey, weights) {
  const layers = (profiles[profileKey] || {}).layers || [];
  const raw = plots.features.map((feature) => {
    const criteria = (feature.properties || {})['criteria_' + profileKey] || {};
    let numerator = 0, denominator = 0;
    layers.forEach((layer) => {
      const key = String(layer.key);
      const value = Number(criteria[key]);
      if (criteria[key] == null || isNaN(value)) return;
      const weight = weights.criterion(profileKey, key);
      numerator += value * weight;
      denominator += weight;
    });
    return denominator > 0 ? numerator / denominator : null;
  });
  return normalizeRelative(raw);
}

/**
 * Рейтинг площадок: итог = взвешенное среднее баллов города и инвестора → min–max,
 * место с учётом равенства. Обновляет свойства площадок, как исходная карта.
 * @param {{ features: Feature[] }} plots @param {Profiles} profiles @param {Weights} weights
 */
export function calculateKrtRanking(plots, profiles, weights) {
  const cityWeight = weights.combined('city');
  const investorWeight = weights.combined('investor');
  const cityScores = calculateKrtProfileScores(plots, profiles, 'city', weights);
  const investorScores = calculateKrtProfileScores(plots, profiles, 'investor', weights);
  const rows = plots.features.map((feature, index) => {
    const p = feature.properties || {};
    const city = cityScores[index];
    const investor = investorScores[index];
    const cityTertile = krtTertile(city, cityScores);
    const investorTertile = krtTertile(investor, investorScores);
    const status = krtDynamicStatus(cityTertile, investorTertile);
    let numerator = 0, denominator = 0;
    if (city != null && !isNaN(city)) { numerator += city * cityWeight; denominator += cityWeight; }
    if (investor != null && !isNaN(investor)) { numerator += investor * investorWeight; denominator += investorWeight; }
    return {
      plot_number: p.plot_number || '', name: p.name || '',
      area_ha: p.area_ha, potential_thsqm: p.potential_thsqm,
      city_score: city == null || isNaN(city) ? null : city,
      investor_score: investor == null || isNaN(investor) ? null : investor,
      city_tertile: cityTertile, investor_tertile: investorTertile,
      status, status_color: KRT_DYNAMIC_STATUS_COLORS[status] || '#000000',
      combined_raw: denominator > 0 ? numerator / denominator : null,
      /** @type {number | null} */ combined_score: null,
      /** @type {number} */ rank: 0,
      city_weight: cityWeight, investor_weight: investorWeight,
      feature,
    };
  });
  const normalized = normalizeRelative(rows.map((row) => row.combined_raw));
  rows.forEach((row, index) => { row.combined_score = normalized[index]; });
  rows.sort((a, b) => {
    if (a.combined_score == null) return 1;
    if (b.combined_score == null) return -1;
    return b.combined_score - a.combined_score;
  });
  /** @type {number | null} */
  let lastScore = null;
  let currentRank = 0;
  rows.forEach((row, index) => {
    if (lastScore == null || row.combined_score == null
        || Math.abs(row.combined_score - lastScore) > 1e-9) currentRank = index + 1;
    row.rank = currentRank;
    lastScore = row.combined_score;
    Object.assign(row.feature.properties, {
      city_score: row.city_score, investor_score: row.investor_score,
      combined_score: row.combined_score, rank: row.rank,
      city_tertile: row.city_tertile, investor_tertile: row.investor_tertile,
      status: row.status, status_color: row.status_color,
    });
  });
  return rows;
}
/** @typedef {ReturnType<typeof calculateKrtRanking>[number]} RankingRow */

// ── Форматы ─────────────────────────────────────────────────────────────────
/** @param {any} value @param {number} [digits] */
export function formatKrtValue(value, digits) {
  if (value == null || value === '' || isNaN(Number(value))) return '—';
  return Number(value).toFixed(digits == null ? 1 : digits).replace('.', ',');
}

/** @param {any} value */
export function formatScore(value) {
  if (value == null || isNaN(Number(value))) return '—';
  return Number(value).toFixed(2).replace(/[.]?0+$/, '');
}
