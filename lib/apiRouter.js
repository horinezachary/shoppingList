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

function create(express, api) {
  const router = express.Router();

  // Responses carry account data, so nothing should keep a copy.
  router.use(function (req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(express.json({ limit: '50kb' }));

  api.routes.forEach(function (route) {
    router[route.method](route.path, async function (req, res) {
      try {
        const user = route.auth ? await api.authenticate(req.headers.authorization) : null;
        const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
        const result = await route.handler({ body: body, params: req.params, query: req.query, ip: req.ip, user: user });
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
