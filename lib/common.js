"use strict";

exports.getChapterTitle = function (rawChapterDoc) {
  return rawChapterDoc.querySelector("h1.entry-title").textContent;
};
