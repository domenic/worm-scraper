"use strict";
const jsdom = require("jsdom");
const xtend = require("xtend");

// No need to fetch or execute JavaScript
module.exports = function (contents, options) {
  options = xtend(options, { features: {
    FetchExternalResources: false,
    ProcessExternalResources: false
  }});

  return jsdom.jsdom(contents, options);
};
