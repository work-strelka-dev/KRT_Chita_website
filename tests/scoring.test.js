// Скоринговая карта: алгоритмы web/js/scoring/model.js на данных сборки обязаны
// совпасть с исходной страницей krt_map_updated.html (эталон снят с её функций).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { assembleProfiles, checkedPlots } from '../web/js/scoring/data.js';
import {
  buildCombinedGeoJSON, calcCombinedIntegral, calcProfileIntegral, calculateKrtRanking,
  createWeights, formatScore, krtDynamicStatus, krtTertile, normalizeRelative, scoreFillOpacity, valToRgb,
} from '../web/js/scoring/model.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const golden = readJson('./scoring_golden.json');

function freshState() {
  const profiles = assembleProfiles(readJson('../web/data/scoring/hexes.json'), readJson('../web/data/scoring/profiles.json'));
  const plots = checkedPlots(readJson('../web/data/scoring/plots.json'), profiles);
  return { profiles, plots };
}

function equalSeries(actual, expected, label, tol = 1e-9) {
  assert.equal(actual.length, expected.length, `${label}: длина`);
  for (let i = 0; i < expected.length; i += 1) {
    const a = actual[i];
    const e = expected[i];
    if (e === null || a === null) assert.equal(a, e, `${label}[${i}]`);
    else assert.ok(Math.abs(a - e) <= tol, `${label}[${i}]: ${a} ≠ ${e}`);
  }
}

for (const scenario of golden.scenarios) {
  test(`совпадение с исходной картой: ${scenario.name}`, () => {
    const { profiles, plots } = freshState();
    const weights = createWeights();
    for (const [profile, values] of Object.entries(scenario.weights.criteria)) {
      for (const [key, value] of Object.entries(values)) weights.set(profile, key, value);
    }
    for (const [key, value] of Object.entries(scenario.weights.combined)) weights.set('combined', key, value);

    calcProfileIntegral(profiles, 'city', weights);
    calcProfileIntegral(profiles, 'investor', weights);
    const combined = buildCombinedGeoJSON(profiles.city.geojson.features);
    calcCombinedIntegral(profiles, combined, weights);
    const ranking = calculateKrtRanking(plots, profiles, weights);

    equalSeries(profiles.city.geojson.features.map((f) => f.properties._integral), scenario.cityIntegral, 'интеграл города');
    equalSeries(profiles.investor.geojson.features.map((f) => f.properties._integral), scenario.investorIntegral, 'интеграл инвестора');
    equalSeries(combined.features.map((f) => f.properties._combined_integral_raw), scenario.combinedRaw, 'общий до нормировки', 1e-6);
    equalSeries(combined.features.map((f) => f.properties._combined_integral), scenario.combinedIntegral, 'общий слой');
    assert.deepEqual(ranking.map((r) => [r.plot_number, r.rank, r.status, r.city_tertile, r.investor_tertile]),
      scenario.ranking.map((r) => [r.plot_number, r.rank, r.status, r.city_tertile, r.investor_tertile]), 'рейтинг');
    equalSeries(ranking.map((r) => r.combined_score), scenario.ranking.map((r) => r.combined_score), 'итоговый балл площадок');
  });
}

test('нормировка: пустые, равные и обычные значения', () => {
  assert.deepEqual(normalizeRelative([null, NaN]), [null, null]);
  assert.deepEqual(normalizeRelative([3, 3, null]), [0, 0, null]);
  assert.deepEqual(normalizeRelative([1, 2, 3]), [0, 5, 10]);
});

test('терцили и статусы площадок', () => {
  const values = [1, 2, 3, 4, 5, 6];
  assert.equal(krtTertile(1, values), 'Низкая');
  assert.equal(krtTertile(3, values), 'Средняя');
  assert.equal(krtTertile(6, values), 'Высокая');
  assert.equal(krtDynamicStatus('Высокая', 'Низкая'), 'Нужны стимулы');
  assert.equal(krtDynamicStatus('Высокая', 'Средняя'), 'Безусловный приоритет');
  assert.equal(krtDynamicStatus('Средняя', 'Средняя'), 'Нейтральный статус');
  assert.equal(krtDynamicStatus('Низкая', 'Высокая'), 'Нужно пересмотреть конфигурацию');
});

test('шкала цвета и прозрачность', () => {
  assert.equal(valToRgb(0), 'rgb(44,66,149)');
  assert.equal(valToRgb(10), 'rgb(0,167,167)');
  assert.equal(valToRgb(null), 'rgba(75,85,99,0.55)');
  assert.equal(scoreFillOpacity(0, true), 0);
  assert.equal(scoreFillOpacity(5, false), 0.78);
  assert.equal(formatScore(10), '10');
  assert.equal(formatScore(4.5), '4.5');
});

test('веса по умолчанию: критерий 5, общий слой инвестор 6 / город 4', () => {
  const w = createWeights();
  assert.equal(w.criterion('city', 'crit_1_score'), 5);
  assert.equal(w.combined('investor'), 6);
  assert.equal(w.combined('city'), 4);
});
