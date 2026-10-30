// The Express layer for lib/api.js: turns each route in the table into an
// Express route, checks the bearer token where a route needs one, and sends
// every result and error as JSON. All of the actual rules are in lib/api.js.
'use strict';

const ApiError = require('./api').ApiError;

function send(res, result) {
  const headers = result.headers || {};
  Object.keys(headers).forEach(function (name) { res.setHeader(name, headers[name]); });
  res.status(result.status || 200);
  if (result.body === undefined) {
    res.end();
  } else {
    res.json(result.body);
  }
}

function sendError(res, error) {
  send(res, {
    status: error.status,
    headers: error.headers,
    body: { error: { code: error.code, message: error.message } }
  });
}

// extras (optional): { events: lib/apiEvents, idempotency: lib/idempotency }
function create(express, api, extras) {
  extras = extras || {};
  const events = extras.events || null;
  const idempotency = extras.idempotency || null;
  const router = express.Router();

  // Responses carry account data, so nothing should keep a copy.
  router.use(function (req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(express.json({ limit: '50kb' }));

  api.routes.forEach(function (route) {
    if (route.stream) {
      // Live updates. Without the events module this answers like any unknown endpoint.
      router.get(route.path, function (req, res) {
        if (!events) { return sendError(res, new ApiError(404, 'not_found', 'No such endpoint.')); }
        const fail = function (e) { sendError(res, api.describeError(e)); };
        return events.handle(req, res, fail).catch(fail);
      });
      return;
    }
    router[route.method](route.path, async function (req, res) {
      try {
        const user = route.auth ? await api.authenticate(req.headers.authorization) : null;
        const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
        const run = function () { return route.handler({ body: body, params: req.params, query: req.query, ip: req.ip, user: user }); };
        const writes = route.auth && route.method !== 'get';
        let result;
        if (writes && idempotency) {
          // An app that retries a write after losing its connection sends the same
          // Idempotency-Key, and gets the first answer back instead of a second edit.
          const request = route.method + ' ' + req.path + ' ' + JSON.stringify(body) + ' ' + JSON.stringify(req.query);
          const outcome = await idempotency.run(user.uname, request, req.get('Idempotency-Key'), run);
          result = outcome.replayed
            ? Object.assign({}, outcome.result, { headers: Object.assign({}, outcome.result.headers, { 'Idempotent-Replay': 'true' }) })
            : outcome.result;
        } else {
          result = await run();
        }
        if (writes && events) { events.wake(); }
        send(res, result);
      } catch (e) {
        sendError(res, api.describeError(e));
      }
    });
  });

  router.use(function (req, res) {
    sendError(res, new ApiError(404, 'not_found', 'No such endpoint.'));
  });

  // errors from the JSON body parser
  router.use(function (err, req, res, next) {
    if (res.headersSent) { return next(err); }
    if (err && err.type === 'entity.parse.failed') {
      return sendError(res, new ApiError(400, 'invalid_json', 'The request body is not valid JSON.'));
    }
    if (err && err.type === 'entity.too.large') {
      return sendError(res, new ApiError(413, 'too_large', 'The request body is too large.'));
    }
    return sendError(res, api.describeError(err));
  });

  return router;
}

module.exports = { create: create };
