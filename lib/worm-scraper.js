"use strict";
const path = require("path");
const fs = require("mz/fs");
const mkdirp = require("mkdirp-then");
const rimraf = require("rimraf-then");
const jsdom = require("./jsdom.js");

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
  .then(getChapterFilePaths)
  .then(function (chapterFilePaths) {
    console.log("All chapters downloaded; beginning conversion to EPUB chapters");
    return Promise.all(chapterFilePaths.map(convertChapter));
  })
  .then(function () {
    console.log("All done!");
  });

function getChapterFilePaths() {
  return fs.readdir(cachePath).then(function (filenames) {
    return filenames.filter(function (f) { return f.endsWith(".html"); })
                    .map(function (f) { return path.resolve(cachePath, f); });
  });
}

function convertChapter(filePath, i) {
  console.log(`- Reading ${filePath}`);
  return fs.readFile(filePath, { encoding: "utf-8" }).then(function (contents) {
    console.log(`- Read ${filePath}`);
    const rawChapterDoc = jsdom(contents);
    const output = getChapterString(rawChapterDoc);

    // TODO: this should probably not be necessary... jsdom bug I guess!?
    rawChapterDoc.defaultView.close();

    const destFilename = path.resolve(contentPath, `chapter${i + 1}.xhtml`);
    return fs.writeFile(destFilename, output);
  })
  .then(function () {
    console.log(`- Finished converting ${filePath}`);
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
