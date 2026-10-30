// Handlebars helpers shared by the web pages and the email templates.
'use strict';

module.exports = {
  // The current year, for the copyright line in the footers.
  currentYear: function () {
    return new Date().getFullYear();
  }
};
