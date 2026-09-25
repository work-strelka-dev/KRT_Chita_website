// Golden-тесты: JS-формулы обязаны совпасть с Python-методикой.
// Запуск: node --test tests/
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { MAX_ADDITIONAL, canAdd, isStandalone, summarize } from '../web/js/domain/combo.js';
import { optimizeCombo } from '../web/js/domain/optimize.js';
import { normalize } from '../web/js/state.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const { sites } = readJson('../web/data/sites.json');
const golden = readJson('./golden_cases.json');
const { cases } = golden;
const byId = new Map(sites.map((s) => [s.id, s]));
const combo = (anchor, additional) => [anchor, ...additional].map((id) => byId.get(id));

const EXACT = ['count', 'ipValid', 'areaFits', 'avarM2', 'gradM2', 'sppNewM2', 'sppDemolM2',
  'deltaAvarM2', 'deltaSppNewM2', 'deltaSppDemolM2'];

for (const c of cases) {
  test(`golden: ${c.anchor} + [${c.additional.join(', ')}] (${c.note})`, () => {
    const s = summarize(combo(c.anchor, c.additional));
    for (const key of EXACT) assert.equal(s[key], c.expected[key], key);
    assert.ok(Math.abs(s.areaHa - c.expected.areaHa) < 1e-9, 'areaHa');
    assert.ok(Math.abs(s.ip - c.expected.ip) < 1e-9, 'ip');
  });
}

test('IP ровно 1,00 не проходит', () => {
  assert.equal(summarize(combo('20.1', [])).ipValid, false);
});

test('ровно 45 га помещаются, 45,1 — нет', () => {
  const at45 = cases.find((c) => c.expected.areaHa === 45 && c.expected.count === 5);
  assert.ok(at45, 'в golden есть комбинация ровно 45 га');
  assert.equal(summarize(combo(at45.anchor, at45.additional)).areaFits, true);
  const members = combo(at45.anchor, at45.additional.slice(0, -1));
  const last = byId.get(at45.additional.at(-1));
  assert.equal(canAdd(members, last).ok, true);
  assert.equal(canAdd(members, { ...last, areaHa: last.areaHa + 0.1 }).reason, 'area');
});

test('крупная опорная 31.4 самостоятельная: присоединять нельзя', () => {
  assert.equal(isStandalone(byId.get('31.4')), true);
  assert.equal(canAdd(combo('31.4', []), byId.get('23.2')).reason, 'standalone');
});

test('после 4 добавленных — только снятие', () => {
  const small = sites.filter((s) => s.addable).sort((a, b) => a.areaHa - b.areaHa).slice(0, MAX_ADDITIONAL + 1);
  const members = [byId.get('9.1'), ...small.slice(0, MAX_ADDITIONAL)];
  assert.equal(canAdd(members, small[MAX_ADDITIONAL]).reason, 'full');
});

test('неприсоединяемая площадка отклоняется', () => {
  assert.equal(canAdd(combo('9.1', []), byId.get('26.1')).reason, 'notAddable');
});

test('normalize: белый список, повторы, лимит площади', () => {
  const { state, dropped } = normalize({ anchorId: '2.1', selectedIds: ['23.2', 'x<script>', '23.2', '20.2'] }, byId);
  assert.deepEqual(state, { anchorId: '2.1', selectedIds: ['23.2'] });
  assert.deepEqual(dropped, ['20.2']);
  assert.deepEqual(normalize({ anchorId: '23.2', selectedIds: [] }, byId).state, { anchorId: null, selectedIds: [] });
});

const pool = sites.filter((s) => s.addable && !s.reason);

for (const c of golden.optimize) {
  test(`optimize: ${c.anchor} + [${c.kept.join(', ')}] (${c.note})`, () => {
    const kept = combo(c.anchor, c.kept);
    const result = optimizeCombo(kept, pool.filter((s) => !c.kept.includes(s.id)));
    assert.equal(result.status, c.status);
    assert.deepEqual(result.added.map((s) => s.id), c.added);
  });
}
