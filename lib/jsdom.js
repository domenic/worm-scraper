"use strict";
const jsdom = require("jsdom");

// No need to fetch or execute JavaScript
module.exports = (contents, options) => {
  options = Object.assign({}, options, {
    features: {
      FetchExternalResources: false,
      ProcessExternalResources: false
    }
  });

  return jsdom.jsdom(contents, options);
};
