// A small in-memory limiter for failed attempts (logins, password checks) and
// for actions that send email. State is per process and is lost on restart,
// which is fine here: the app runs as a single process.
'use strict';

function createLimiter(options) {
  const max = options.max;
  const windowMs = options.windowMs;
  const now = options.now || Date.now;
  const entries = new Map(); // key -> { count, resetAt }

  function current(key) {
    const entry = entries.get(key);
    if (!entry) { return null; }
    if (entry.resetAt <= now()) {
      entries.delete(key);
      return null;
    }
    return entry;
  }

  // Drop expired entries now and then so the map cannot grow without bound.
  const sweep = setInterval(function () {
    const t = now();
    entries.forEach(function (entry, key) {
      if (entry.resetAt <= t) { entries.delete(key); }
    });
  }, Math.max(windowMs, 60 * 1000));
  if (sweep.unref) { sweep.unref(); }

  return {
    // true once `key` has used up its attempts
    isLimited: function (key) {
      const entry = current(key);
      return !!entry && entry.count >= max;
    },
    // record one attempt; returns true if the key is now limited
    hit: function (key) {
      let entry = current(key);
      if (!entry) {
        entry = { count: 0, resetAt: now() + windowMs };
        entries.set(key, entry);
      }
      entry.count++;
      return entry.count >= max;
    },
    reset: function (key) {
      entries.delete(key);
    },
    size: function () {
      return entries.size;
    }
  };
}

module.exports = { createLimiter: createLimiter };
