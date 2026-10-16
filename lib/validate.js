// Input checks shared by the web pages and the JSON API.
//
// Everything that comes from a request (body, params, query) is untrusted. All
// SQL uses "?" placeholders, and values are first coerced to a plain string or
// integer. The coercion matters: the mysql library expands an object passed to
// "?" into "`key` = value" pairs, and JSON request bodies can contain objects.
'use strict';

function asString(v) {
  if (typeof v === 'string') { return v; }
  if (typeof v === 'number') { return String(v); }
  return '';
}

// Row ids: digits only, otherwise null.
function toId(v) {
  const s = asString(v);
  return /^\d{1,15}$/.test(s) ? parseInt(s, 10) : null;
}

// Optional item quantity: a positive whole number, otherwise null.
function parseCount(v) {
  const s = asString(v).trim();
  if (!/^\d{1,9}$/.test(s)) { return null; }
  const n = parseInt(s, 10);
  return n > 0 ? n : null;
}

// List colours end up inside a style attribute, so only accept hex digits.
function isHexColor(v) {
  return /^[0-9a-fA-F]{3,8}$/.test(v);
}

// Plausible email address: something@something.tld, no spaces or quote/angle
// characters, a sane length. Not a full RFC check; the real test is whether the
// message arrives.
function isEmail(v) {
  return typeof v === 'string' && v.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(v);
}

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

function passwordProblem(password) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return 'Passwords must be at least ' + MIN_PASSWORD_LENGTH + ' characters long.';
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return 'That password is too long.';
  }
  return null;
}

// How long a password reset link keeps working. Kept generous because the
// date_added column may hold only a date; shorten once it is known to be a
// full timestamp.
const RESET_TOKEN_HOURS = 24;

module.exports = {
  asString: asString,
  toId: toId,
  parseCount: parseCount,
  isHexColor: isHexColor,
  isEmail: isEmail,
  passwordProblem: passwordProblem,
  MIN_PASSWORD_LENGTH: MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH: MAX_PASSWORD_LENGTH,
  RESET_TOKEN_HOURS: RESET_TOKEN_HOURS
};
