// Live updates for the apps: GET /api/v1/events keeps the connection open and
// sends a message whenever what the signed-in person can see has changed
// (Server-Sent Events). The message is the same small digest as GET /changes, so
// the app knows which lists to fetch again. The first message is sent straight
// away, which also covers anything missed while the app was offline.
//
// There is no push from the database, so the server looks for changes every few
// seconds, once per signed-in person however many devices they have open. Edits
// made through the API wake the check at once. Streams are short-lived (ten
// minutes) so a revoked or replaced token cannot keep one open for long; the app
// simply reconnects.
'use strict';

function create(options) {
  const api = options.api;
  const now = options.now || Date.now;
  const log = options.log || function () {};
  const pollMs = options.pollMs || 3000;
  const pingMs = options.pingMs || 15000;
  const recheckMs = options.recheckMs || 30000;
  const maxAgeMs = options.maxAgeMs || 10 * 60 * 1000;
  const maxPerUser = options.maxPerUser || 4;
  const maxTotal = options.maxTotal || 200;
  const schedule = options.setInterval || setInterval;
  const later = options.setTimeout || setTimeout;

  const byUser = new Map(); // uname -> Set(connection)
  let total = 0;
  let timer = null;
  let wakeTimer = null;
  let ticking = false;

  function write(conn, text) {
    conn.res.write(text);
    conn.lastWrite = now();
  }

  function send(conn, digest) {
    conn.sent = digest.revision;
    write(conn, 'event: changes\ndata: ' + JSON.stringify(digest) + '\n\n');
  }

  function close(conn, farewell) {
    if (conn.closed) { return; }
    conn.closed = true;
    const set = byUser.get(conn.uname);
    if (set) {
      set.delete(conn);
      if (set.size === 0) { byUser.delete(conn.uname); }
    }
    total--;
    if (total === 0 && timer) { clearInterval(timer); timer = null; }
    try {
      if (farewell) { conn.res.write('event: bye\ndata: {}\n\n'); }
      conn.res.end();
    } catch (e) { /* the other side is gone already */ }
  }

  // One pass: look for changes for each person with a stream open, keep the
  // connections alive, and retire the old or revoked ones.
  async function tick() {
    if (ticking) { return; }
    ticking = true;
    try {
      for (const [uname, set] of Array.from(byUser.entries())) {
        let digest = null;
        const user = { uname: uname };
        for (const conn of Array.from(set)) {
          if (conn.closed) { continue; }
          const t = now();
          if (t - conn.startedAt >= maxAgeMs) { close(conn, true); continue; }
          if (t - conn.checkedAt >= recheckMs) {
            conn.checkedAt = t;
            try {
              await api.authenticate(conn.header);
            } catch (e) {
              close(conn, false);
              continue;
            }
          }
          try {
            if (!digest) { digest = await api.digestFor(user); }
            if (conn.sent !== digest.revision) {
              send(conn, digest);
            } else if (t - conn.lastWrite >= pingMs) {
              write(conn, ': ping\n\n');
            }
          } catch (e) {
            log('events: ' + ((e && e.message) || e));
            if (t - conn.lastWrite >= pingMs) { try { write(conn, ': ping\n\n'); } catch (x) { close(conn, false); } }
          }
        }
      }
    } finally {
      ticking = false;
    }
  }

  // Called after an edit made through the API, so other devices hear about it
  // within a moment instead of at the next pass.
  function wake() {
    if (total === 0 || wakeTimer) { return; }
    wakeTimer = later(function () {
      wakeTimer = null;
      tick().catch(function () {});
    }, 150);
    if (wakeTimer && wakeTimer.unref) { wakeTimer.unref(); }
  }

  // The Express handler for GET /events.
  async function handle(req, res, fail) {
    let user;
    try {
      user = await api.authenticate(req.headers.authorization);
    } catch (e) {
      return fail(e);
    }
    const mine = byUser.get(user.uname);
    if ((mine && mine.size >= maxPerUser) || total >= maxTotal) {
      return fail(api.tooMany('Too many open connections. Please try again shortly.', 30));
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    if (res.flushHeaders) { res.flushHeaders(); }

    const conn = {
      uname: user.uname, res: res, header: req.headers.authorization,
      startedAt: now(), checkedAt: now(), lastWrite: now(), sent: null, closed: false
    };
    if (!byUser.has(user.uname)) { byUser.set(user.uname, new Set()); }
    byUser.get(user.uname).add(conn);
    total++;
    // res, not req: since Node 16 a request "closes" once it has been read, but a response
    // closes when the connection to the app does.
    res.on('close', function () { close(conn, false); });
    res.write('retry: 5000\n\n');

    try {
      send(conn, await api.digestFor(user));
    } catch (e) {
      log('events: ' + ((e && e.message) || e));
      close(conn, false);
      return undefined;
    }
    if (!timer) {
      timer = schedule(function () { tick().catch(function () {}); }, pollMs);
      if (timer && timer.unref) { timer.unref(); }
    }
    return undefined;
  }

  return { handle: handle, tick: tick, wake: wake, open: function () { return total; } };
}

module.exports = { create: create };
