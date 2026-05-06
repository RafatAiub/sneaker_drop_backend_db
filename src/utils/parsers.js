'use strict';

/**
 * Validates and returns a positive integer.
 * @param {*} value
 * @param {string} fieldName
 * @returns {number}
 */
function parsePositiveInteger(value, fieldName) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return parsed;
}

/**
 * Validates and returns a trimmed, non-empty username (max 50 chars).
 * @param {*} value
 * @returns {string}
 */
function parseUsername(value) {
  const username = String(value || '').trim();

  if (!username) {
    throw new Error('username is required.');
  }

  if (username.length > 50) {
    throw new Error('username must be 50 characters or fewer.');
  }

  return username;
}

/**
 * Parses a value into a valid Date.  Does NOT enforce future-only dates
 * so it can be used for historical seeds too.
 * @param {*} value
 * @param {string} fieldName
 * @returns {Date}
 */
function parseFutureDate(value, fieldName) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid ISO date.`);
  }

  return parsed;
}

/**
 * Accepts either `priceInCents` (integer) or `price` (decimal dollars)
 * and returns the price as an integer number of cents.
 * @param {{ priceInCents?: number, price?: number }} payload
 * @returns {number}
 */
function parsePriceInCents(payload) {
  if (payload.priceInCents !== undefined) {
    return parsePositiveInteger(payload.priceInCents, 'priceInCents');
  }

  const numericPrice = Number(payload.price);

  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    throw new Error('price must be a positive number.');
  }

  return Math.round(numericPrice * 100);
}

module.exports = {
  parsePositiveInteger,
  parseUsername,
  parseFutureDate,
  parsePriceInCents,
};
