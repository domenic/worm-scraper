"use strict";
const path = require("path");
const fs = require("mz/fs");
const mkdirp = require("mkdirp-then");
const request = require("requisition");
const jsdom = require("jsdom");

require("./track-rejections.js");

const START_CHAPTER = "http://parahumans.wordpress.com/category/stories-arcs-1-10/arc-1-gestation/1-01/";

const cachePath = path.resolve("cache");
const outPath = path.resolve("out");
const contentPath = path.resolve(outPath, "OEBPS");

let chapters;
getChapters()
  .then(function (theChapters) {
    chapters = theChapters;
    return mkdirp(contentPath);
  })
  .then(function () {
    return Promise.all(chapters.map(getRawChapterDoc));
  })
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

function getChapters() {
  return fs.readdir(cachePath).catch(function (e) {
    if (e.code === "ENOENT") {
      let currentChapter = START_CHAPTER;
      let chapterCounter = 1;
      const filenames = [];

      return loop().then(function () {
        return filenames;
      });

      function loop() {
        const filename = `chapter${chapterCounter}.html`;

        console.log(`Downloading ${currentChapter}`);

        return request(currentChapter).redirects(10).then(function (response) {
          return response.saveTo(path.resolve(cachePath, filename));
        })
        .then(function () {
          filenames.push(filename);

          // This is inefficient in a number of ways; whatever.
          return getRawChapterDoc(filename);
        })
        .then(function (rawChapterDoc) {
          currentChapter = getNextChapterUrl(rawChapterDoc);

          if (currentChapter === null) {
            return;
          }

          ++chapterCounter;
          return loop();
        });
      }
    } else {
      throw e;
    }
  });
}

function getRawChapterDoc(filename) {
  return fs.readFile(path.resolve(cachePath, filename), { encoding: "utf-8" }).then(function (contents) {
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

function getNextChapterUrl(rawChapterDoc) {
  const nextEl = rawChapterDoc.querySelector("a[title=\"Next Chapter\"]");
  return nextEl && nextEl.href;
}
