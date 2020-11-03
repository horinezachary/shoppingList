'use strict';

var utils = require('../utils/writer.js');
var Items = require('../service/ItemsService');

module.exports.addListItem = function addListItem (req, res, next, body, id) {
  Items.addListItem(body, id)
    .then(function (response) {
      utils.writeJson(res, response);
    })
    .catch(function (response) {
      utils.writeJson(res, response);
    });
};

module.exports.removeListItemById = function removeListItemById (req, res, next) {
  Items.removeListItemById()
    .then(function (response) {
      utils.writeJson(res, response);
    })
    .catch(function (response) {
      utils.writeJson(res, response);
    });
};
