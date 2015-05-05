"use strict";
const path = require("path");
const fs = require("mz/fs");
const mkdirp = require("mkdirp-then");
const rimraf = require("rimraf-then");
const request = require("requisition");
const jsdom = require("jsdom");

require("./track-rejections.js");

const START_CHAPTER = "https://parahumans.wordpress.com/2011/06/11/1-1/";

const cachePath = path.resolve("cache");
const outPath = path.resolve("out");
const contentPath = path.resolve(outPath, "OEBPS");

const rawChapterDocsCache = new Map();

rimraf(outPath)
  .then(function () {
    return mkdirp(contentPath);
  })
  .then(getAllRawChapterDocs)
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

function getAllRawChapterDocs() {
  return fs.readdir(cachePath).then(
    function (filenames) {
      return filenames.map(getRawChapterDoc);
    },
    function (e) {
      if (e.code === "ENOENT") {
        return downloadAllChapters();
      } else {
        throw e;
      }
    }
  );
}

function downloadAllChapters() {
  let currentChapter = START_CHAPTER;
  let chapterCounter = 1;

  return mkdirp(cachePath).then(loop).then(function () {
    return toArray(rawChapterDocsCache.values());
  });

  function loop() {
    const filename = `chapter${chapterCounter}.html`;

    console.log(`Downloading ${currentChapter}`);

    return request(currentChapter).redirects(10).then(function (response) {
      return response.text();
    })
    .then(function (contents) {
      const rawChapterDoc = setRawChapterDoc(filename, contents);
      currentChapter = getNextChapterUrl(rawChapterDoc);

      return fs.writeFile(path.resolve(cachePath, filename), jsdom.serializeDocument(rawChapterDoc));
    })
    .then(function () {
      if (currentChapter === null) {
        return;
      }

      ++chapterCounter;
      return loop();
    });
  }
}

function getRawChapterDoc(filename) {
  const doc = rawChapterDocsCache.get(filename);
  if (doc !== undefined) {
    return Promise.resolve(doc);
  }

  return fs.readFile(path.resolve(cachePath, filename), { encoding: "utf-8" }).then(function (contents) {
    return setRawChapterDoc(filename, contents);
  });
}

function setRawChapterDoc(filename, contents) {
  const doc = jsdom.jsdom(contents);
  rawChapterDocsCache.set(filename, doc);
  return doc;
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
  // a[title="Next Chapter"] doesn't always work (e.g. https://parahumans.wordpress.com/2011/09/27/shell-4-2/)
  // So instead search for the first <a> within the main content area starting with "Next".

  const aEls = rawChapterDoc.querySelectorAll(".entry-content a");
  for (let i = 0; i < aEls.length; ++i) {
    if (aEls[i].textContent.startsWith("Next")) {
      return aEls[i].href;
    }
  }

  return null;
}

function toArray(iterable) {
  const array = [];
  for (const x of iterable) {
    array.push(x);
  }
  return array;
}
