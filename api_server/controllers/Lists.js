'use strict';

var utils = require('../utils/writer.js');
var Lists = require('../service/ListsService');

module.exports.getDetailedList = function getDetailedList (req, res, next, id) {
  Lists.getDetailedList(id)
    .then(function (response) {
      utils.writeJson(res, response);
    })
    .catch(function (response) {
      utils.writeJson(res, response);
    });
};

module.exports.getLists = function getLists (req, res, next) {
  Lists.getLists()
    .then(function (response) {
      utils.writeJson(res, response);
    })
    .catch(function (response) {
      utils.writeJson(res, response);
    });
};

module.exports.removeListById = function removeListById (req, res, next, id) {
  Lists.removeListById(id)
    .then(function (response) {
      utils.writeJson(res, response);
    })
    .catch(function (response) {
      utils.writeJson(res, response);
    });
};

module.exports.shareListById = function shareListById (req, res, next, body, id) {
  Lists.shareListById(body, id)
    .then(function (response) {
      utils.writeJson(res, response);
    })
    .catch(function (response) {
      utils.writeJson(res, response);
    });
};

module.exports.unShareListById = function unShareListById (req, res, next, id) {
  Lists.unShareListById(id)
    .then(function (response) {
      utils.writeJson(res, response);
    })
    .catch(function (response) {
      utils.writeJson(res, response);
    });
};

module.exports.updateListById = function updateListById (req, res, next, body, id) {
  Lists.updateListById(body, id)
    .then(function (response) {
      utils.writeJson(res, response);
    })
    .catch(function (response) {
      utils.writeJson(res, response);
    });
};

module.exports.updateUserShareById = function updateUserShareById (req, res, next, body, id) {
  Lists.updateUserShareById(body, id)
    .then(function (response) {
      utils.writeJson(res, response);
    })
    .catch(function (response) {
      utils.writeJson(res, response);
    });
};
