// Handlebars helpers shared by the web pages and the email templates.
'use strict';

const { appVersion } = require('./version');

module.exports = {
  // The release the site is running (lib/version.js), for the page footer.
  appVersion: function () {
    return appVersion();
  },

  // The current year, for the copyright line in the footers.
  currentYear: function () {
    return new Date().getFullYear();
  }
};
