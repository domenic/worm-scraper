"use strict";
const path = require("path");
const fs = require("mz/fs");
const mkdirp = require("mkdirp-then");
const rimraf = require("rimraf-then");
const jsdom = require("jsdom");

const download = require("./download.js");

require("./track-rejections.js");

const START_CHAPTER_URL = "https://parahumans.wordpress.com/2011/06/11/1-1/";

const cachePath = path.resolve("cache");
const outPath = path.resolve("out");
const contentPath = path.resolve(outPath, "OEBPS");

rimraf(outPath)
  .then(function () {
    return mkdirp(contentPath);
  })
  .then(function () {
    return download(START_CHAPTER_URL, cachePath);
  })
  .then(readAllRawChapterDocs)
  .then(function (rawChapterDocs) {
    console.log("Extracting content into EPUB chapter files");
    return Promise.all(rawChapterDocs.map(function (rawChapterDoc, i) {
      const output = getChapterString(rawChapterDoc);
      const destFilename = path.resolve(contentPath, `chapter${i + 1}.xhtml`);
      return fs.writeFile(destFilename, output);
    }));
  })
  .then(function () {
    console.log("All done!");
  });

function readAllRawChapterDocs() {
  return fs.readdir(cachePath).then(function (filenames) {
    const htmlFiles = filenames.filter(function (f) { return f.endsWith(".html"); });
    return Promise.all(htmlFiles.map(readRawChapterDoc));
  });
}

function readRawChapterDoc(filename) {
  const filePath = path.resolve(cachePath, filename);
  return fs.readFile(filePath, { encoding: "utf-8" }).then(function (contents) {
    return jsdom.jsdom(contents);
  });
}

function getChapterString(rawChapterDoc) {
  const title = rawChapterDoc.querySelector("h1.entry-title").textContent;
  const body = cleanContentEl(rawChapterDoc.querySelector(".entry-content")).innerHTML;

  return `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
  <head>
    <meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8" />
    <title>${title}</title>
  </head>
  <body>
    <h1>${title}</h1>

    ${body}
  </body>
</html>`;
}

function cleanContentEl(el) {
  // Remove Next Chapter and Previous Chapter <p>s
  el.removeChild(el.firstElementChild);
  el.removeChild(el.lastElementChild);

  // Remove redundant dir="ltr"
  Array.prototype.forEach.call(el.children, function (child) {
    if (child.getAttribute("dir") === "ltr") {
      child.removeAttribute("dir");
    }
  });

  return el;
}
