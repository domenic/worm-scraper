"use strict";
const path = require("path");
const fs = require("mz/fs");
const throat = require("throat");
const serializeToXml = require("xmlserializer").serializeToString;
const jsdom = require("./jsdom.js");
const getChapterTitle = require("./common.js").getChapterTitle;

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
  const title = getChapterTitle(rawChapterDoc);
  const body = getBodyXml(title, rawChapterDoc.querySelector(".entry-content"));

  return `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
  <head>
    <meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8" />
    <title>${title}</title>
  </head>
${body}
</html>`;
}

function getBodyXml(title, contentEl) {
  // Remove initial Next Chapter and Previous Chapter <p>
  contentEl.removeChild(contentEl.firstElementChild);

  // Remove everything after the last <p> (e.g. analytics <div>s)
  const lastP = contentEl.querySelector("p:last-of-type");
  while (contentEl.lastElementChild !== lastP) {
    contentEl.removeChild(contentEl.lastElementChild);
  }

  // Remove empty <p>s or Last Chapter/Next Chapter <p>s
  while (isEmptyOrGarbage(contentEl.lastElementChild)) {
    contentEl.removeChild(contentEl.lastElementChild);
  }

  // Remove redundant attributes
  Array.prototype.forEach.call(contentEl.children, function (child) {
    if (child.getAttribute("dir") === "ltr") {
      child.removeAttribute("dir");
    }

    // Only ever appears with align="LEFT" (useless) or align="CENTER" overridden by style="text-align: left;" (also
    // useless)
    child.removeAttribute("align");

    if (child.getAttribute("style") === "text-align:left;") {
      child.removeAttribute("style");
    }
  });

  // Remove empty <em>s and <i>s
  const ems = contentEl.querySelectorAll("em, i");
  Array.prototype.forEach.call(ems, function (em) {
    if (em.textContent.trim() === "") {
      em.parentNode.removeChild(em);
    }
  });

  // TODO: remove redundant <span id>s inside <p>s

  // Synthesize a <body> tag to serialize
  const bodyEl = contentEl.ownerDocument.createElement("body");
  const h1El = contentEl.ownerDocument.createElement("h1");
  h1El.textContent = title;

  bodyEl.appendChild(h1El);
  while (contentEl.firstChild) {
    bodyEl.appendChild(contentEl.firstChild);
  }

  let xml = serializeToXml(bodyEl);

  // Fix recurring strange pattern of extra <br> in <p>...<em>...<br>\n</em></p>
  xml = xml.replace(/<br\/>\s*<\/em><\/p>/g, '</em></p>');

  // One-off fixes
  xml = xml.replace(/truck reached<br\/>\nthe other Nine/, 'truck reached the other Nine');

  // Serializer inserts extra xmlns for us since it doesn't know we're going to put this into a <html>
  xml = xml.replace(/<body xmlns="http:\/\/www.w3.org\/1999\/xhtml">/, '<body>');

  return xml;
}

function isEmptyOrGarbage(el) {
  const text = el.textContent.trim();
  return text === "" || text.startsWith("Last Chapter") || text.startsWith("Next Chapter");
}
