// Makes a write safe to send twice. An app that loses its connection after
// sending "add milk" cannot know whether the server saw it; it sends the same
// request again with the same Idempotency-Key header, and gets the first answer
// back instead of a second item. Answers are kept in memory for a day, which is
// enough for the case it exists for (a phone coming back online); a server
// restart forgets them, which is acceptable for the same reason.
'use strict';

const KEY = /^[A-Za-z0-9_-]{8,100}$/;

function create(options) {
  options = options || {};
  const now = options.now || Date.now;
  const ttlMs = options.ttlMs || 24 * 3600 * 1000;
  const max = options.max || 5000;
  const entries = new Map(); // scope -> { at, promise }

  function sweep() {
    const cutoff = now() - ttlMs;
    for (const [scope, entry] of entries) {
      if (entry.at > cutoff && entries.size <= max) { break; } // oldest first
      entries.delete(scope);
    }
  }

  // Runs fn() unless this key was already used for the same request by the same
  // person; then returns what the first run returned. Only successful results are
  // kept: a failed attempt can safely be tried again. Returns { result, replayed }.
  async function run(person, request, rawKey, fn) {
    if (typeof rawKey !== 'string' || !KEY.test(rawKey)) {
      return { result: await fn(), replayed: false };
    }
    const scope = person + '\n' + request + '\n' + rawKey;
    sweep();
    const existing = entries.get(scope);
    if (existing) {
      return { result: await existing.promise, replayed: true };
    }
    const promise = Promise.resolve().then(fn);
    entries.set(scope, { at: now(), promise: promise });
    try {
      const result = await promise;
      if (result && result.status && result.status >= 300) { entries.delete(scope); }
      return { result: result, replayed: false };
    } catch (e) {
      entries.delete(scope);
      throw e;
    }
  }

  return { run: run, size: function () { return entries.size; }, isKey: function (k) { return typeof k === 'string' && KEY.test(k); } };
}

module.exports = { create: create };
