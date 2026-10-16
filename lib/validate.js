'use strict';

// Plausible email address: something@something.tld, no spaces or quote/angle
// characters, a sane length. Not a full RFC check; the real test is whether the
// message arrives.
function isEmail(v) {
  return typeof v === 'string' && v.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(v);
}

module.exports = { isEmail: isEmail };
