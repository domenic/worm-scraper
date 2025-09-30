"use strict";
const workerpool = require("workerpool");
const fs = require("fs");
const { JSDOM } = require("jsdom");

workerpool.worker({ convertChapter });

function convertChapter(chapter, bookTitle, inputPath, outputPath, chapterSubstitutions) {
  const contents = fs.readFileSync(inputPath, { encoding: "utf-8" });

  const rawChapterJSDOM = new JSDOM(contents);
  const { output, warnings } = getChapterString(
    chapter,
    bookTitle,
    chapterSubstitutions,
    rawChapterJSDOM.window.document
  );

  // TODO: this should probably not be necessary... jsdom bug I guess!?
  rawChapterJSDOM.window.close();

  fs.writeFileSync(outputPath, output);
  return warnings;
}

function getChapterString(chapter, bookTitle, chapterSubstitutions, rawChapterDoc) {
  const { xml, warnings } =
    getBodyXML(chapter, bookTitle, chapterSubstitutions, rawChapterDoc.querySelector(".entry-content"));

  const output = `<?xml version="1.0" encoding="utf-8" ?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en"
      itemscope="itemscope" itemtype="https://schema.org/Chapter"
      itemid="${chapter.url}" class="chapter ${bookTitle}">
  <head>
    <meta charset="utf-8"/>
    <title>${chapter.usedTitle}</title>
    <meta itemprop="datePublished" content="${chapter.datePublished}"/>
    <link rel="stylesheet" href="../chapter.css"/>
  </head>
${xml}
</html>`;

  return { output, warnings };
}

function getBodyXML(chapter, bookTitle, chapterSubstitutions, contentEl) {
  const warnings = [];

  // Remove initial Next Chapter and Previous Chapter <p>
  contentEl.firstElementChild.remove();

  // Remove everything after the last <p> (e.g. analytics <div>s)
  const lastP = contentEl.querySelector("p:last-of-type");
  while (contentEl.lastElementChild !== lastP) {
    contentEl.lastElementChild.remove();
  }

  // Remove empty <p>s or Last Chapter/Next Chapter <p>s
  while (isEmptyOrGarbage(contentEl.firstChild)) {
    contentEl.firstChild.remove();
  }
  while (isEmptyOrGarbage(contentEl.lastChild)) {
    contentEl.lastChild.remove();
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
        style === "text-align: left; padding-left: 40px;" ||
        style === "padding-left: 40px;") {
      child.setAttribute("style", "padding-left: 30px;");
    }
  }

  // Remove empty inline elements.
  // Remove style attributes from inline elements, as they're always messed up.
  for (const el of contentEl.querySelectorAll("em, i, strong, b")) {
    const { textContent } = el;

    if (textContent === "") {
      el.remove();
    } else if (textContent.trim() === "") {
      if (el.childElementCount === 0) {
        el.replaceWith(" ");
      } else if (el.childElementCount === 1 && el.children[0].localName === "br") {
        el.outerHTML = "<br />\n";
      }
    } else {
      el.removeAttribute("style");
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
    const style = span.getAttribute("style");
    if (style === "text-decoration:underline;" || style === "text-decoration: underline;") {
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
  h1El.textContent = chapter.usedTitle;
  bodyEl.append(h1El, "\n\n");

  while (contentEl.firstChild) {
    bodyEl.append(contentEl.firstChild);
  }
  bodyEl.append("\n");

  const xmlSerializer = new contentEl.ownerDocument.defaultView.XMLSerializer();
  let xml = xmlSerializer.serializeToString(bodyEl);

  // Fix recurring strange pattern of extra <br> in <p>...<em>...<br>\n</em></p>
  xml = xml.replace(/<br \/>\s*<\/em><\/p>/vg, "</em></p>");

  // Replace single-word <i>s with <em>s. Other <i>s are probably erroneous too, but these are known-bad.
  xml = xml.replace(/<i>([^ ]+)<\/i>/vg, "<em>$1</em>");
  xml = xml.replace(/<i>([^ ]+)( +)<\/i>/vg, "<em>$1</em>$2");

  // There are way too many nonbreaking spaces where they don't belong. If they show up three in a row, then let them
  // live; they're maybe being used for alignment or something. Otherwise, they die.
  //
  // Also, normalize spaces after a period/quote mark to two (normal) spaces. The second one is invisible when
  // rendered, but it helps future heuristics detect end of sentences.
  xml = xml.replace(/\xA0{1,2}(?!\x20\xA0)/vg, " ");
  xml = xml.replace(/([.”])\x20*\xA0[\xA0\x20]*/vg, "$1  ");
  xml = xml.replace(/([.”])\x20{3,}/vg, "$1  ");

  function fixEms() {
    // Fix recurring broken-up or erroneous <em>s
    xml = xml.replace(/<\/em>‘s/vg, "’s</em>");
    xml = xml.replace(/<em><\/em>/vg, "");
    xml = xml.replace(/<\/em><em>/vg, "");
    xml = xml.replace(/<em>(\s?\s?[^A-Za-z]\s?\s?)<\/em>/vg, "$1");
    xml = xml.replace(/<\/em>(\s?\s?[^A-Za-z]\s?\s?)<em>/vg, "$1");
    xml = xml.replace(/“<em>([^>]+)<\/em>(!|\?|\.)”/vg, "“<em>$1$2</em>”");
    xml = xml.replace(/<p><em>([^>]+)<\/em>(!|\?|\.)<\/p>/vg, "<p><em>$1$2</em></p>");
    xml = xml.replace(/(!|\?|\.)\s{2}<\/em><\/p>/vg, "$1</em></p>");
    xml = xml.replace(/<em>([a-z]+)(\?|\.)<\/em>/vg, "<em>$1</em>$2");
    xml = xml.replace(/<em>([^>]+?)( +)<\/em>/vg, "<em>$1</em>$2");
    xml = xml.replace(/<em> ([a-zA-Z]+)<\/em>/vg, " <em>$1</em>");
    xml = xml.replace(/<em>‘\s*([^<]+)\s*’<\/em>/vg, "‘<em>$1</em>’");
    xml = xml.replace(/<em>‘\s*([^<]+)\s*<\/em>\s*’/vg, "‘<em>$1</em>’");
    xml = xml.replace(/‘\s*<em>\s*([^<]+)\s*’<\/em>/vg, "‘<em>$1</em>’");
    xml = xml.replace(/<em>“\s*([^<”]+)\s*”<\/em>/vg, "“<em>$1</em>”");
    xml = xml.replace(/<em>“\s*([^<”]+)\s*<\/em>\s*”/vg, "“<em>$1</em>”");
    xml = xml.replace(/“\s*<em>\s*([^<”]+)\s*”<\/em>/vg, "“<em>$1</em>”");
    xml = xml.replace(/([^\n>])<em>  ?/vg, "$1 <em>");
    xml = xml.replace(/  ?<\/em>/vg, "</em> ");
    xml = xml.replace(/<p([^>]+)> <em>/vg, "<p$1><em>");
    xml = xml.replace(/<\/em> <\/p>/vg, "</em></p>");
    xml = xml.replace(/<em>([a-z]+),<\/em>/vg, "<em>$1</em>,");
  }

  // These quote/apostrophe/em fixes interact with each other. TODO: try to disentangle so we don't repeat all of
  // fixEms.
  xml = xml.replace(/,” <\/em>/vg, "</em>,” ");
  fixEms();
  xml = xml.replace(/<p>”/vg, "<p>“");
  xml = xml.replace(/“\s*<\/p>/vg, "”</p>");
  xml = xml.replace(/“\s*<\/em><\/p>/vg, "</em>”</p>");
  xml = xml.replace(/‘\s*<\/p>/vg, "’</p>");
  xml = xml.replace(/‘\s*<\/em><\/p>/vg, "’</em></p>");
  xml = xml.replace(/,” <\/em>/vg, "</em>,” ");
  xml = xml.replace(/′/vg, "’");
  xml = xml.replace(/″/vg, "”");
  xml = xml.replace(/([A-Za-z])‘s(\s?)/vg, "$1’s$2");
  xml = xml.replace(/I‘m/vg, "I’m");
  xml = xml.replace(/<p>“\s+/vg, "<p>“");
  xml = xml.replace(/\s+”/vg, "”");
  xml = xml.replace(/'/vg, "’");
  xml = xml.replace(/’([A-Za-z]+)’/vg, "‘$1’");
  xml = xml.replace(/([a-z])”<\/p>/vg, "$1.”</p>");
  fixEms();
  xml = xml.replace(/‘<em>([^<]+)<\/em>‘/vg, "‘<em>$1</em>’");
  xml = xml.replace(/<em>([a-z]+)!<\/em>/vg, "<em>$1</em>!");
  xml = xml.replace(/(?<! {2})<em>([\w ’]+)([!.?])”<\/em>/vg, "<em>$1</em>$2”");
  xml = xml.replace(/<em>([\w ’]+[!.?])”<\/em>/vg, "<em>$1</em>”");
  xml = xml.replace(/I”(m|ll)/vg, "I’$1");
  xml = xml.replace(/””<\/p>/vg, "”</p>");
  xml = xml.replace(/^([^“]+?) ?”(?![ —<])/vgm, "$1 “");
  xml = xml.replace(/(?<!“)<em>([A-Za-z]+),<\/em>(?!”| +[A-Za-z]+ thought)/vg, "<em>$1</em>,");
  xml = xml.replace(/‘([Kk])ay(?!’)/vg, "’$1ay");
  xml = xml.replace(/<em>(Why|What|Who|How|Where|When)<\/em>\?/vg, "<em>$1?</em>");
  xml = xml.replace(/,<\/em>/vg, "</em>,");
  xml = xml.replace(/,”<\/p>/vg, ".”</p>");
  xml = xml.replace(/<p>(.*),<\/p>/vg, "<p>$1.</p>");
  xml = xml.replace(/‘(\w+)‘(\w+)’/vg, "‘$1’$2’");
  xml = xml.replace(/<em>([a-z]+), ([a-z]+)<\/em>/vg, "<em>$1</em>, <em>$2</em>");

  // Similar problems occur in Ward with <b> and <strong> as do in Worm with <em>s
  xml = xml.replace(/<b \/>/vg, "");
  xml = xml.replace(/<b>(\s*<br \/>\s*)<\/b>/vg, "$1");
  xml = xml.replace(/<strong>(\s*<br \/>\s*)<\/strong>/vg, "$1");
  xml = xml.replace(/<\/strong>(\s*)<strong>/vg, "$1");
  xml = xml.replace(/<strong>@<\/strong>/vg, "@");
  xml = xml.replace(/<br \/>(\s*)<\/strong>/vg, "</strong><br />$1");
  xml = xml.replace(/(\s*)<\/strong>/vg, "</strong>$1");
  xml = xml.replace(/><strong>(.*)<\/strong>:</vg, "><strong>$1:</strong><");
  xml = xml.replace(/<strong><br \/>\n/vg, "<br />\n<strong>");

  // No need for line breaks before paragraph ends or after paragraph starts
  // These often occur with the <br>s inside <b>/<strong>/<em>/<i> fixed above.
  xml = xml.replace(/<br \/>\s*<\/p>/vg, "</p>");
  xml = xml.replace(/<p><br \/>\s*/vg, "<p>");

  // This is another quote fix but it needs to happen after the line break deletion... so entangled, ugh.
  xml = xml.replace(/<\/em>\s*“\s*<\/p>/vg, "</em>”</p>");

  // Fix missing spaces after commas
  xml = xml.replace(/([a-zA-Z]+),([a-zA-Z]+)/vg, "$1, $2");

  // Fix bad periods and spacing/markup surrounding them
  xml = xml.replace(/\.\.<\/p>/vg, ".</p>");
  xml = xml.replace(/\.\.”<\/p>/vg, ".”</p>");
  xml = xml.replace(/ \. /vg, ". ");
  xml = xml.replace(/ \.<\/p>/vg, ".</p>");
  xml = xml.replace(/\.<em>\.\./vg, "<em>…");
  xml = xml.replace(/\.\. {2}/vg, ".  ");
  xml = xml.replace(/\.\./vg, "…");
  xml = xml.replace(/(?<!Mr|Ms|Mrs)…\./vg, "…");
  xml = xml.replace(/(?<=Mr|Ms|Mrs)…\./vg, ".…");

  // Fix extra spaces
  xml = xml.replace(/ ? <\/p>/vg, "</p>");
  xml = xml.replace(/([a-z]) ,/vg, "$1,");

  // Use actual emojis instead of images
  xml = xml.replaceAll(
    `<img width="16" height="16" class="wp-smiley emoji" draggable="false" alt="O_o" src="https://s1.wp.com/wp-content/mu-plugins/wpcom-smileys/o_O.svg" style="height: 1em; max-height: 1em;" />`,
    "🤨"
  );

  // This needs to happen before other name-related fixes.
  xml = standardizeNames(xml);

  // Glow-worm is a bunch of people posting online, so they rarely use proper punctuation or standardized spelling, etc.
  if (bookTitle !== "Glow-worm") {
    xml = fixTruncatedWords(xml);
    xml = fixDialogueTags(xml);
    xml = fixForeignNames(xml);
    xml = fixEmDashes(xml);
    xml = enDashJointNames(xml);
    xml = fixPossessives(xml);
    xml = fixCapitalization(xml, bookTitle);
    xml = fixMispellings(xml);
    xml = standardizeSpellings(xml);
    xml = fixHyphens(xml);
    xml = fixCaseNumbers(xml);
  }
  xml = cleanSceneBreaks(xml);
  xml = fixParahumansOnline(xml);

  // One-off fixes
  for (const substitution of chapterSubstitutions) {
    if (substitution.before) {
      const indexOf = xml.indexOf(substitution.before);
      if (indexOf === -1) {
        warnings.push(`Could not find text "${substitution.before}" in ${chapter.url}. The chapter may have been ` +
                      `updated at the source, in which case, you should edit the substitutions file.`);
      }
      if (indexOf !== xml.lastIndexOf(substitution.before)) {
        warnings.push(`The text "${substitution.before}" occurred twice, and so the substitution was ambiguous. ` +
                      `Update the substitutions file for a more precise substitution.`);
      }

      xml = xml.replace(new RegExp(escapeRegExp(substitution.before), "u"), substitution.after);
    } else if (substitution.regExp) {
      xml = xml.replace(substitution.regExp, substitution.replacement);
    } else {
      warnings.push(`Invalid substitution specified for ${chapter.url}`);
    }
  }

  // Serializer inserts extra xmlns for us since it doesn't know we're going to put this into a <html>.
  xml = xml.replaceAll(
    `<body xmlns="http://www.w3.org/1999/xhtml">`,
    `<body>\n`
  );

  return { xml, warnings };
}

function fixTruncatedWords(xml) {
  xml = xml.replace(/‘Sup/vg, "’Sup");
  xml = xml.replace(/‘cuz/vg, "’cuz");

  // Short for "Sidepeace"
  xml = xml.replace(/[‘’][Pp]iece(?![a-z])/vg, "’Piece");

  // Short for "Disjoint"
  xml = xml.replace(/[‘’][Jj]oint(?![a-z])/vg, "’Joint");

  // Short for "Contender"
  xml = xml.replace(/[‘’][Tt]end(?![a-z])/vg, "’Tend");

  // Short for "Anelace"
  xml = xml.replace(/[‘’][Ll]ace(?![a-z])/vg, "’Lace");

  // Short for "Birdcage"
  xml = xml.replace(/[‘’][Cc]age(?![a-z])/vg, "’Cage");

  // We can't do "’Clear" (short for Crystalclear) here because it appears too much as a normal word preceded by an
  // open quote, so we do that in the substitutions file.

  return xml;
}

function fixDialogueTags(xml) {
  // Fix recurring miscapitalization with questions
  xml = xml.replace(/\?”\s\s?She asked/vg, "?” she asked");
  xml = xml.replace(/\?”\s\s?He asked/vg, "?” he asked");

  // The author often fails to terminate a sentence, instead using a comma after a dialogue tag. For example,
  // > “I didn’t get much done,” Greg said, “I got distracted by...
  // This should instead be
  // > “I didn’t get much done,” Greg said. “I got distracted by...
  //
  // Our heuristic is to try to automatically fix this if the dialogue tag is two words (X said/admitted/sighed/etc.).
  //
  // This sometimes overcorrects, as in the following example:
  // > “Basically,” Alec said, “For your powers to manifest, ...
  // Here instead we should lowercase the "f". We handle that via one-offs in the substitutions file.
  //
  // This applies to ~800 instances, so although we have to correct back in the substitutions file a decent number of
  // times, it definitely pays for itself. Most of the instances we have to correct back we also need to fix the
  // capitalization anyway, and that's harder to do automatically, since proper names/"I"/etc. stay capitalized.
  xml = xml.replace(/,” ([A-Za-z]+ [A-Za-z]+), “([A-Z])/vg, ",” $1. “$2");

  return xml;
}

function fixForeignNames(xml) {
  // This is consistently missing diacritics
  xml = xml.replace(/Yangban/vg, "Yàngbǎn");

  // These are usually not italicized, but sometimes are. Other foreign-language names (like Yàngbǎn) are not
  // italicized, so we go in the direction of removing the italics.
  xml = xml.replace(/<em>Garama<\/em>/vg, "Garama");
  xml = xml.replace(/<em>Thanda<\/em>/vg, "Thanda");
  xml = xml.replace(/<em>Sifara([^<]*)<\/em>/vg, "Sifara$1");
  xml = xml.replace(/<em>Moord Nag([^<]*)<\/em>/vg, "Moord Nag$1");
  xml = xml.replace(/<em>Califa de Perro([^<]*)<\/em>/vg, "Califa de Perro$1");
  xml = xml.replace(/<em>Turanta([^<]*)<\/em>/vg, "Turanta$1");

  return xml;
}

function standardizeNames(xml) {
  // 197 instances of "Mrs." to 21 of "Ms."
  xml = xml.replace(/Ms\. Yamada/vg, "Mrs. Yamada");

  // 25 instances of "Amias" to 3 of "Amais"
  xml = xml.replace(/Amais/vg, "Amias");

  // 185 instances of Juliette to 4 of Juliet
  xml = xml.replace(/Juliet(?=\b)/vg, "Juliette");

  // Earlier chapters have a space; later ones do not. They're separate words, so side with the earlier chapters.
  // One location is missing the "k".
  xml = xml.replace(/Crock? o[‘’]Shit/vg, "Crock o’ Shit");

  // 5 instances of "Jotun" to 2 of "Jotunn"
  xml = xml.replace(/Jotunn/vg, "Jotun");

  // 13 instances of Elman to 1 of Elmann
  xml = xml.replace(/Elmann/vg, "Elman");

  // Thousands of instances of Tattletale to 4 instances of Tatteltale
  xml = xml.replace(/Tatteltale/vg, "Tattletale");

  // 73 instances of Über to 2 of Uber
  xml = xml.replace(/Uber/vg, "Über");

  // 5 instances of Johnsonjar to 2 instances of JohnsonJar
  xml = xml.replace(/JohnsonJar/vg, "Johnsonjar");

  // 4 instances of Flying_Kevin to 2 instances of FlyingKevin
  xml = xml.replace(/FlyingKevin/vg, "Flying_Kevin");

  // 5 instances of Jean-Paul to 2 instances of Jean-paul
  xml = xml.replace(/Jean-paul/vg, "Jean-Paul");

  return xml;
}

function fixEmDashes(xml) {
  xml = xml.replace(/ – /vg, "—");
  xml = xml.replace(/“((?:<em>)?)-/vg, "“$1—");
  xml = xml.replace(/-[,.]?”/vg, "—”");
  xml = xml.replace(/-(!|\?)”/vg, "—$1”");
  xml = xml.replace(/-[,.]?<\/([a-z]+)>”/vg, "—</$1>”");
  xml = xml.replace(/-“/vg, "—”");
  xml = xml.replace(/<p>-/vg, "<p>—");
  xml = xml.replace(/-<\/p>/vg, "—</p>");
  xml = xml.replace(/-<br \/>/vg, "—<br />");
  xml = xml.replace(/-<\/([a-z]+)><\/p>/vg, "—</$1></p>");
  xml = xml.replace(/\s?\s?–\s?\s?/vg, "—");
  xml = xml.replace(/-\s\s?/vg, "—");
  xml = xml.replace(/\s?\s-/vg, "—");
  xml = xml.replace(/\s+—”/vg, "—”");
  xml = xml.replace(/I-I/vg, "I—I");
  xml = xml.replace(/I-uh/vg, "I—uh");
  xml = xml.replace(/-\?/vg, "—?");

  return xml;
}

function enDashJointNames(xml) {
  // Joint names should use en dashes
  xml = xml.replace(/Dallon-Pelham/vg, "Dallon–Pelham");
  xml = xml.replace(/Bet-Gimel/vg, "Bet–Gimel");
  xml = xml.replace(/Cheit-Gimel/vg, "Bet–Gimel");
  xml = xml.replace(/Tristan-Capricorn/vg, "Tristan–Capricorn");
  xml = xml.replace(/Capricorn-Byron/vg, "Capricorn–Byron");
  xml = xml.replace(/Tristan-Byron/vg, "Tristan–Byron");
  xml = xml.replace(/Gimel-Europe/vg, "Gimel–Europe");
  xml = xml.replace(/G-N/vg, "G–N");
  xml = xml.replace(/Imp-Damsel/vg, "Imp–Damsel");
  xml = xml.replace(/Damsel-Ashley/vg, "Damsel–Ashley");
  xml = xml.replace(/Antares-Anelace/vg, "Antares–Anelace");
  xml = xml.replace(/Challenger-Gallant/vg, "Challenger–Gallant");
  xml = xml.replace(/Undersider(s?)-(Breakthrough|Ambassador)/vg, "Undersider$1–$2");
  xml = xml.replace(/Norwalk-Fairfield/vg, "Norwalk–Fairfield");
  xml = xml.replace(/East-West/vg, "east–west");
  xml = xml.replace(/Creutzfeldt-Jakob/vg, "Creutzfeldt–Jakob");
  xml = xml.replace(/Astaroth-Nidhug/vg, "Astaroth–Nidhug");
  xml = xml.replace(/Capulet-Montague/vg, "Capulet–Montague");
  xml = xml.replace(/Weaver-Clockblocker/vg, "Weaver–Clockblocker");
  xml = xml.replace(/Alexandria-Pretender/vg, "Alexandria–Pretender");
  xml = xml.replace(/Night Hag-Nyx/vg, "Night Hag–Nyx");
  xml = xml.replace(/Crawler-Breed/vg, "Crawler–Breed");
  xml = xml.replace(/Simurgh-Myrddin-plant/vg, "Simurgh–Myrddin–plant");
  xml = xml.replace(/Armsmaster-Defiant/vg, "Armsmaster–Defiant");
  xml = xml.replace(/Matryoshka-Valentin/vg, "Matryoshka–Valentin");
  xml = xml.replace(/Gaea-Eden/vg, "Gaea–Eden");
  xml = xml.replace(/([Aa])gent-parahuman/vg, "$1gent–parahuman");
  xml = xml.replace(/([Pp])arahuman-agent/vg, "$1arahuman–agent");

  return xml;
}

function fixPossessives(xml) {
  // Fix possessive of names ending in "s".
  xml = xml.replace(
    // eslint-disable-next-line max-len
    /(?<!‘)(Judas|Brutus|Jess|Aegis|Dauntless|Circus|Sirius|Brooks|Genesis|Atlas|Lucas|Gwerrus|Chris|Eligos|Animos|Mags|Huntress|Hephaestus|Lord of Loss|John Combs|Mama Mathers|Monokeros|Goddess|Boundless|Paris|Tress|Harris|Antares|Nieves|Backwoods|Midas|Mrs. Sims|Ms. Stillons|Chuckles|Amias|Semiramis|Mother of Mothers)’(?!s)/vg,
    "$1’s"
  );

  // Note: if the "s" is unvoiced, as in Marquis, then it doesn't get the second "s".
  xml = xml.replace(/Marquis’s/vg, "Marquis’");

  // These have their apostrophe misplaced sometimes.
  xml = xml.replace(/Ward’s/vg, "Wards’");
  xml = xml.replace(/Warden’s/vg, "Wardens’");
  xml = xml.replace(/Traveller’s/vg, "Travellers’");

  // This is basically a mispelling.
  xml = xml.replace(/Alzheimers/vg, "Alzheimer’s");

  return xml;
}

function cleanSceneBreaks(xml) {
  // Normalize scene breaks. <hr> would be more semantically appropriate, but loses the author's intent. This is
  // especially the case in Ward, which uses a variety of different scene breaks.

  xml = xml.replace(/<p(?:[^>]*)>■<\/p>/vg, `<p style="text-align: center;">■</p>`);

  xml = xml.replace(
    /<p style="text-align: center;"><strong>⊙<\/strong><\/p>/vg,
    `<p style="text-align: center;">⊙</p>`
  );
  xml = xml.replace(
    /<p style="text-align: center;"><em><strong>⊙<\/strong><\/em><\/p>/vg,
    `<p style="text-align: center;">⊙</p>`
  );
  xml = xml.replace(
    /<p style="text-align: center;"><strong>⊙⊙<\/strong><\/p>/vg,
    `<p style="text-align: center;">⊙</p>`
  );

  xml = xml.replace(
    /<p style="text-align: center;"><strong>⊙ *⊙ *⊙ *⊙ *⊙<\/strong><\/p>/vg,
    `<p style="text-align: center;">⊙ ⊙ ⊙ ⊙ ⊙</p>`
  );

  return xml;
}

function fixCapitalization(xml, bookTitle) {
  // This occurs enough times it's better to do here than in one-off fixes. We correct the single instance where
  // it's incorrect to capitalize in the one-off fixes.
  // Note that Ward contains much talk of "the clairvoyants", so we don't want to capitalize plurals.
  xml = xml.replace(/([Tt])he clairvoyant(?!s)/vg, "$1he Clairvoyant");

  // ReSound's name is sometimes miscapitalized. The word is never used in a non-name context.
  xml = xml.replace(/Resound/vg, "ReSound");

  // Number Man's "man" is missing its capitalization a couple times.
  xml = xml.replace(/Number man/vg, "Number Man");

  // The Speedrunners team name is missing its capitalization a couple times.
  xml = xml.replace(/speedrunners/vg, "Speedrunners");

  // The Machine Army is missing its capitalization a couple times.
  xml = xml.replace(/machine army/vg, "Machine Army");

  // Olympic is a proper adjective.
  xml = xml.replace(/olympic/vg, "Olympic");

  // Molotov is a proper noun/adjective.
  xml = xml.replace(/molotov/vg, "Molotov");

  // "patrol block" is capitalized three different ways: "patrol block", "Patrol block", and "Patrol Block". "patrol
  // group" is always lowercased. It seems like "Patrol" is a proper name, and is used as a capitalized modifier in
  // other contexts (e.g. Patrol leader). So let's standardize on "Patrol <lowercase>".
  xml = xml.replace(
    /patrol (block|group|leader|guard|student|uniform|squad|soldier|officer|crew|girl|bus|training)/vig,
    (_, $1) => `Patrol ${$1.toLowerCase()}`
  );
  // This usually works in Ward (some instances corrected back in the substitutions file), and has a few false positives
  // in Worm, where it is never needed:
  if (bookTitle === "Ward") {
    xml = xml.replace(/the patrol(?!s|ling)/vg, "the Patrol");
  }

  // There's no reason why these should be capitalized.
  xml = xml.replace(/(?<! {2}|“|>)Halberd/vg, "halberd");
  xml = xml.replace(/(?<! {2}|“|>)Loft/vg, "loft");

  // These are treated as common nouns and not traditionally capitalized. "Krav Maga" remains capitalized,
  // interestingly (according to dictionaries and Wikipedia).
  xml = xml.replace(/(?<! {2}|“|>)Judo/vg, "judo");
  xml = xml.replace(/(?<! {2}|“|>)Aikido/vg, "aikido");
  xml = xml.replace(/(?<! {2}|“|>)Karate/vg, "karate");
  xml = xml.replace(/(?<! {2}|“|>)Tae Kwon Do/vg, "tae kwon do");
  xml = xml.replace(/(?<! {2}|“|>)Track and Field/vg, "track and field");

  // There's no reason why university should be capitalized in most contexts, although sometimes it's used as part of
  // a compound noun or at the beginning of a sentence.
  xml = xml.replace(/(?<! {2}|“|>|Cornell |Nilles )University(?! Road)/vg, "university");

  // Organ names (e.g. brain, arm) or scientific names are not capitalized, so the "corona pollentia" and friends should
  // not be either. The books are inconsistent.
  xml = xml.replace(/(?<! {2}|“|>|-)Corona/vg, "corona");
  xml = xml.replace(/Pollentia/vg, "pollentia");
  xml = xml.replace(/Radiata/vg, "radiata");
  xml = xml.replace(/Gemma/vg, "gemma");

  // We de-capitalize Valkyrie's "flock", since most uses are de-capitalized (e.g. the many instances in Gleaming
  // Interlude 9, or Dying 15.z). This is a bit surprising; it seems like an organization name. But I guess it's
  // informal.
  xml = xml.replace(/(?<! {2}|“|>)Flock/vg, "flock");

  // Especially early in Worm, PRT designations are capitalized; they should not be. This fixes the cases where we
  // can be reasonably sure they don't start a sentence, although more specific instances are done in the substitutions
  // file, and some need to be back-corrected.
  //
  // Note: "Master" is specifically omitted because it fails poorly on Worm Interlude 4. Other instances need to be
  // corrected via the substitutions file.
  //
  // This also over-de-capitalizes "The Stranger" in Ward (a titan name). Those also get fixed in the substitutions
  // file.
  xml = xml.replace(
    // eslint-disable-next-line max-len
    /(?<! {2}|“|>|\n|: )(Mover|Shaker|Brute|Breaker|Tinker|Blaster|Thinker|Striker|Changer|Trump|Stranger|Shifter|Shaper)(?! [A-Z])/vg,
    (_, designation) => designation.toLowerCase()
  );
  xml = xml.replace(
    /(mover|shaker|brute|breaker|tinker|blaster|thinker|master|striker|changer|trump|stranger|shifter|shaper)-(\d+)/vig,
    "$1 $2"
  );
  xml = xml.replace(
    // eslint-disable-next-line max-len
    /(mover|shaker|brute|breaker|tinker|blaster|thinker|master|striker|changer|trump|stranger|shifter|shaper)[ -\/](mover|shaker|brute|breaker|tinker|blaster|thinker|master|striker|changer|trump|stranger|shifter|shaper)/vig,
    "$1–$2"
  );

  // Capitalization is inconsistent, but shard names seems to usually be capitalized.
  xml = xml.replace(/Grasping self/vg, "Grasping Self");
  xml = xml.replace(/Cloven stranger/vg, "Cloven Stranger");
  xml = xml.replace(/Princess shaper/vg, "Princess Shaper");
  xml = xml.replace(/Fragile one/vg, "Fragile One");

  // Place names need to always be capitalized
  xml = xml.replace(/(Stonemast|Shale) avenue/vg, "$1 Avenue");
  xml = xml.replace(/(Lord|Slater) street/vg, "$1 Street");
  xml = xml.replace(/(Hollow|Cedar) point/vg, "$1 Point");
  xml = xml.replace(/(Norwalk|Fenway|Stratford) station/vg, "$1 Station");
  xml = xml.replace(/downtown Brockton Bay/vg, "Downtown Brockton Bay");
  xml = xml.replace(/the megalopolis/vg, "the Megalopolis");
  xml = xml.replace(/earths(?![a-z])/vg, "Earths");
  xml = xml.replace(/bible belt/vg, "Bible Belt");
  xml = xml.replace(/the birdcage/vg, "the Birdcage");
  xml = xml.replace(/Weymouth shopping center/vg, "Weymouth Shopping Center");
  if (bookTitle === "Ward") {
    xml = xml.replace(/the bunker/vg, "the Bunker");
    xml = xml.replace(/‘bunker’/vg, "‘Bunker’");
  }

  // These seem to be used more as generic terms than as place names.
  xml = xml.replace(/the Market/vg, "the market");
  xml = xml.replace(/the Bay(?! [A-Z])/vg, "the bay");
  xml = xml.replace(/(?<! {2}|“|>)North (?:E|e)nd/vg, "north end");

  // "Mom" and "Dad" should be capitalized when used as a proper name. These regexps are tuned to catch a good amount of
  // instances, without over-correcting for non-proper-name-like cases. Many other instances are handled in
  // the substitutions file.
  xml = xml.replace(/(?<!mom), dad(?![a-z])/vg, ", Dad");
  xml = xml.replace(/, mom(?![a-z\-])/vg, ", Mom");
  xml = xml.replace(/\bmy Dad\b/vg, "my dad");

  // Similarly, specific aunts and uncles get capitalized when used as a title. These are often missed.
  xml = xml.replace(/aunt Sarah/vg, "Aunt Sarah");
  xml = xml.replace(/aunt Fleur/vg, "Aunt Fleur");
  xml = xml.replace(/uncle Neil/vg, "Uncle Neil");

  // The majority of "Wardens’ headquarters" is lowercased, and always prefixed with "the", indicating it's not a proper
  // place name. So we remove the capitalization in the few places where it does appear.
  xml = xml.replace(/Wardens’ Headquarters/vg, "Wardens’ headquarters");

  // Some style guides try to reserve capitalized "Nazi" for historical discussions of members of the Nazi party. This
  // seems fuzzy when it comes to phrases like "neo-Nazi", and doesn't seem to be what the author is doing; the books
  // are just plain inconsistent. So, let's standardize on always uppercasing.
  xml = xml.replace(/(?<![a-z])nazi/vg, "Nazi");
  xml = xml.replace(/ Neo-/vg, " neo-");

  // Dog breeds are capitalized only when they derive from proper nouns: "German" in "German shepherd", "Rottweiler"
  // (from the town of Rottweil).
  xml = xml.replace(/rottweiler/vg, "Rottweiler");
  xml = xml.replace(/german shepherd/vig, "German shepherd");

  // Style guides disagree on whether items like "english muffin", "french toast", and "french kiss" need their
  // adjective capitalized. The books mostly use lowercase, so let's stick with that. (The substitutions file corrects
  // one case of "French toast".)
  xml = xml.replace(/english(?! muffin)/vg, "English");
  xml = xml.replace(/(?<! {2})English muffin/vg, "english muffin");

  // Just incorrect
  xml = xml.replace(/Youtube/vg, "YouTube");

  // As in "Geez Louise"
  xml = xml.replace(/louise/vg, "Louise");

  // Caucasian is a race, and races are often not capitalized (until recent years). But it's derived from a place name,
  // so it gets capitalized.
  xml = xml.replace(/caucasian/vg, "Caucasian");

  // I was very torn on what to do with capitalization for "Titan" and "Titans". In general you don't capitalize species
  // names or other classifications, e.g. style guides are quite clear you don't capitalize "gods". The author
  // capitalizes them more often than not (e.g., 179 raw "Titans" to 49 "titans"), but is quite inconsistent.
  //
  // In the end, I decided against de-capitalization, based on the precedent set by "Endbringers" (which are
  // conceptually paired with Titans several times in the text). However, we only capitalize the class after they are
  // _introduced_ as a class in Sundown 17.y. (Before then we still capitalize individual names like "Dauntless Titan"
  // or "Kronos Titan".)
  if (bookTitle === "Ward") {
    // All plural discussions of "Titans" are after Sundown 17.y.
    xml = xml.replace(/titans/vg, "Titans");

    // Since we can't safely change all instances of "titan", most are in the substitutions file. We can do a few here,
    // though.
    xml = xml.replace(/dauntless titan/vig, "Dauntless Titan"); // Sometimes "Dauntless" isn't even capitalized.
    xml = xml.replace(/Kronos titan/vg, "Kronos Titan");
  }

  // For the giants, the prevailing usage seems to be to keep the term lowercase, but capitalize when used as a name.
  xml = xml.replace(/(?<=Mathers |Goddess )giant/vg, "Giant");
  xml = xml.replace(/mother giant/vig, "Mother Giant");
  xml = xml.replace(/(?<! {2}|“|>)Giants/vg, "giants");

  return xml;
}

function fixMispellings(xml) {
  // This is commonly misspelled.
  xml = xml.replace(/([Ss])houlderblade/vg, "$1houlder blade");

  // All dictionaries agree this is capitalized.
  xml = xml.replace(/u-turn/vg, "U-turn");

  // https://www.dictionary.com/browse/scot-free
  xml = xml.replace(/scott(?: |-)free/vg, "scot-free");

  // https://www.dictionary.com/browse/nonfiction
  xml = xml.replace(/non(?: |-)fiction/vg, "nonfiction");

  // https://vgrammarist.com/idiom/change-tack/
  xml = xml.replace(/changed tacks/vg, "changed tack");

  xml = xml.replace(/gasmask/vg, "gas mask");

  return xml;
}

function fixHyphens(xml) {
  // "X-year-old" should use hyphens; all grammar guides agree. The books are very inconsistent but most often omit
  // them.
  xml = xml.replace(/(\w+)[ \-]year[ \-]old(s?)(?!\w)/vg, "$1-year-old$2");
  xml = xml.replace(/(\w+) or (\w+)-year-old/vg, "$1- or $2-year-old");

  // "X-foot-tall" should use hyphens, but we need to avoid "foot taller", "a foot tall", etc.
  xml = xml.replace(/(?<!a)[ \-]foot[ \-]tall\b/vg, "-foot-tall");

  // Compound numbers from 11 through 99 must be hyphenated, but others should not be.
  xml = xml.replace(
    // eslint-disable-next-line max-len
    /(?<!\w)(twenty|thirty|fourty|fifty|sixty|seventy|eighty|ninety) (one|two|three|four|five|six|seven|eight|nine|something)/vig,
    "$1-$2"
  );
  xml = xml.replace(/[ \-]hundred-and-/vg, " hundred and ");
  xml = xml.replace(/(?<!-)(one|two|three|four|five|six|seven|eight|nine|twelve)-hundred/vg, "$1 hundred");
  xml = xml.replace(/(hundred|ninety)-percent(?!-)/vg, "$1 percent");

  // "red-haired", "long-haired", etc.: they all need hyphens
  xml = xml.replace(/ haired/vg, "-haired");

  // Hyphenating types of balls is apparently difficult.
  xml = xml.replace(/foot-ball/vg, "football");
  xml = xml.replace(/golf-ball/vg, "golf ball");

  // These are consistently missing hyphens.
  xml = xml.replace(/(life) (threatening)/vig, "life-threatening");
  xml = xml.replace(/(hard) (headed)/vig, "$1-$2");
  xml = xml.replace(/(shoulder) (mounted)/vig, "$1-$2");
  xml = xml.replace(/(shoulder) (length)/vig, "$1-$2");
  xml = xml.replace(/(golden|pink|brown|dark|tan|metal|darker|yellow|olive|red|gray) (skinned)/vig, "$1-$2");
  xml = xml.replace(/(plum|amber|rose|coffee|chestnut|funny|different) (colored)/vig, "$1-$2");
  xml = xml.replace(/(creepy) (crawl)/vig, "$1-$2");
  xml = xml.replace(/(well) (armed|stocked|rounded)/vig, "$1-$2");
  xml = xml.replace(/(able) (bodied)/vig, "$1-$2");
  xml = xml.replace(/(level) (headed)/vig, "$1-$2");
  xml = xml.replace(/(clear) (cut)/vig, "$1-$2");
  xml = xml.replace(/(vat) (grown)/vig, "$1-$2");
  xml = xml.replace(/(shell) (shocked)/vig, "$1-$2");
  xml = xml.replace(/(dog) (tired)/vig, "$1-$2");
  xml = xml.replace(/(nightmare) (filled)/vig, "$1-$2");
  xml = xml.replace(/(one) (sided)/vig, "$1-$2");
  xml = xml.replace(/(medium) (sized)/vig, "$1-$2");
  xml = xml.replace(/(teary|bright|wide|blue) (eyed)/vig, "$1-$2");
  xml = xml.replace(/(long|short) (sleeved)/vig, "$1-$2");
  xml = xml.replace(/(knee) (length|deep)/vig, "$1-$2");
  xml = xml.replace(/(worst) (case scenario)/vig, "$1-$2");
  xml = xml.replace(/(government) (sponsored)/vig, "$1-$2");
  xml = xml.replace(/(high) (pitched)/vig, "$1-$2");
  xml = xml.replace(/(one) (eyed|eared)/vig, "$1-$2");
  xml = xml.replace(/(mule) (headed)/vig, "$1-$2");
  xml = xml.replace(/(fat|squat) (bodied)/vig, "$1-$2");
  xml = xml.replace(/(self) (conscious|esteem|loathing|harm|destruct|preservation)/vig, "$1-$2");
  xml = xml.replace(/(one|two|three|four|fourth) (dimensional)/vig, "$1-$2");
  xml = xml.replace(/(double) (check)/vig, "$1-$2");
  xml = xml.replace(/(rust) (red)/vig, "$1-$2");
  xml = xml.replace(/(zig) (zag)/vig, "$1-$2");
  xml = xml.replace(/(harder) (edged)/vig, "$1-$2");
  xml = xml.replace(/(so) (called)/vig, "$1-$2");
  xml = xml.replace(/(mean) (spirited)/vig, "$1-$2");
  xml = xml.replace(/(full) (fledged|grown)/vig, "$1-$2");
  xml = xml.replace(/(wide) (reaching)/vig, "$1-$2");
  xml = xml.replace(/(lesser|better) (known)/vig, "$1-$2");
  xml = xml.replace(/(cold|red) (blooded)/vig, "$1-$2");
  xml = xml.replace(/(gray|black|dark) (furred)/vig, "$1-$2");
  xml = xml.replace(/(two|red|baby) (faced)/vig, "$1-$2");
  xml = xml.replace(/(name) (calling)/vig, "$1-$2");
  xml = xml.replace(/(high) (heeled)/vig, "$1-$2");
  xml = xml.replace(/(heavy) (handed)/vig, "$1-$2");
  xml = xml.replace(/(third) (world) (countr|nation)/vig, "$1-$2 $3");
  xml = xml.replace(/(self) (discipline)/vig, "$1-$2");
  xml = xml.replace(/(close) (quarters) (combat)/vig, "$1-$2 $3");
  xml = xml.replace(/(toe) (to) (toe)/vig, "$1-$2-$3");
  xml = xml.replace(/(razor) (sharp)/vig, "$1-$2");
  xml = xml.replace(/(two) (thirds)/vig, "$1-$2");
  xml = xml.replace(/(hand) (fed)/vig, "$1-$2");
  xml = xml.replace(/(thin) (lipped)/vig, "$1-$2");
  xml = xml.replace(/(red|heavy|ruddy) (cheeked)/vig, "$1-$2");
  xml = xml.replace(/(longer|shorter) (lived)/vig, "$1-$2");
  xml = xml.replace(/(orange) (striped)/vig, "$1-$2");
  xml = xml.replace(/(spray) (paint)/vig, "$1-$2");
  xml = xml.replace(/(loose|looser) (fitting)/vig, "$1-$2");
  xml = xml.replace(/(wake) (up) (call)/vig, "$1-$2 $3");
  xml = xml.replace(/(fast|slow) (moving)/vig, "$1-$2");
  xml = xml.replace(/(computer) (generated)/vig, "$1-$2");
  xml = xml.replace(/(fine) (tuned)/vig, "$1-$2");
  xml = xml.replace(/(second) (in) (command)/vig, "$1-$2-$3");
  xml = xml.replace(/(stick|broomstick) (thin)\b/vig, "$1-$2");
  xml = xml.replace(/the go ahead/vg, "the go-ahead");
  xml = xml.replace(/(shoulder) (to) (shoulder)/vig, "$1-$2-$3");
  xml = xml.replace(/(face) (to) (face)/vig, "$1-$2-$3");
  xml = xml.replace(/(free) (for) (all)/vig, "$1-$2-$3");
  xml = xml.replace(/(cross) (legged)/vig, "$1-$2");

  xml = xml.replace(
    // eslint-disable-next-line max-len
    /(football|dinner-plate|mountain|island|softball|golf ball|building|Titan|fist|normal|fair|humvee|city|moon|human) (sized)/vig,
    "$1-$2"
  );

  // Tricky compound cases:
  xml = xml.replace(/black and white striped/vg, "black-and-white–striped");
  xml = xml.replace(/red and black striped/vg, "red-and-black–striped");
  xml = xml.replace(/chain link fence/vg, "chain-link fence");

  xml = xml.replace(/ block radius/vg, "-block radius");

  // When used in attributive position, these are hyphenated. When used in predicate position, style guides vary, but
  // for consistency we hyphenate.
  xml = xml.replace(/(middle) (aged)/vig, "$1-$2");
  xml = xml.replace(/(half) (naked)/vig, "$1-$2");
  xml = xml.replace(/(old) (fashioned)/vig, "$1-$2");

  // This should be hyphenated only in attributive position, so it's mostly done case-by-case in the substitutions file.
  // However, "good-looking guy" is used often enough we'll correct it here.
  xml = xml.replace(/good looking guy/vg, "good-looking guy");

  xml = xml.replace(/(?<=\b)([Oo]ne) on one(?=\b)/vg, "$1-on-one");

  // These need verification to make sure the instances that show up in the text are not nouns performing a past-tense
  // action. We've verified that for all of these.
  xml = xml.replace(
    // eslint-disable-next-line max-len
    /(human|pear|flower|‘[a-z\-!]+’|almond|teardrop|question mark|slot|cube|comma|star|spade|coin|claw|door) (shaped)/vig,
    "$1-$2"
  );
  // Heart-shaped is special because we don't want to do "Heart Shaped Pupil" (a screen name), so no i flag.
  xml = xml.replace(/([Hh]eart) (shaped)/vg, "$1-$2");

  // Preemptive(ly) is often hyphenated (not always). It should not be.
  xml = xml.replace(/([Pp])re-emptive/vg, "$1reemptive");

  // These should be hyphenated only when used as a verb. We correct those cases back in the substitutions file.
  xml = xml.replace(/fist-bump/vg, "fist bump");
  xml = xml.replace(/high-five/vg, "high five");

  // These should not be hyphenated.
  xml = xml.replace(/(foster)-/vig, "$1 ");

  // This should be hyphenated when used as an adjective (instead of an adverb or noun). I.e. it should be
  // "hand-to-hand combat", but "passed from hand to hand", and "capable in hand to hand". The following heuristic works
  // in the books.
  xml = xml.replace(/hand to hand(?= [a-z])/vg, "hand-to-hand");

  // This is usually wrong but sometimes correct. The lookarounds avoid specific cases where it's referring to an actual
  // second in a series of guesses.
  xml = xml.replace(/(?<!my |that )([Ss]econd) guess(?!es)/vg, "$1-guess");

  // When used as a phrase "just in case" gets no hyphens. When used as a noun or adjective it does. A couple of the
  // noun cases are missing one or both hyphens.
  xml = xml.replace(/([Aa]) just[ \-]in case/vg, "$1 just-in-case");

  // When used as an adjective, it's hyphenated. It turns out most cases are as an adverb, so we go with this approach:
  xml = xml.replace(
    /face to face(?= meeting| hang-out| interaction| contact| conversation| confrontation| fight)/vg,
    "face-to-face"
  );

  // When used as an adjective, it's hyphenated. This heuristic works in the books.
  xml = xml.replace(/fight or flight(?= [a-z])/vg, "fight-or-flight");

  // This is usually correct but sometimes wrong.
  xml = xml.replace(/neo /vg, "neo-");

  return xml;
}

function standardizeSpellings(xml) {
  // This is usually spelled "TV" but sometimes the other ways. Normalize.
  xml = xml.replace(/(\b)tv(\b)/vg, "$1TV$2");
  xml = xml.replace(/t\.v\./vig, "TV");

  // "okay" is preferred to "ok" or "o.k.". This sometimes gets changed back via the substitutions file when people are
  // writing notes and thus probably the intention was to be less formal. Also it seems per
  // https://en.wikipedia.org/wiki/A-ok the "A" in "A-okay" should be capitalized.
  xml = xml.replace(/Ok([,. ])/vg, "Okay$1");
  xml = xml.replace(/([^a-zA-Z])ok([^a])/vg, "$1okay$2");
  xml = xml.replace(/([^a-zA-Z])o\.k\.([^a])/vg, "$1okay$2");
  xml = xml.replace(/a-okay/vg, "A-okay");

  // Signal(l)ing/signal(l)ed are spelled both ways. Both are acceptable in English. Let's standardize on single-L.
  xml = xml.replace(/(S|s)ignall/vg, "$1ignal");

  // Model(l)ing has one L in American English.
  xml = xml.replace(/(M|m)odell/vg, "$1odel");

  // Clich(e|é) is spelled both ways. Let's standardize on including the accent.
  xml = xml.replace(/cliche/vg, "cliché");

  // T-shirt is usually spelled lowercase ("t-shirt"). Normalize the remaining instances.
  xml = xml.replace(/(?<! {2})T-shirt/vg, "t-shirt");

  // "gray" is the majority spelling, except for "greyhound"
  xml = xml.replace(/(G|g)rey(?!hound)/vg, "$1ray");

  // "changepurse" is the majority spelling
  xml = xml.replace(/(C|c)hange( |-)purse/vg, "$1hangepurse");

  // 12 instances of "Dragon-craft", 12 instances of "Dragon craft", 1 instance of "dragon craft"
  xml = xml.replace(/[Dd]ragon[ \-](craft|mech)/vg, "Dragon-$1");

  // 88 instances of "A.I." to four of "AI"
  xml = xml.replace(/(?<=\b)AI(?=\b)/vg, "A.I.");

  // 2 instances of "G.M." to one of "GM"
  xml = xml.replace(/(?<=\b)GM(?=\b)/vg, "G.M.");

  // 32 instances of "geez" to 3 of "jeez"
  xml = xml.replace(/jeez/vg, "geez");
  xml = xml.replace(/Jeez/vg, "Geez");

  return xml;
}

function fixCaseNumbers(xml) {
  // Case numbers are very inconsistent. For "Case Fifty-Three", the breakdown is:
  // * 9 Case-53
  // * 6 Case 53
  // * 2 case-53
  // * 1 Case-Fifty-Three
  // * 41 Case Fifty-Three
  // * 1 Case Fifty Three
  // * 13 Case fifty-three
  // * 119 case fifty-three
  // * 4 case-fifty-three
  // * 1 case fifty three
  // We standardize on "Case Fifty-Three"; although it isn't the most common, it seems best to treat these as proper
  // nouns.

  xml = xml.replace(/case[ \-](?:fifty[ \-]three|53)(?!’)/vig, "Case Fifty-Three");
  xml = xml.replace(/case[ \-](?:thirty[ \-]two|53)(?!’)/vig, "Case Thirty-Two");
  xml = xml.replace(/case[ \-](?:sixty[ \-]nine|53)(?!’)/vig, "Case Sixty-Nine");

  xml = xml.replace(
    /(?<!in )case[ \-](zero|one|two|three|four|twelve|fifteen|seventy|ninety)(?!-)/vig,
    (_, caseNumber) => `Case ${caseNumber[0].toUpperCase()}${caseNumber.substring(1)}`
  );

  return xml;
}

function fixParahumansOnline(xml) {
  xml = xml.replaceAll("Using identity</strong> “<strong>", "Using identity “");
  xml = xml.replaceAll(
    `Forum <span style="text-decoration: underline;">thread.</span>`,
    `Forum <span style="text-decoration: underline;">thread</span>.`
  );
  xml = xml.replaceAll(
    `Edit that list <span style="text-decoration: underline;"><strong>Here.</strong></span>`,
    `Edit that list <span style="text-decoration: underline;"><strong>Here</strong></span>.`
  );
  xml = xml.replaceAll(
    `<p>Welcome to the Parahumans Online message boards.<br />`,
    `<p><strong>Welcome to the Parahumans Online message boards.</strong><br />`
  );
  xml = xml.replace(
    /You are currently logged in, <span style="text-decoration: underline;">([^<]+)<\/span>/vg,
    `You are currently logged in, <strong><span style="text-decoration: underline;">$1</span></strong>`
  );

  // Most cases have the colon but some don't.
  xml = xml.replace(/(Replied on \w+ \d{1,2}(?:st|nd|rd|th),? ?Y?\d*)<br \/>/vg, "$1:<br />");

  // "You have marked yourself as away." has a period, so this one should too.
  xml = xml.replace(/(You have marked yourself as back)(?<!\.\s)(?=<br\s*\/?>)/vg, "$1.");

  // It's inconsistent to exclude the punctuation from the bolding; fix it.
  xml = xml.replace(/<strong>Welcome back to (.+?)<\/strong>!/vg, "<strong>Welcome back to $1!</strong>");

  xml = xml.replace(/<p>♦ <strong>(.*)<\/strong><\/p>/vg, `<p><strong>♦ $1</strong></p>`);

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
  return str.replace(/[[\]/{}()*+?.\\^$|]/ug, "\\$&");
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
