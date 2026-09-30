// @ts-check
// Единственное место форматирования чисел в интерфейсе (ru-RU).

/** @param {number} digits @param {boolean} [signed] */
const numberFormat = (digits, signed = false) =>
  new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: signed ? 'exceptZero' : 'auto',
  });

const ONE = numberFormat(1);
const ONE_SIGNED = numberFormat(1, true);
const WHOLE = numberFormat(0);
const WHOLE_SIGNED = numberFormat(0, true);
const PERCENT_SIGNED = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' });

/**
 * Индекс на сайте — в шкале −100…100: (IP − 1) × 100, 0 соответствует порогу методики IP = 1.
 * 1 знак со знаком: 1,28 → «+28,0», 0,996 → «−0,4». Проходит ли IP > 1 — только по isIpValid.
 */
export const indexScale = (/** @type {number} */ ip) => (ip - 1) * 100;
export const formatIp = (/** @type {number} */ ip) => ONE_SIGNED.format(indexScale(ip));
/** Площадь, га: 1 знак. */
export const formatHa = (/** @type {number} */ v) => ONE.format(v);
/** м² → тыс. м², 1 знак (аварийное жильё, предельные эффекты). */
export const formatK1 = (/** @type {number} */ m2) => ONE.format(m2 / 1000);
/** м² → тыс. м², целое (градостроительный потенциал). */
export const formatK0 = (/** @type {number} */ m2) => WHOLE.format(m2 / 1000);
/** Метры для масштабной линейки. */
export const formatMeters = (/** @type {number} */ m) => `${WHOLE.format(m)} м`;

export const signed = {
  /** Разница индексов в пунктах новой шкалы. */
  ip: (/** @type {number} */ d) => ONE_SIGNED.format(d * 100),
  ha: (/** @type {number} */ v) => ONE_SIGNED.format(v),
  k1: (/** @type {number} */ m2) => ONE_SIGNED.format(m2 / 1000),
  k0: (/** @type {number} */ m2) => WHOLE_SIGNED.format(m2 / 1000),
  /** Доля изменения: 0.123 → «+12 %». */
  pct: (/** @type {number} */ share) => PERCENT_SIGNED.format(share),
};

/** Склонение: plural(3, ['площадка', 'площадки', 'площадок']). */
export function plural(/** @type {number} */ n, /** @type {[string, string, string]} */ forms) {
  const rule = new Intl.PluralRules('ru-RU').select(n);
  return rule === 'one' ? forms[0] : rule === 'few' ? forms[1] : forms[2];
}
