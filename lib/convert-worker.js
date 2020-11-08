"use strict";
const workerpool = require("workerpool");
const fs = require("fs");
const { JSDOM } = require("jsdom");
const substitutions = require("./substitutions.json");

workerpool.worker({ convertChapter });

function convertChapter(chapter, book, inputPath, outputPath) {
  const contents = fs.readFileSync(inputPath, { encoding: "utf-8" });

  const rawChapterJSDOM = new JSDOM(contents);
  const { output, warnings } = getChapterString(chapter, book, rawChapterJSDOM.window.document);

  // TODO: this should probably not be necessary... jsdom bug I guess!?
  rawChapterJSDOM.window.close();

  fs.writeFileSync(outputPath, output);
  return warnings;
}

function getChapterString(chapter, book, rawChapterDoc) {
  const { xml, warnings } =
    getBodyXML(chapter, book, rawChapterDoc.querySelector(".entry-content"));

  const output = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
  <head>
    <meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8" />
    <title>${chapter.title}</title>
  </head>
${xml}
</html>`;

  return { output, warnings };
}

function getBodyXML(chapter, book, contentEl) {
  const warnings = [];

  // Remove initial Next Chapter and Previous Chapter <p>
  contentEl.firstElementChild.remove();

  // Remove everything after the last <p> (e.g. analytics <div>s)
  const lastP = contentEl.querySelector("p:last-of-type");
  while (contentEl.lastElementChild !== lastP) {
    contentEl.lastElementChild.remove();
  }

  // Remove empty <p>s or Last Chapter/Next Chapter <p>s
  while (isEmptyOrGarbage(contentEl.lastElementChild)) {
    contentEl.lastElementChild.remove();
  }

  // Remove redundant attributes and style
  for (const child of contentEl.children) {
    if (child.getAttribute("dir") === "ltr") {
      child.removeAttribute("dir");
    }

    // Only ever appears with align="LEFT" (useless) or align="CENTER" overridden by style="text-align: left;" (also
    // useless)
    child.removeAttribute("align");

    const style = child.getAttribute("style");
    if (style === "text-align:left;" || style === "text-align: left;") {
      child.removeAttribute("style");
    }

    // Worm uses 30px; Ward mostly uses 40px but sometimes uses 30px/60px. Let's standardize on 30px.
    if (style === "text-align:left;padding-left:30px;" ||
        style === "text-align: left;padding-left: 40px;" ||
        style === "padding-left: 40px;") {
      child.setAttribute("style", "padding-left: 30px;");
    }
  }

  // Remove empty <em>s and <i>s
  // Remove style attributes from them, as they're always messed up.
  for (const em of contentEl.querySelectorAll("em, i")) {
    if (em.textContent.trim() === "") {
      em.replaceWith(contentEl.ownerDocument.createTextNode(" "));
    } else {
      em.removeAttribute("style");
    }
  }

  // In https://parahumans.wordpress.com/2013/01/05/monarch-16-13/ there are some <address>s that should be <p>s O_o
  for (const address of contentEl.querySelectorAll("address")) {
    const p = contentEl.ownerDocument.createElement("p");
    p.innerHTML = address.innerHTML;
    address.replaceWith(p);
  }

  // Every <span> except underline ones is pointless at best and frequently messed up. (Weird font size, line spacing,
  // etc.)
  for (const span of contentEl.querySelectorAll("span")) {
    if (span.getAttribute("style") === "text-decoration:underline;") {
      continue;
    }

    if (span.textContent.trim() === "") {
      span.remove();
    } else {
      const docFrag = contentEl.ownerDocument.createDocumentFragment();
      while (span.firstChild) {
        docFrag.appendChild(span.firstChild);
      }
      span.replaceWith(docFrag);
    }
  }

  // In Ward, CloudFlare email protection obfuscates the email addresses:
  // https://usamaejaz.com/cloudflare-email-decoding/
  for (const emailEl of contentEl.querySelectorAll("[data-cfemail]")) {
    const decoded = decodeCloudFlareEmail(emailEl.dataset.cfemail);
    emailEl.replaceWith(contentEl.ownerDocument.createTextNode(decoded));
  }

  // Synthesize a <body> tag to serialize
  const bodyEl = contentEl.ownerDocument.createElement("body");

  const h1El = contentEl.ownerDocument.createElement("h1");
  h1El.textContent = chapter.title;
  bodyEl.appendChild(h1El);

  while (contentEl.firstChild) {
    bodyEl.appendChild(contentEl.firstChild);
  }

  const xmlSerializer = new contentEl.ownerDocument.defaultView.XMLSerializer();
  let xml = xmlSerializer.serializeToString(bodyEl);

  // Fix recurring strange pattern of extra <br> in <p>...<em>...<br>\n</em></p>
  xml = xml.replace(/<br \/>\s*<\/em><\/p>/g, "</em></p>");

  // Replace single-word <i>s with <em>s. Other <i>s are probably erroneous too, but these are known-bad.
  xml = xml.replace(/<i>([^ ]+)<\/i>/g, "<em>$1</em>");
  xml = xml.replace(/<i>([^ ]+)( +)<\/i>/g, "<em>$1</em>$2");

  // There are way too many nonbreaking spaces where they don't belong.
  // If they show up three in a row, then let them live. Otherwise, they die.
  // Also remove any run of them after a period.
  xml = xml.replace(/([^\xA0])\xA0\xA0?([^\xA0])/g, "$1 $2");
  xml = xml.replace(/\.\x20*\xA0[\xA0\x20]*/, ".  ");

  function fixEms() {
    // Fix recurring broken-up or erroneous <em>s
    xml = xml.replace(/<\/em>‘s/g, "’s</em>");
    xml = xml.replace(/<em><\/em>/g, "");
    xml = xml.replace(/<\/em><em>/g, "");
    xml = xml.replace(/<em>(\s?\s?[^A-Za-z]\s?\s?)<\/em>/g, "$1");
    xml = xml.replace(/<\/em>(\s?\s?[^A-Za-z]\s?\s?)<em>/g, "$1");
    xml = xml.replace(/“<em>([^>]+)<\/em>(!|\?|\.)”/g, "“<em>$1$2</em>”");
    xml = xml.replace(/<p><em>([^>]+)<\/em>(!|\?|\.)<\/p>/g, "<p><em>$1$2</em></p>");
    xml = xml.replace(/(!|\?|\.)\s{2}<\/em><\/p>/g, "$1</em></p>");
    xml = xml.replace(/<em>([a-z]+)(\?|\.)<\/em>/g, "<em>$1</em>$2");
    xml = xml.replace(/<em>([^>]+?)( +)<\/em>/g, "<em>$1</em>$2");
    xml = xml.replace(/<em> ([a-zA-Z]+)<\/em>/g, " <em>$1</em>");
    xml = xml.replace(/<em>‘\s*([^<]+)\s*’<\/em>/g, "‘<em>$1</em>’");
    xml = xml.replace(/<em>‘\s*([^<]+)\s*<\/em>\s*’/g, "‘<em>$1</em>’");
    xml = xml.replace(/‘\s*<em>\s*([^<]+)\s*’<\/em>/g, "‘<em>$1</em>’");
    xml = xml.replace(/<em>“\s*([^<]+)\s*”<\/em>/g, "“<em>$1</em>”");
    xml = xml.replace(/<em>“\s*([^<]+)\s*<\/em>\s*”/g, "“<em>$1</em>”");
    xml = xml.replace(/“\s*<em>\s*([^<]+)\s*”<\/em>/g, "“<em>$1</em>”");
    xml = xml.replace(/([^\n>])<em>  ?/g, "$1 <em>");
    xml = xml.replace(/  ?<\/em>/g, "</em> ");
    xml = xml.replace(/<p([^>]+)> <em>/g, "<p$1><em>");
    xml = xml.replace(/<\/em> <\/p>/g, "</em></p>");
    xml = xml.replace(/<em>([a-z]+),<\/em>/g, "<em>$1</em>,");
  }

  function fixQuotesAndApostrophes() {
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
    xml = xml.replace(/‘Sup/g, "’Sup");
    xml = xml.replace(/‘cuz/g, "’cuz");
    xml = xml.replace(/([a-z])”<\/p>/g, "$1.”</p>");
  }

  // These interact with each other, so do them a few times.
  xml = xml.replace(/,” <\/em>/g, "</em>,” ");
  fixEms();
  fixQuotesAndApostrophes();
  fixEms();
  xml = xml.replace(/‘<em>([^<]+)<\/em>‘/g, "‘<em>$1</em>’");
  xml = xml.replace(/I”m/g, "I’m");

  // Similar problems occur in Ward with <b> and <strong> as do in Worm with <em>s
  xml = xml.replace(/<b \/>/g, "");
  xml = xml.replace(/<b>(\s*<br \/>\s*)<\/b>/g, "$1");
  xml = xml.replace(/<strong>(\s*<br \/>\s*)<\/strong>/g, "$1");
  xml = xml.replace(/<\/strong>(\s*)<strong>/g, "$1");
  xml = xml.replace(/<strong>@<\/strong>/g, "@");
  xml = xml.replace(/<br \/>(\s*)<\/strong>/g, "</strong><br />$1");
  xml = xml.replace(/(\s*)<\/strong>/g, "</strong>$1");

  // No need for line breaks before paragraph ends
  // These often occur with the <br>s inside <b>/<strong>/<em>/<i> fixed above.
  xml = xml.replace(/<br \/>\s*<\/p>/g, "</p>");

  // Fix missing spaces after commas
  xml = xml.replace(/([a-zA-Z]+),([a-zA-Z]+)/g, "$1, $2");

  // Fix bad periods and spacing/markup surrounding them
  xml = xml.replace(/\.\.<\/p>/g, ".</p>");
  xml = xml.replace(/\.\.”<\/p>/g, ".”</p>");
  xml = xml.replace(/ \. /g, ". ");
  xml = xml.replace(/ \.<\/p>/g, ".</p>");
  xml = xml.replace(/\.<em>\.\./g, "<em>…");

  // Fix extra spaces
  xml = xml.replace(/ ? <\/p>/g, "</p>");
  xml = xml.replace(/([a-z]) ,/g, "$1,");

  xml = fixDialogueTags(xml);
  xml = fixForeignNames(xml);
  xml = fixEmDashes(xml);
  xml = enDashJointNames(xml);
  xml = fixPossessives(xml);
  xml = cleanSceneBreaks(xml);
  xml = fixCapitalization(xml, book);
  xml = fixMispellings(xml);
  xml = fixHyphens(xml);
  xml = standardizeSpellings(xml);

  // One-off fixes
  for (const substitution of substitutions[chapter.url] || []) {
    if (substitution.before) {
      const indexOf = xml.indexOf(substitution.before);
      if (indexOf === -1) {
        warnings.push(`Could not find text "${substitution.before}" in ${chapter.url}. The chapter may have been ` +
                      `updated at the source, in which case, you should edit substitutions.json.`);
      }
      if (indexOf !== xml.lastIndexOf(substitution.before)) {
        warnings.push(`The text "${substitution.before}" occurred twice, and so the substitution was ambiguous. ` +
                      `Update substitutions.json for a more precise substitution.`);
      }

      xml = xml.replace(new RegExp(escapeRegExp(substitution.before)), substitution.after);
    } else if (substitution.regExp) {
      xml = xml.replace(new RegExp(substitution.regExp, "g"), substitution.replacement);
    } else {
      warnings.push(`Invalid substitution specified for ${chapter.url}`);
    }
  }

  // Serializer inserts extra xmlns for us since it doesn't know we're going to put this into a <html>.
  // Use this opportunity to insert a comment pointing to the original URL, for reference.
  xml = xml.replace(
    /<body xmlns="http:\/\/www.w3.org\/1999\/xhtml">/,
    `<body>\n<!-- ${chapter.url} -->\n`);

  return { xml, warnings };
}

function fixDialogueTags(xml) {
  // Fix recurring miscapitalization with questions
  xml = xml.replace(/\?”\s\s?She asked/g, "?” she asked");
  xml = xml.replace(/\?”\s\s?He asked/g, "?” he asked");

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

  return xml;
}

function fixForeignNames(xml) {
  // This is consistently missing diacritics
  xml = xml.replace(/Yangban/g, "Yàngbǎn");

  // These are usually not italicized, but sometimes are. Other foreign-language names (like Yàngbǎn) are not
  // italicized, so we go in the direction of removing the italics.
  xml = xml.replace(/<em>Garama<\/em>/g, "Garama");
  xml = xml.replace(/<em>Thanda<\/em>/g, "Thanda");
  xml = xml.replace(/<em>Sifara([^<]*)<\/em>/g, "Sifara$1");
  xml = xml.replace(/<em>Moord Nag([^<]*)<\/em>/g, "Moord Nag$1");
  xml = xml.replace(/<em>Califa de Perro([^<]*)<\/em>/g, "Califa de Perro$1");
  xml = xml.replace(/<em>Turanta([^<]*)<\/em>/g, "Turanta$1");

  return xml;
}

function fixEmDashes(xml) {
  xml = xml.replace(/ – /g, "—");
  xml = xml.replace(/“((?:<em>)?)-/g, "“$1—");
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
  xml = xml.replace(/I-I/g, "I—I");
  xml = xml.replace(/I-uh/g, "I—uh");

  return xml;
}

function enDashJointNames(xml) {
  // Joint names should use en dashes
  xml = xml.replace(/Dallon-Pelham/g, "Dallon–Pelham");
  xml = xml.replace(/Bet-Gimel/g, "Bet–Gimel");
  xml = xml.replace(/Tristan-Capricorn/g, "Tristan–Capricorn");
  xml = xml.replace(/Capricorn-Byron/g, "Capricorn–Byron");
  xml = xml.replace(/Tristan-Byron/g, "Tristan–Byron");
  xml = xml.replace(/Gimel-Europe/g, "Gimel–Europe");
  xml = xml.replace(/G-N/g, "G–N");
  xml = xml.replace(/Imp-Damsel/g, "Imp–Damsel");
  xml = xml.replace(/Damsel-Ashley/g, "Damsel–Ashley");
  xml = xml.replace(/Antares-Anelace/g, "Antares–Anelace");
  xml = xml.replace(/Challenger-Gallant/g, "Challenger–Gallant");
  xml = xml.replace(/Undersider(s?)-(Breakthrough|Ambassador)/g, "Undersider$1–$2");
  xml = xml.replace(/Norwalk-Fairfield/g, "Norwalk–Fairfield");
  xml = xml.replace(/East-West/g, "east–west");
  xml = xml.replace(/(Green|Yellow)-Black/g, "$1–Black");
  xml = xml.replace(/Creutzfeldt-Jakob/g, "Creutzfeldt–Jakob");
  xml = xml.replace(/Astaroth-Nidhug/g, "Astaroth–Nidhug");
  xml = xml.replace(/Capulet-Montague/g, "Capulet–Montague");
  xml = xml.replace(/Weaver-Clockblocker/g, "Weaver–Clockblocker");
  xml = xml.replace(/Alexandria-Pretender/g, "Alexandria–Pretender");
  xml = xml.replace(/Night Hag-Nyx/g, "Night Hag–Nyx");
  xml = xml.replace(/Crawler-Breed/g, "Crawler–Breed");
  xml = xml.replace(/Simurgh-Myrddin-plant/g, "Simurgh–Myrddin–plant");
  xml = xml.replace(/Armsmaster-Defiant/g, "Armsmaster–Defiant");

  return xml;
}

function fixPossessives(xml) {
  // Fix possessive of names ending in "s"
  // Note: if the "s" is unvoiced, as in Marquis, then it doesn't get the second "s".
  xml = xml.replace(/([^‘])Judas’([^s])/g, "$1Judas’s$2");
  xml = xml.replace(/([^‘])Brutus’([^s])/g, "$1Brutus’s$2");
  xml = xml.replace(/([^‘])Jess’([^s])/g, "$1Jess’s$2");
  xml = xml.replace(/([^‘])Aegis’([^s])/g, "$1Aegis’s$2");
  xml = xml.replace(/([^‘])Dauntless’([^s])/g, "$1Dauntless’s$2");
  xml = xml.replace(/([^‘])Circus’([^s])/g, "$1Circus’s$2");
  xml = xml.replace(/([^‘])Sirius’([^s])/g, "$1Sirius’s$2");
  xml = xml.replace(/([^‘])Brooks’([^s])/g, "$1Brooks’s$2");
  xml = xml.replace(/([^‘])Genesis’([^s])/g, "$1Genesis’s$2");
  xml = xml.replace(/([^‘])Atlas’([^s])/g, "$1Atlas’s$2");
  xml = xml.replace(/([^‘])Lucas’([^s])/g, "$1Lucas’s$2");
  xml = xml.replace(/([^‘])Gwerrus’([^s])/g, "$1Gwerrus’s$2");
  xml = xml.replace(/([^‘])Chris’([^s])/g, "$1Chris’s$2");
  xml = xml.replace(/([^‘])Eligos’([^s])/g, "$1Eligos’s$2");
  xml = xml.replace(/([^‘])Animos’([^s])/g, "$1Animos’s$2");
  xml = xml.replace(/([^‘])Mags’([^s])/g, "$1Mags’s$2");
  xml = xml.replace(/([^‘])Huntress’([^s])/g, "$1Huntress’s$2");
  xml = xml.replace(/([^‘])Hephaestus’([^s])/g, "$1Hephaestus’s$2");
  xml = xml.replace(/([^‘])Lord of Loss’([^s])/g, "$1Lord of Loss’s$2");
  xml = xml.replace(/([^‘])John Combs’([^s])/g, "$1John Combs’s$2");
  xml = xml.replace(/([^‘])Mama Mathers’([^s])/g, "$1Mama Mathers’s$2");
  xml = xml.replace(/([^‘])Monokeros’([^s])/g, "$1Monokeros’s$2");
  xml = xml.replace(/([^‘])Goddess’([^s])/g, "$1Goddess’s$2");
  xml = xml.replace(/([^‘])Boundless’([^s])/g, "$1Boundless’s$2");
  xml = xml.replace(/([^‘])Paris’([^s])/g, "$1Paris’s$2");
  xml = xml.replace(/([^‘])Tress’([^s])/g, "$1Tress’s$2");
  xml = xml.replace(/([^‘])Harris’([^s])/g, "$1Harris’s$2");
  xml = xml.replace(/([^‘])Antares’([^s])/g, "$1Antares’s$2");
  xml = xml.replace(/([^‘])Nieves’([^s])/g, "$1Nieves’s$2");
  xml = xml.replace(/([^‘])Backwoods’([^s])/g, "$1Backwoods’s$2");
  xml = xml.replace(/([^‘])Midas’([^s])/g, "$1Midas’s$2");
  xml = xml.replace(/([^‘])Mrs. Sims’([^s])/g, "$1Mrs. Sims’s$2");
  xml = xml.replace(/([^‘])Ms. Stillons’([^s])/g, "$1Ms. Stillons’s$2");
  xml = xml.replace(/([^‘])Chuckles’([^s])/g, "$1Chuckles’s$2");

  // This one is not just missing the extra "s"; it's often misplaced.
  xml = xml.replace(/Warden’s/g, "Wardens’");

  return xml;
}

function cleanSceneBreaks(xml) {
  // Normalize scene breaks. <hr> would be more semantically appropriate, but loses the author's intent. This is
  // especially the case in Ward, which uses a variety of different scene breaks.

  xml = xml.replace(/<p(?:[^>]*)>■<\/p>/g, `<p style="text-align: center;">■</p>`);

  xml = xml.replace(/<p style="text-align: center;"><strong>⊙<\/strong><\/p>/g, `<p style="text-align: center;">⊙</p>`);
  xml = xml.replace(/<p style="text-align: center;"><em><strong>⊙<\/strong><\/em><\/p>/g,
    `<p style="text-align: center;">⊙</p>`);
  xml = xml.replace(/<p style="text-align: center;"><strong>⊙⊙<\/strong><\/p>/g,
    `<p style="text-align: center;">⊙</p>`);

  xml = xml.replace(/<p style="text-align: center;"><strong>⊙ *⊙ *⊙ *⊙ *⊙<\/strong><\/p>/g,
    `<p style="text-align: center;">⊙ ⊙ ⊙ ⊙ ⊙</p>`);

  return xml;
}

function fixCapitalization(xml, book) {
  // This occurs enough times it's better to do here than in one-off fixes. We correct the single instance where
  // it's incorrect to capitalize in the one-off fixes.
  // Note that Ward contains much talk of "the clairvoyants", so we don't want to capitalize plurals.
  xml = xml.replace(/([Tt])he clairvoyant([^s])/g, "$1he Clairvoyant$2");

  // ReSound's name is sometimes miscapitalized. The word is never used in a non-name context.
  xml = xml.replace(/Resound/g, "ReSound");

  // "patrol block" is capitalized three different ways: "patrol block", "Patrol block", and "Patrol Block". "patrol
  // group" is always lowercased. It seems like "Patrol" is a proper name, and is used as a capitalized modifier in
  // other contexts (e.g. Patrol leader). So let's standardize on "Patrol <lowercase>".
  xml = xml.replace(/patrol (block|group|leader|guard|student|uniform|squad|soldier|officer|crew|girl|bus)/ig,
    (_, $1) => `Patrol ${$1.toLowerCase()}`);
  // This always works in Ward and has a few false positives in Worm, where it is never needed:
  if (book === "ward") {
    xml = xml.replace(/the patrol/g, "the Patrol");
  }

  // This is sometimes missing its capitalization.
  xml = xml.replace(/the birdcage/g, "the Birdcage");

  // There's no reason why these should be capitalized. (Note that they never appear at the beginning of any sentences.)
  xml = xml.replace(/Halberd/g, "halberd");
  xml = xml.replace(/Loft/g, "loft");

  // Especially early in the story, PRT designations are capitalized; they should not be. This fixes the cases where we
  // can be reasonably sure they don't start a sentence, although more specific instances are done in
  // substitutions.json, and some need to be back-corrected.
  //
  // Note: "Master" is specifically omitted because it fails poorly on Interlude 4. Other instances need to be
  // corrected via substitutions.json.
  xml = xml.replace(
    /([a-zA-Z,] |\/)(Mover|Shaker|Brute|Breaker|Tinker|Blaster|Thinker|Striker|Changer|Trump|Stranger|Shifter|Shaper)/g,
    (_, prefix, designation) => prefix + designation.toLowerCase()
  );
  xml = xml.replace(
    /(mover|shaker|brute|breaker|tinker|blaster|thinker|master|striker|changer|trump|stranger|shifter|shaper)-(\d+)/gi,
    "$1 $2"
  );
  xml = xml.replace(
    // eslint-disable-next-line max-len
    /(mover|shaker|brute|breaker|tinker|blaster|thinker|master|striker|changer|trump|stranger|shifter|shaper)[ -/](mover|shaker|brute|breaker|tinker|blaster|thinker|master|striker|changer|trump|stranger|shifter|shaper)/gi,
    "$1–$2"
  );

  // Place names need to always be capitalized
  xml = xml.replace(/North end/g, "North End");
  xml = xml.replace(/(Stonemast|Shale) avenue/g, "$1 Avenue");
  xml = xml.replace(/(Lord|Slater) street/g, "$1 Street");
  xml = xml.replace(/(Hollow|Cedar) point/g, "$1 Point");
  xml = xml.replace(/(Norwalk|Fenway|Stratford) station/g, "$1 Station");
  xml = xml.replace(/the megalopolis/g, "the Megalopolis");
  xml = xml.replace(/earths(?![a-z])/g, "Earths");

  // "Mom" and "Dad" should be capitalized when used as a proper name. These regexps are tuned to catch a good amount of
  // instances, without over-correcting for non-proper-name-like cases. Many other instances are handled in
  // substitutions.json.
  xml = xml.replace(/(?<!mom), dad(?![a-z])/g, ", Dad");
  xml = xml.replace(/, mom(?![a-z-])/g, ", Mom");

  // The majority of "Wardens’ headquarters" is lowercased, and always prefixed with "the", indicating it's not a proper
  // place name. So we remove the capitalization in the few places where it does appear.
  xml = xml.replace(/Wardens’ Headquarters/g, "Wardens’ headquarters");

  return xml;
}

function fixMispellings(xml) {
  // This is commonly misspelled.
  xml = xml.replace(/([Ss])houlderblade/g, "$1houlder blade");

  // Preemptive(ly) is often hyphenated (not always). It should not be.
  xml = xml.replace(/([Pp])re-emptive/g, "$1reemptive");

  return xml;
}

function fixHyphens(xml) {
  // "X-year-old" should use hyphens; all grammar guides agree. The books are very inconsistent but most often omit
  // them.
  xml = xml.replace(/(\w+)[ -]year[ -]old(s?)(?!\w)/g, "$1-year-old$2");
  xml = xml.replace(/(\w+) or (\w+)-year-old/g, "$1- or $2-year-old");

  // These are consistently missing hyphens.
  xml = xml.replace(/self destruct/g, "self-destruct");
  xml = xml.replace(/life threatening/g, "life-threatening");
  xml = xml.replace(/hard headed/g, "hard-headed");
  xml = xml.replace(/shoulder mounted/g, "shoulder-mounted");
  xml = xml.replace(/golden skinned/g, "golden-skinned");
  xml = xml.replace(/creepy crawl/g, "creepy-crawl");
  xml = xml.replace(/well armed/g, "well-armed");
  xml = xml.replace(/able bodied/g, "able-bodied");

  return xml;
}

function standardizeSpellings(xml) {
  // This is usually spelled "TV" but sometimes the other ways. Normalize.
  xml = xml.replace(/(\b)tv(\b)/g, "$1TV$2");
  xml = xml.replace(/t\.v\./ig, "TV");

  // "okay" is preferred to "ok" or "o.k.". This sometimes gets changed back via substitutions.json when people are
  // writing notes and thus probably the intention was to be less formal. Also it seems per
  // https://en.wikipedia.org/wiki/A-ok the "A" in "A-okay" should be capitalized.
  xml = xml.replace(/Ok([,. ])/g, "Okay$1");
  xml = xml.replace(/([^a-zA-Z])ok([^a])/g, "$1okay$2");
  xml = xml.replace(/([^a-zA-Z])o\.k\.([^a])/g, "$1okay$2");
  xml = xml.replace(/a-okay/g, "A-okay");

  // Signal(l)ing/signal(l)ed are spelled both ways. Both are acceptable in English. Let's standardize on single-L.
  xml = xml.replace(/(S|s)ignall/g, "$1ignal");

  // Clich(e|é) is spelled both ways. Let's standardize on including the accent.
  xml = xml.replace(/cliche/g, "cliché");

  // T-shirt is usually spelled lowercase ("t-shirt"). Normalize the remaining instances.
  xml = xml.replace(/T-shirt/g, "t-shirt");

  // "gray" is the majority spelling, except for "greyhound"
  xml = xml.replace(/(G|g)rey(?!hound)/g, "$1ray");

  return xml;
}

function isEmptyOrGarbage(el) {
  const text = el.textContent.trim();
  return text === "" ||
         text.startsWith("Last Chapter") ||
         text.startsWith("Previous Chapter") ||
         text.startsWith("Next Chapter");
}

function escapeRegExp(str) {
  return str.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
}

function decodeCloudFlareEmail(hash) {
  let email = "";
  const xorWithThis = parseInt(hash.substring(0, 2), 16);
  for (let i = 2; i < hash.length; i += 2) {
    const charCode = parseInt(hash.substring(i, i + 2), 16) ^ xorWithThis;
    email += String.fromCharCode(charCode);
  }

  return email;
}
