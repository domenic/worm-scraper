"use strict";
const path = require("path");
const fs = require("mz/fs");
const throat = require("throat");
const serializeToXML = require("xmlserializer").serializeToString;
const { JSDOM } = require("jsdom");
const substitutions = require("./substitutions.json");

module.exports = async (cachePath, manifestPath, contentPath) => {
  const manifestContents = await fs.readFile(manifestPath, { encoding: "utf-8" });
  const chapters = JSON.parse(manifestContents);
  console.log("All chapters downloaded; beginning conversion to EPUB chapters");

  const mapper = throat(10, chapter => convertChapter(chapter, cachePath, contentPath));
  await Promise.all(chapters.map(mapper));

  console.log("All chapters converted");
};

async function convertChapter(chapter, cachePath, contentPath) {
  const filename = chapter.filename;
  const filePath = path.resolve(cachePath, filename);

  const contents = await fs.readFile(filePath, { encoding: "utf-8" });

  const rawChapterJSDOM = new JSDOM(contents);
  const output = getChapterString(chapter, rawChapterJSDOM.window.document);

  // TODO: this should probably not be necessary... jsdom bug I guess!?
  rawChapterJSDOM.window.close();

  const destFileName = `${path.basename(filename, ".html")}.xhtml`;
  const destFilePath = path.resolve(contentPath, destFileName);

  await fs.writeFile(destFilePath, output);
  console.log(`- Finished converting ${filename}`);
}

function getChapterString(chapter, rawChapterDoc) {
  const body = getBodyXML(chapter, rawChapterDoc.querySelector(".entry-content"));

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

function getBodyXML(chapter, contentEl) {
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
  Array.prototype.forEach.call(contentEl.children, child => {
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
  Array.prototype.forEach.call(ems, em => {
    if (em.textContent.trim() === "") {
      const replacement = contentEl.ownerDocument.createTextNode(" ");
      em.parentNode.replaceChild(replacement, em);
    } else {
      em.removeAttribute("style");
    }
  });

  // In https://parahumans.wordpress.com/2013/01/05/monarch-16-13/ there are some <address>s that should be <p>s O_o
  const addresses = contentEl.querySelectorAll("address");
  Array.prototype.forEach.call(addresses, address => {
    const p = contentEl.ownerDocument.createElement("p");
    p.innerHTML = address.innerHTML;
    address.parentNode.replaceChild(p, address);
  });

  // Every <span> except underline ones is pointless at best and frequently messed up. (Weird font size, line spacing,
  // etc.)
  const spans = contentEl.querySelectorAll("span");
  Array.prototype.forEach.call(spans, span => {
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

  let xml = serializeToXML(bodyEl);

  // Fix recurring strange pattern of extra <br> in <p>...<em>...<br>\n</em></p>
  xml = xml.replace(/<br\/>\s*<\/em><\/p>/g, "</em></p>");

  // There are way too many nonbreaking spaces where they don't belong.
  // If they show up three in a row, then let them live. Otherwise, they die.
  xml = xml.replace(/([^\xA0])\xA0\xA0?([^\xA0])/g, "$1 $2");

  // Fix recurring broken-up or erroneous <em>s
  xml = xml.replace(/<\/em>‘s/g, "’s</em>");
  xml = xml.replace(/<\/em><em>/g, "");
  xml = xml.replace(/<em>(\s?\s?[^A-Za-z]\s?\s?)<\/em>/g, "$1");
  xml = xml.replace(/<\/em>(\s?\s?[^A-Za-z]\s?\s?)<em>/g, "$1");
  xml = xml.replace(/“<em>([^>]+)<\/em>(!|\?|\.)”/g, "“<em>$1$2</em>”");
  xml = xml.replace(/<p><em>([^>]+)<\/em>(!|\?|\.)<\/p>/g, "<p><em>$1$2</em></p>");
  xml = xml.replace(/(!|\?|\.)\s{2}<\/em><\/p>/g, "$1</em></p>");
  xml = xml.replace(/<em>([a-z]+)\?<\/em>/g, "<em>$1</em>?");
  xml = xml.replace(/<em>([^>]+?)( +)<\/em>/g, "<em>$1</em>$2");
  xml = xml.replace(/<p>“<em>([^>]+)”<\/em><\/p>/g, "<p>“<em>$1</em>”</p>");
  xml = xml.replace(/<em> ([a-zA-Z]+)<\/em>/g, " <em>$1</em>");
  xml = xml.replace(/<em>‘([^<]+)’<\/em>/g, "‘<em>$1</em>’");
  xml = xml.replace(/<em>‘([^<]+)<\/em>’/g, "‘<em>$1</em>’");
  xml = xml.replace(/‘<em>([^<]+)’<\/em>/g, "‘<em>$1</em>’");

  // Fix recurring poor quotes and apostrophes
  xml = xml.replace(/<p>”/g, "<p>“");
  xml = xml.replace(/“\s*<\/p>/g, "”</p>");
  xml = xml.replace(/“\s*<\/em><\/p>/g, "</em>”</p>");
  xml = xml.replace(/‘\s*<\/p>/g, "’</p>");
  xml = xml.replace(/‘\s*<\/em><\/p>/g, "’</em></p>");
  xml = xml.replace(/,” <\/em>/g, "</em>,” ");
  xml = xml.replace(/′/g, "’");
  xml = xml.replace(/″/g, "”");
  xml = xml.replace(/([A-Za-z])‘s(\s?)/g, "$1’s$2");
  xml = xml.replace(/I‘m/g, "I’m");
  xml = xml.replace(/<p>“\s+/g, "<p>“");
  xml = xml.replace(/'/g, "’");
  xml = xml.replace(/’([A-Za-z]+)’/g, "‘$1’");

  // Fix possessive of names ending in "s"
  xml = xml.replace(/Judas’([^s])/g, "Judas’s$1");
  xml = xml.replace(/Brutus’([^s])/g, "Brutus’s$1");
  xml = xml.replace(/Jess’([^s])/g, "Jess’s$1");

  // Fixes dashes
  xml = xml.replace(/ – /g, "—");
  xml = xml.replace(/“-/g, "“—");
  xml = xml.replace(/-[,.]?”/g, "—”");
  xml = xml.replace(/-(!|\?)”/g, "—$1”");
  xml = xml.replace(/-[,.]?<\/em>”/g, "—</em>”");
  xml = xml.replace(/-“/g, "—”");
  xml = xml.replace(/<p>-/g, "<p>—");
  xml = xml.replace(/-<\/p>/g, "—</p>");
  xml = xml.replace(/-<\/em><\/p>/g, "—</em></p>");
  xml = xml.replace(/\s?\s?–\s?\s?/g, "—");
  xml = xml.replace(/-\s\s?/g, "—");
  xml = xml.replace(/\s?\s-/g, "—");
  xml = xml.replace(/\s+—”/g, "—”");
  xml = xml.replace(/I-I”/g, "I—I");
  xml = xml.replace(/I-uh”/g, "I—uh");

  // Use <hr> for separators
  xml = xml.replace(/<p>■<\/p>/g, "<hr/>");
  xml = xml.replace(/<p style="text-align:center;">■<\/p>/g, "<hr/>");

  // Fix recurring miscapitalization with questions
  xml = xml.replace(/\?”\s\s?She asked/g, "?” she asked");
  xml = xml.replace(/\?”\s\s?He asked/g, "?” he asked");

  // Fix extra periods at the end of paragraphs
  xml = xml.replace(/\.\.<\/p>/g, ".</p>");

  // The author often fails to terminate a sentence, instead using a comma after a dialogue tag. For example,
  // > “I didn’t get much done,” Greg said, “I got distracted by...
  // This should instead be
  // > “I didn’t get much done,” Greg said. “I got distracted by...
  //
  // Our heuristic is to try to automatically fix this if the dialogue tag is two words (X said/admitted/sighed/etc.).
  //
  // This sometimes overcorrects, as in the following example:
  // > “Basically,” Alec said, “For your powers to manifest, ...
  // Here instead we should lowercase the "f". We handle that via one-offs in substitutions.json.
  //
  // This applies to ~800 instances, so although we have to correct back in substitutions.json a decent number of
  // times, it definitely pays for itself. Most of the instances we have to correct back we also need to fix the
  // capitalization anyway, and that's harder to do automatically, since proper names/"I"/etc. stay capitalized.
  xml = xml.replace(/,” ([A-Za-z]+ [A-Za-z]+), “([A-Z])/g, ",” $1. “$2");

  // Replace single-word <i>s with <em>s. Other <i>s are probably erroneous too, but these are known-bad.
  xml = xml.replace(/<i>([A-Za-z]+)<\/i>/g, "<em>$1</em>");

  // This occurs enough times it's better to do here than in one-off fixes. We correct the single instance where
  // it's incorrect to capitalize in the one-off fixes.
  xml = xml.replace(/the clairvoyant/g, "the Clairvoyant");

  // This is sometimes missing its capitalization
  xml = xml.replace(/the birdcage/g, "the Birdcage");

  // This is consistently missing accents
  xml = xml.replace(/Yangban/g, "Yàngbǎn");

  // These are usually not italicized, but sometimes are. Other foreign-language names (like Yàngbǎn) are not
  // italicized, so we go in the direction of removing the italics.
  xml = xml.replace(/<em>Thanda<\/em>/g, "Thanda");
  xml = xml.replace(/<em>Sifara([^<]*)<\/em>/g, "Sifara$1");

  // One-off fixes
  (substitutions[chapter.url] || []).forEach(substitution => {
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
  return str.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
}
