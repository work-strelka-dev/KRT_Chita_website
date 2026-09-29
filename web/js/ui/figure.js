// @ts-check
// Схема площадки с масштабной линейкой. Все схемы в одном масштабе, но обрезаны
// по содержимому, поэтому линейка обязательна: иначе 0,5 га выглядят как 50 га.

import { formatMeters } from '../domain/format.js';
import { el } from './dom.js';

/** @typedef {import('../domain/combo.js').Site} Site */

const SCALE_STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
const SCALE_SHARE = 0.3; // линейка не длиннее 30 % ширины схемы

/** @param {number} widthM */
function scaleLengthM(widthM) {
  const limit = widthM * SCALE_SHARE;
  return SCALE_STEPS.filter((m) => m <= limit).at(-1) ?? SCALE_STEPS[0];
}

/**
 * @param {Site} site
 * @param {'image' | 'thumb'} variant
 */
export function siteFigure(site, variant) {
  const [w, h] = variant === 'image' ? site.imageSize : site.thumbSize;
  const lengthM = scaleLengthM(site.imageWidthM);
  return el('div', { className: `figure figure--${variant}` },
    el('div', { className: 'figure-frame', style: { '--aspect': String(w / h) } },
      el('img', {
        attrs: {
          src: variant === 'image' ? site.image : site.thumb, width: w, height: h,
          alt: `Схема территории площадки ${site.id}`, decoding: 'async',
          loading: variant === 'thumb' ? 'lazy' : null,
        },
      }),
      el('div', { className: 'scalebar' },
        el('span', { className: 'scalebar-bar', attrs: { 'aria-hidden': 'true' }, style: { width: `${(lengthM / site.imageWidthM) * 100}%` } }),
        el('span', { className: 'visually-hidden' }, 'Масштаб: '),
        el('span', {}, formatMeters(lengthM))),
    ),
  );
}
