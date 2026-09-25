// @ts-check
// Создание DOM без innerHTML: текст только через текстовые узлы.

/**
 * @typedef {Object} Props
 * @property {string} [className]
 * @property {Record<string, string | number | boolean | null | undefined>} [attrs]
 * @property {Record<string, (event: Event) => void>} [on]
 * @property {Record<string, string>} [style]  CSS-свойства через CSSOM (совместимо с CSP)
 */

/** @typedef {Node | string | number | null | undefined | false} Child */

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Props} [props]
 * @param {...(Child | Child[])} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value === true) node.setAttribute(name, '');
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(name, String(value));
  }
  for (const [type, handler] of Object.entries(props.on ?? {})) node.addEventListener(type, handler);
  for (const [prop, value] of Object.entries(props.style ?? {})) node.style.setProperty(prop, value);
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'object' ? child : String(child));
  }
  return node;
}

/**
 * Перерисовка контейнера с сохранением прокрутки и фокуса (по data-key).
 * @param {HTMLElement} container
 * @param {Child[]} children
 */
export function renderInto(container, children) {
  const { scrollTop } = container;
  const active = document.activeElement;
  const focusKey = active instanceof HTMLElement && container.contains(active) ? active.dataset.key : undefined;
  container.replaceChildren(...children.filter((c) => c !== null && c !== undefined && c !== false).map(
    (c) => (typeof c === 'object' ? c : String(c))));
  container.scrollTop = scrollTop;
  if (focusKey) {
    const target = [...container.querySelectorAll('[data-key]')].find(
      (n) => n instanceof HTMLElement && n.dataset.key === focusKey);
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }
}
