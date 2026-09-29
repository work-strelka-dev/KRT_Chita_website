// @ts-check
// Точка входа: загрузка данных, состояние, связывание событий с отрисовкой.

import { DataError, loadDataset } from './data.js';
import { ANCHOR_CATEGORY, MAX_ADDITIONAL, MAX_AREA_HA, canAdd, isStandalone, summarize } from './domain/combo.js';
import { plural } from './domain/format.js';
import { optimizeCombo } from './domain/optimize.js';
import { EMPTY_STATE, members, normalize, readScenario, readUrl, writeUrl } from './state.js';
import { comboCard } from './ui/comboCard.js';
import { el, renderInto } from './ui/dom.js';
import { CATEGORIES, blockedLong, droppedMessage } from './ui/messages.js';
import { scenarioParams, schemeBody } from './ui/panels.js';
import { addItems, anchorItems, switcher } from './ui/siteList.js';

/** @typedef {import('./data.js').Dataset} Dataset */
/** @typedef {import('./domain/combo.js').Site} Site */
/** @typedef {import('./domain/optimize.js').OptimizeResult} OptimizeResult */
/** @typedef {import('./state.js').State} State */
/** @typedef {import('./state.js').Scenario} Scenario */
/** @typedef {import('./ui/siteList.js').Availability} Availability */

const TOAST_MS = 7000;
const FILTERS = [
  { key: 'all', label: 'Все' },
  ...['нейтральная площадка', 'обременение', 'вознаграждение'].map((key) => ({
    key, label: String(CATEGORIES[key].filter),
  })),
];
const SCENARIOS = [
  { key: 'rec', label: 'Рекомендуемый сценарий' },
  { key: 'opt', label: 'Оптимизация сценария' },
];
const NO_ANCHOR = 'Выберите опорную площадку в списке слева.';

/** @param {string} id */
const node = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {State} s */
const stateKey = (s) => `${s.anchorId}|${s.selectedIds.join(',')}`;

/** @type {Dataset} */
let data;
/** @type {State} */
let state = EMPTY_STATE;
/** @type {Scenario} */
let scenario = 'rec';
/** Результат оптимизации действителен только для того выбора, для которого посчитан. */
/** @type {{ key: string, result: OptimizeResult } | null} */
let optimized = null;
/** Состояние вида, не влияет на расчёт и не попадает в URL. */
const view = { filter: 'all' };
let toastTimer = 0;

/** @param {string} message */
function toast(message) {
  const box = node('toast');
  box.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { box.textContent = ''; }, TOAST_MS);
}

/** @param {State} next */
function setState(next) {
  state = next;
  writeUrl(state, scenario);
  render();
}

/** @param {Site} site @returns {Availability} */
function availability(site) {
  if (!state.anchorId) return { ok: false, reason: 'noAnchor', remainingHa: 0 };
  return canAdd(members(state, data.byId), site);
}

const actions = {
  /** @param {string} anchorId */
  pickAnchor(anchorId) {
    const { state: next, dropped } = normalize({ anchorId, selectedIds: state.selectedIds }, data.byId);
    if (dropped.length) toast(droppedMessage(dropped, anchorId));
    setState(next);
  },
  /** @param {string} siteId */
  toggleSite(siteId) {
    if (state.selectedIds.includes(siteId)) {
      setState({ ...state, selectedIds: state.selectedIds.filter((id) => id !== siteId) });
      return;
    }
    const site = /** @type {Site} */ (data.byId.get(siteId));
    const check = availability(site);
    if (!check.ok) {
      toast(blockedLong(site, check, state.anchorId));
      return;
    }
    setState({ ...state, selectedIds: [...state.selectedIds, siteId] });
  },
  /** @param {string[]} selectedIds */
  applySelection(selectedIds) {
    setState(normalize({ anchorId: state.anchorId, selectedIds }, data.byId).state);
    toast('Комбинация перенесена в выбранную.');
  },
  reset() {
    setState({ ...state, selectedIds: [] });
  },
  optimize() {
    const kept = members(state, data.byId);
    const keptIds = new Set(state.selectedIds);
    const pool = data.sites.filter((s) => s.addable && !s.reason && !keptIds.has(s.id));
    optimized = { key: stateKey(state), result: optimizeCombo(kept, pool) };
    renderCards();
  },
  /** @param {string} key */
  setScenario(key) {
    scenario = key === 'opt' ? 'opt' : 'rec';
    writeUrl(state, scenario);
    render();
  },
  /** @param {string} filter */
  setFilter(filter) {
    view.filter = filter;
    renderAddPanel();
  },
};

/** Все присоединяемые (≤ 45 га), в том числе с индексом ниже 1: единый список без деления. */
function renderAddPanel() {
  const addable = data.sites.filter((s) => s.addable);
  const shown = addable.filter((s) => view.filter === 'all' || s.category === view.filter);

  renderInto(node('add-controls'), [
    switcher({
      kind: 'chip', label: 'Категория', current: view.filter, onChange: actions.setFilter,
      options: FILTERS.map((f) => ({ ...f, count: f.key === 'all' ? addable.length : addable.filter((s) => s.category === f.key).length })),
    }),
    !state.anchorId && el('p', { className: 'list-hint list-hint--strong' }, 'Сначала выберите опорную площадку.'),
  ]);
  renderInto(node('add-list'), addItems({
    sites: shown, selected: new Set(state.selectedIds), availability, onToggle: actions.toggleSite,
  }));
}

/** @param {Site} anchor */
function selectedNote(anchor) {
  const n = state.selectedIds.length;
  if (n === 0) return `Только опорная ${anchor.id}. Добавьте площадки из списка слева.`;
  return `Опорная ${anchor.id} и ${n} ${plural(n, ['присоединённая площадка', 'присоединённые площадки', 'присоединённых площадок'])}.`;
}

/**
 * @param {string} label
 * @param {string[] | null} ids  состав для переноса; null — кнопки нет
 * @param {string} key
 */
function applyButton(label, ids, key) {
  if (!ids) return false;
  const same = ids.join() === state.selectedIds.join();
  return el('button', {
    className: 'button', attrs: { type: 'button', disabled: same, 'data-key': key },
    on: { click: () => actions.applySelection(ids) },
  }, same ? 'Совпадает с выбранной' : label);
}

/**
 * @param {string} titleId @param {Site | null} anchor @param {Site[]} selMembers
 * @param {(HTMLElement | false)[]} extra @param {HTMLElement} [footer]
 */
function selectedCard(titleId, anchor, selMembers, extra, footer) {
  return comboCard({
    titleId, title: 'Выбранная комбинация',
    notes: [anchor ? selectedNote(anchor) : null],
    members: selMembers, summary: selMembers.length ? summarize(selMembers) : null,
    emptyText: anchor && isStandalone(anchor) ? 'Присоединять нельзя' : 'Добавьте площадку',
    message: anchor ? null : NO_ANCHOR,
    onRemove: actions.toggleSite,
    actions: [...extra, state.selectedIds.length > 0 && el('button', {
      className: 'button button--ghost', attrs: { type: 'button', 'data-key': 'reset' },
      on: { click: actions.reset },
    }, 'Сбросить выбор')],
    footer,
  });
}

/** @param {Site | null} anchor */
function recommendedCard(anchor) {
  const rec = anchor ? data.recommended.get(anchor.id) : undefined;
  const recMembers = anchor && rec?.type === 'regular' ? members({ anchorId: anchor.id, selectedIds: rec.additional }, data.byId) : [];
  const summary = recMembers.length ? summarize(recMembers) : null;
  const card = comboCard({
    titleId: 'card-top-title', title: 'Рекомендуемая комбинация',
    notes: [summary ? `Часть оптимального разбиения всех площадок: ${data.coverage} из ${data.total} без повторов.` : null],
    members: recMembers, summary,
    message: !anchor ? NO_ANCHOR : rec?.type === 'standalone'
      ? `Рекомендуемых комбинаций нет: площадь участка больше ${MAX_AREA_HA} га, он рассматривается самостоятельно.`
      : null,
    actions: [applyButton('Перенести в выбранную', summary && rec ? rec.additional : null, 'apply-rec')],
  });
  return { card, summary };
}

/**
 * Параметры расчётной плашки без блока параметров сценария: он зависит от её итога.
 * @param {Site | null} anchor
 * @returns {{ props: Parameters<typeof comboCard>[0], summary: import('./domain/combo.js').ComboSummary | null }}
 */
function optimizedCard(anchor) {
  const titleId = 'card-bottom-title';
  const title = 'Расчётная комбинация';
  const current = optimized && optimized.key === stateKey(state) ? optimized.result : null;
  /** @param {string} message @param {HTMLElement[]} [buttons] */
  const withMessage = (message, buttons = []) =>
    ({ props: { titleId, title, members: [], summary: null, message, actions: buttons }, summary: null });

  if (!anchor) return withMessage(NO_ANCHOR);
  // Кнопка стоит в шапке расчётной плашки, пока для текущего выбора нет результата
  if (!current) {
    const optimizeButton = el('button', {
      className: 'button button--primary', attrs: { type: 'button', 'data-key': 'optimize' },
      on: { click: actions.optimize },
    }, 'Оптимизировать выбор');
    return withMessage('Нажмите «Оптимизировать выбор»: здесь появится комбинация с подобранными площадками.', [optimizeButton]);
  }
  if (current.status === 'full') {
    return withMessage(`Оптимизировать нечего: выбрано ${MAX_ADDITIONAL} площадки, это максимум. `
      + 'Оставьте важные для вас площадки, остальные уберите, и мы подберём более подходящие.');
  }
  if (current.status === 'standalone') {
    return withMessage(`Оптимизировать нечего: опорная ${anchor.id} больше ${MAX_AREA_HA} га и рассматривается самостоятельно.`);
  }
  if (current.status === 'infeasible') {
    return withMessage(`Подобрать не получилось: с оставленными площадками индекс не поднимается выше 1 в пределах ${MAX_AREA_HA} га. `
      + 'Уберите площадку с низким индексом и попробуйте снова.');
  }

  const addedIds = current.added.map((s) => s.id);
  const ids = [...state.selectedIds, ...addedIds];
  const optMembers = members({ anchorId: anchor.id, selectedIds: ids }, data.byId);
  const summary = summarize(optMembers);
  return {
    props: {
      titleId, title,
      notes: [
        addedIds.length
          ? `Добавлено по методике: ${addedIds.join(', ')}.`
          : `Добавить нечего: ни одна площадка не улучшает выбор в пределах ${MAX_AREA_HA} га и индекса больше 1.`,
      ],
      members: optMembers, summary, newIds: new Set(addedIds),
      actions: [applyButton('Перенести в выбранную', addedIds.length ? ids : null, 'apply-opt')],
    },
    summary,
  };
}

/** @param {HTMLElement} section @param {'rec' | 'sel' | 'opt'} variant @param {Node[]} content */
function renderCard(section, variant, content) {
  section.classList.remove('card--rec', 'card--sel', 'card--opt');
  section.classList.add(`card--${variant}`);
  renderInto(section, content);
}

function renderCards() {
  const anchor = state.anchorId ? data.byId.get(state.anchorId) ?? null : null;
  const selMembers = members(state, data.byId);
  const selSummary = selMembers.length ? summarize(selMembers) : null;
  const top = node('card-top');
  const bottom = node('card-bottom');

  if (scenario === 'rec') {
    const rec = recommendedCard(anchor);
    const params = scenarioParams(selSummary, { title: 'Выбранная минус рекомендуемая', base: rec.summary, target: selSummary });
    renderCard(top, 'rec', rec.card);
    renderCard(bottom, 'sel', selectedCard('card-bottom-title', anchor, selMembers, [], params));
  } else {
    const opt = optimizedCard(anchor);
    // Блок стоит в расчётной плашке: правила и эффекты — по расчётной комбинации
    const params = scenarioParams(opt.summary, { title: 'Расчётная минус выбранная', base: selSummary, target: opt.summary });
    renderCard(top, 'sel', selectedCard('card-top-title', anchor, selMembers, []));
    renderCard(bottom, 'opt', comboCard({ ...opt.props, footer: params }));
  }
  renderInto(node('scheme-body'), schemeBody(anchor));
}

function renderScenario() {
  renderInto(node('scenario-tabs'), [switcher({
    kind: 'tab', label: 'Сценарий', current: scenario, onChange: actions.setScenario, controls: 'app',
    options: SCENARIOS, className: 'tabs--scenario',
  })]);
}

function render() {
  const anchors = data.sites.filter((s) => s.category === ANCHOR_CATEGORY);
  renderScenario();
  renderInto(node('anchor-list'), anchorItems(anchors, state.anchorId, actions.pickAnchor));
  renderAddPanel();
  renderCards();
}

/** @param {unknown} error */
function showError(error) {
  const details = error instanceof DataError ? error.message : 'сервер недоступен или вернул некорректный ответ';
  renderInto(node('app'), [el('section', { className: 'panel panel--error', attrs: { role: 'alert' } },
    el('h2', { className: 'panel-title' }, 'Не удалось загрузить данные площадок'),
    el('p', {}, 'Обновите страницу. Если ошибка повторится, сообщите команде проекта.'),
    el('p', { className: 'error-details' }, `Подробности: ${details}.`))]);
}

/** Справка по кнопке «?»: закрывается крестиком, Esc и кликом по фону. */
function initHelp() {
  const help = /** @type {HTMLDialogElement} */ (node('help'));
  node('help-open').addEventListener('click', () => help.showModal());
  node('help-close').addEventListener('click', () => help.close());
  help.addEventListener('click', (event) => { if (event.target === help) help.close(); });
}

async function start() {
  initHelp();
  try {
    data = await loadDataset();
  } catch (error) {
    showError(error);
    return;
  }
  node('data-version').textContent = data.version ? `Данные от ${new Date(data.version).toLocaleDateString('ru-RU')}` : '';
  node('coverage').textContent = `${data.coverage} из ${data.total}`;
  state = readUrl(location.search, data.byId);
  scenario = readScenario(location.search);
  writeUrl(state, scenario);
  render();
}

start();
