"use strict";
const path = require("path");
const fs = require("mz/fs");
const throat = require("throat");
const jsdom = require("./jsdom.js");

module.exports = function (cachePath, contentPath) {
  return getChapterFilePaths(cachePath)
    .then(function (chapterFilePaths) {
      console.log("All chapters downloaded; beginning conversion to EPUB chapters");

      const mapper = throat(10, function (filePath) {
        return convertChapter(filePath, contentPath);
      });
      return Promise.all(chapterFilePaths.map(mapper));
    })
    .then(function () {
      console.log("All chapters converted");
    });
};


function getChapterFilePaths(cachePath) {
  return fs.readdir(cachePath).then(function (filenames) {
    return filenames.filter(function (f) { return f.endsWith(".html"); })
                    .map(function (f) { return path.resolve(cachePath, f); });
  });
}

function convertChapter(filePath, contentPath) {
  const filename = path.basename(filePath);

  console.log(`- Reading ${filename}`);
  return fs.readFile(filePath, { encoding: "utf-8" }).then(function (contents) {
    console.log(`- Read ${filename}`);
    const rawChapterDoc = jsdom(contents);
    const output = getChapterString(rawChapterDoc);

    // TODO: this should probably not be necessary... jsdom bug I guess!?
    rawChapterDoc.defaultView.close();

    const destFileName = `${path.basename(filename, ".html")}.xhtml`;
    const destFilePath = path.resolve(contentPath, destFileName);
    return fs.writeFile(destFilePath, output);
  })
  .then(function () {
    console.log(`- Finished converting ${filename}`);
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
  // Remove initial Next Chapter and Previous Chapter <p>
  el.removeChild(el.firstElementChild);

  // Remove everything after the last <p> (e.g. analytics <div>s)
  const lastP = el.querySelector("p:last-of-type");
  while (el.lastElementChild !== lastP) {
    el.removeChild(el.lastElementChild);
  }

  // Remove empty <p>s or Last Chapter/Next Chapter <p>s
  while (isEmptyOrGarbage(el.lastElementChild)) {
    el.removeChild(el.lastElementChild);
  }

  // Remove redundant dir="ltr" and align="LEFT" and style="text-align: left;"
  Array.prototype.forEach.call(el.children, function (child) {
    if (child.getAttribute("dir") === "ltr") {
      child.removeAttribute("dir");
    }
    if ((child.getAttribute("align") || "").toLowerCase() === "left") {
      child.removeAttribute("align");
    }
    if (child.getAttribute("style") === "text-align:left;") {
      child.removeAttribute("style");
    }
  });

  // Remove empty <em>s and <i>s
  const ems = el.querySelectorAll("em, i");
  Array.prototype.forEach.call(ems, function (em) {
    if (em.textContent.trim() === "") {
      em.parentNode.removeChild(em);
    }
  });

  return el;
}

function isEmptyOrGarbage(el) {
  const text = el.textContent.trim();
  return text === "" || text.startsWith("Last Chapter") || text.startsWith("Next Chapter");
}
