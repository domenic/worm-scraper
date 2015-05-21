"use strict";
const path = require("path");
const fs = require("mz/fs");
const throat = require("throat");
const serializeToXml = require("xmlserializer").serializeToString;
const jsdom = require("./jsdom.js");
const substitutions = require("./substitutions.json");

module.exports = function (cachePath, manifestPath, contentPath) {
  return fs.readFile(manifestPath, { encoding: "utf-8" }).then(function (manifestContents) {
    const chapters = JSON.parse(manifestContents);
    console.log("All chapters downloaded; beginning conversion to EPUB chapters");

    const mapper = throat(10, function (chapter) {
      return convertChapter(chapter, cachePath, contentPath);
    });
    return Promise.all(chapters.map(mapper));
  })
  .then(function () {
    console.log("All chapters converted");
  });
};

function convertChapter(chapter, cachePath, contentPath) {
  const filename = chapter.filename;
  const filePath = path.resolve(cachePath, filename);

  console.log(`- Reading ${filename}`);
  return fs.readFile(filePath, { encoding: "utf-8" }).then(function (contents) {
    console.log(`- Read ${filename}`);
    const rawChapterDoc = jsdom(contents);
    const output = getChapterString(chapter, rawChapterDoc);

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

function getChapterString(chapter, rawChapterDoc) {
  const body = getBodyXml(chapter, rawChapterDoc.querySelector(".entry-content"));

  return `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
  <head>
    <meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8" />
    <title>${chapter.title}</title>
  </head>
${body}
</html>`;
}

function getBodyXml(chapter, contentEl) {
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
  // Remove style attributes from them, as they're always messed up.
  const ems = contentEl.querySelectorAll("em, i");
  Array.prototype.forEach.call(ems, function (em) {
    if (em.textContent.trim() === "") {
      const replacement = contentEl.ownerDocument.createTextNode(" ");
      em.parentNode.replaceChild(replacement, em);
    } else {
      em.removeAttribute("style");
    }
  });

  // In https://parahumans.wordpress.com/2013/01/05/monarch-16-13/ there are some <address>s that should be <p>s O_o
  const addresses = contentEl.querySelectorAll("address");
  Array.prototype.forEach.call(addresses, function (address) {
    const p = contentEl.ownerDocument.createElement("p");
    p.innerHTML = address.innerHTML;
    address.parentNode.replaceChild(p, address);
  });

  // Every <span> except underline ones is pointless at best and frequently messed up. (Weird font size, line spacing,
  // etc.)
  const spans = contentEl.querySelectorAll("span");
  Array.prototype.forEach.call(spans, function (span) {
    if (span.getAttribute("style") === "text-decoration:underline;") {
      return;
    }

    if (span.textContent.trim() === "") {
      span.parentNode.removeChild(span);
    } else {
      const docFrag = contentEl.ownerDocument.createDocumentFragment();
      while (span.firstChild) {
        docFrag.appendChild(span.firstChild);
      }
      span.parentNode.replaceChild(docFrag, span);
    }
  });


  // Synthesize a <body> tag to serialize
  const bodyEl = contentEl.ownerDocument.createElement("body");
  const h1El = contentEl.ownerDocument.createElement("h1");
  h1El.textContent = chapter.title;

  bodyEl.appendChild(h1El);
  while (contentEl.firstChild) {
    bodyEl.appendChild(contentEl.firstChild);
  }

  let xml = serializeToXml(bodyEl);

  // Fix recurring strange pattern of extra <br> in <p>...<em>...<br>\n</em></p>
  xml = xml.replace(/<br\/>\s*<\/em><\/p>/g, "</em></p>");

  // There are way too many nonbreaking spaces where they don't belong.
  // If they show up three in a row, then let them live. Otherwise, they die.
  xml = xml.replace(/([^\xA0])\xA0\xA0?([^\xA0])/g, "$1 $2");

  // Fix recurring broken-up or erroneous <em>s
  xml = xml.replace(/<\/em>‘s/g, "’s</em>")
  xml = xml.replace(/<\/em><em>/g, "");
  xml = xml.replace(/<em>(\s?\s?[^A-Za-z]\s?\s?)<\/em>/g, "$1");
  xml = xml.replace(/<\/em>(\s?\s?[^A-Za-z]\s?\s?)<em>/g, "$1");
  xml = xml.replace(/“<em>([^>]+)<\/em>(!|\?|\.)”/g, "“<em>$1$2<\/em>”");
  xml = xml.replace(/<p><em>([^>]+)<\/em>(!|\?|\.)<\/p>/g, "<p><em>$1$2<\/em></p>");
  xml = xml.replace(/(!|\?|\.)  <\/em><\/p>/g, "$1</em></p>");

  // Fix recurring poor quotes and apostrophes
  xml = xml.replace(/“\s*<\/p>/g, "”</p>");
  xml = xml.replace(/“\s*<\/em><\/p>/g, "”</em></p>");
  xml = xml.replace(/‘\s*<\/p>/g, "’</p>");
  xml = xml.replace(/‘\s*<\/em><\/p>/g, "’</em></p>");
  xml = xml.replace(/′/g, "’");
  xml = xml.replace(/([A-Za-z])‘s(\s?)/g, "$1’s$2");
  xml = xml.replace(/I‘m/g, "I’m");

  // Fixes dashes
  xml = xml.replace(/ – /g, "—");
  xml = xml.replace(/“-/g, "“—");
  xml = xml.replace(/-”/g, "—”");
  xml = xml.replace(/-.”/g, "—”");
  xml = xml.replace(/-“/g, "—”");
  xml = xml.replace(/<p>-/g, "<p>—");
  xml = xml.replace(/-<\/p>/g, "—</p>");
  xml = xml.replace(/\s?\s?–\s?\s?/g, "—");
  xml = xml.replace(/-\s\s?/g, "—");
  xml = xml.replace(/\s?\s-/g, "—");

  // Fix recurring miscapitalization with questions
  xml = xml.replace(/\?”\s\s?She asked/g, "?” she asked");
  xml = xml.replace(/\?”\s\s?He asked/g, "?” he asked");

  // Fix extra periods at the end of paragraphs
  xml = xml.replace(/\.\.<\/p>/g, ".</p>");

  // Replace single-word <i>s with <em>s. Other <i>s are probably erroneous too, but these are known-bad.
  xml = xml.replace(/<i>([A-Za-z]+)<\/i>/g, "<em>$1</em>");

  // One-off fixes
  (substitutions[chapter.url] || []).forEach(function (substitution) {
    const indexOf = xml.indexOf(substitution.before);
    if (indexOf === -1) {
      console.warn(`Could not find text "${substitution.before}" in ${chapter.url}. The chapter may have been ` +
                   `updated at the source, in which case, you should edit substitutions.json.`);
    }
    if (indexOf !== xml.lastIndexOf(substitution.before)) {
      console.warn(`The text "${substitution.before}" occurred twice, and so the substitution was ambiguous. ` +
                   `Update substitutions.json for a more precise substitution.`);
    }

    xml = xml.replace(new RegExp(escapeRegExp(substitution.before)), substitution.after);
  });

  // Serializer inserts extra xmlns for us since it doesn't know we're going to put this into a <html>
  xml = xml.replace(/<body xmlns="http:\/\/www.w3.org\/1999\/xhtml">/, "<body>");

  return xml;
}

function isEmptyOrGarbage(el) {
  const text = el.textContent.trim();
  return text === "" || text.startsWith("Last Chapter") || text.startsWith("Next Chapter");
}

function escapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}
