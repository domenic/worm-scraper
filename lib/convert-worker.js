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
        style === "text-align: left; padding-left: 40px;" ||
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

  // There are way too many nonbreaking spaces where they don't belong. If they show up three in a row, then let them
  // live; they're maybe being used for alignment or something. Otherwise, they die.
  //
  // Also, normalize spaces after a period/quote mark to two (normal) spaces. The second one is invisible when
  // rendered, but it helps future heuristics detect end of sentences.
  xml = xml.replace(/\xA0{1,2}(?!\x20\xA0)/g, " ");
  xml = xml.replace(/([.”])\x20*\xA0[\xA0\x20]*/g, "$1  ");
  xml = xml.replace(/([.”])\x20{3,}/g, "$1  ");

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
    xml = xml.replace(/<em>“\s*([^<”]+)\s*”<\/em>/g, "“<em>$1</em>”");
    xml = xml.replace(/<em>“\s*([^<”]+)\s*<\/em>\s*”/g, "“<em>$1</em>”");
    xml = xml.replace(/“\s*<em>\s*([^<”]+)\s*”<\/em>/g, "“<em>$1</em>”");
    xml = xml.replace(/([^\n>])<em>  ?/g, "$1 <em>");
    xml = xml.replace(/  ?<\/em>/g, "</em> ");
    xml = xml.replace(/<p([^>]+)> <em>/g, "<p$1><em>");
    xml = xml.replace(/<\/em> <\/p>/g, "</em></p>");
    xml = xml.replace(/<em>([a-z]+),<\/em>/g, "<em>$1</em>,");
  }

  // These quote/apostrophe/em fixes interact with each other. TODO: try to disentangle so we don't repeat all of
  // fixEms.
  xml = xml.replace(/,” <\/em>/g, "</em>,” ");
  fixEms();
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
  xml = xml.replace(/\s+”/g, "”");
  xml = xml.replace(/'/g, "’");
  xml = xml.replace(/’([A-Za-z]+)’/g, "‘$1’");
  xml = xml.replace(/([a-z])”<\/p>/g, "$1.”</p>");
  fixEms();
  xml = xml.replace(/‘<em>([^<]+)<\/em>‘/g, "‘<em>$1</em>’");
  xml = xml.replace(/<em>([a-z]+)!<\/em>/g, "<em>$1</em>!");
  xml = xml.replace(/(?<! {2})<em>([\w ’]+)([!.?])”<\/em>/g, "<em>$1</em>$2”");
  xml = xml.replace(/<em>([\w ’]+[!.?])”<\/em>/g, "<em>$1</em>”");
  xml = xml.replace(/I”(m|ll)/g, "I’$1");
  xml = xml.replace(/””<\/p>/g, "”</p>");
  xml = xml.replace(/^([^“]+?) ?”(?![ —<])/gm, "$1 “");
  xml = xml.replace(/(?<!“)<em>([A-Za-z]+),<\/em>(?!”| +[A-Za-z]+ thought)/, "<em>$1</em>,");
  xml = xml.replace(/‘([Kk])ay(?!’)/g, "’$1ay");
  xml = xml.replace(/<em>(Why|What|Who|How|Where|When)<\/em>\?/g, "<em>$1?</em>");
  xml = xml.replace(/,<\/em>/g, "</em>,");
  xml = xml.replace(/,”<\/p>/g, ".”</p>");
  xml = xml.replace(/<p>(.*),<\/p>/g, "<p>$1.</p>");
  xml = xml.replace(/‘(\w+)‘(\w+)’/g, "‘$1’$2’");
  xml = xml.replace(/<em>([a-z]+), ([a-z]+)<\/em>/g, "<em>$1</em>, <em>$2</em>");

  // Similar problems occur in Ward with <b> and <strong> as do in Worm with <em>s
  xml = xml.replace(/<b \/>/g, "");
  xml = xml.replace(/<b>(\s*<br \/>\s*)<\/b>/g, "$1");
  xml = xml.replace(/<strong>(\s*<br \/>\s*)<\/strong>/g, "$1");
  xml = xml.replace(/<\/strong>(\s*)<strong>/g, "$1");
  xml = xml.replace(/<strong>@<\/strong>/g, "@");
  xml = xml.replace(/<br \/>(\s*)<\/strong>/g, "</strong><br />$1");
  xml = xml.replace(/(\s*)<\/strong>/g, "</strong>$1");
  xml = xml.replace(/><strong>(.*)<\/strong>:</g, "><strong>$1:</strong><");

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
  xml = xml.replace(/\.\. {2}/g, ".  ");
  xml = xml.replace(/\.\./g, "…");
  xml = xml.replace(/(?<!Mr|Ms|Mrs)…\./g, "…");
  xml = xml.replace(/(?<=Mr|Ms|Mrs)…\./g, ".…");

  // Fix extra spaces
  xml = xml.replace(/ ? <\/p>/g, "</p>");
  xml = xml.replace(/([a-z]) ,/g, "$1,");

  // Use actual emojis instead of images
  xml = xml.replace(
    // eslint-disable-next-line max-len
    /<img width="16" height="16" class="wp-smiley emoji" draggable="false" alt="O_o" src="https:\/\/s1.wp.com\/wp-content\/mu-plugins\/wpcom-smileys\/o_O.svg" style="height: 1em; max-height: 1em;" \/>/g,
    "🤨");

  xml = fixTruncatedWords(xml);
  xml = fixDialogueTags(xml);
  xml = fixForeignNames(xml);
  xml = standardizeNames(xml);
  xml = fixEmDashes(xml);
  xml = enDashJointNames(xml);
  xml = fixPossessives(xml);
  xml = cleanSceneBreaks(xml);
  xml = fixCapitalization(xml, book);
  xml = fixMispellings(xml);
  xml = fixHyphens(xml);
  xml = standardizeSpellings(xml);
  xml = fixCaseNumbers(xml);

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

function fixTruncatedWords(xml) {
  xml = xml.replace(/‘Sup/g, "’Sup");
  xml = xml.replace(/‘cuz/g, "’cuz");

  // Short for "Sidepeace"
  xml = xml.replace(/[‘’][Pp]iece(?![a-z])/g, "’Piece");

  // Short for "Disjoint"
  xml = xml.replace(/[‘’][Jj]oint(?![a-z])/g, "’Joint");

  // Short for "Contender"
  xml = xml.replace(/[‘’][Tt]end(?![a-z])/g, "’Tend");

  // Short for "Anelace"
  xml = xml.replace(/[‘’][Ll]ace(?![a-z])/g, "’Lace");

  // Short for "Birdcage"
  xml = xml.replace(/[‘’][Cc]age(?![a-z])/g, "’Cage");

  // We can't do "’Clear" (short for Crystalclear) here because it appears too much as a normal word preceded by an
  // open quote, so we do that in substitutions.json.

  return xml;
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

function standardizeNames(xml) {
  // 197 instances of "Mrs." to 21 of "Ms."
  xml = xml.replace(/Ms\. Yamada/g, "Mrs. Yamada");

  // 25 instances of "Amias" to 3 of "Amais"
  xml = xml.replace(/Amais/g, "Amias");

  // 185 instances of Juliette to 4 of Juliet
  xml = xml.replace(/Juliet(?=\b)/g, "Juliette");

  // Earlier chapters have a space; later ones do not. They're separate words, so side with the earlier chapters.
  // One location is missing the "k".
  xml = xml.replace(/Crock? o[‘’]Shit/g, "Crock o’ Shit");

  // 5 instances of "Jotun" to 2 of "Jotunn"
  xml = xml.replace(/Jotunn/g, "Jotun");

  // 13 instances of Elman to 1 of Elmann
  xml = xml.replace(/Elmann/g, "Elman");

  // Thousands of instances of Tattletale to 4 instances of Tatteltale
  xml = xml.replace(/Tatteltale/g, "Tattletale");

  return xml;
}

function fixEmDashes(xml) {
  xml = xml.replace(/ – /g, "—");
  xml = xml.replace(/“((?:<em>)?)-/g, "“$1—");
  xml = xml.replace(/-[,.]?”/g, "—”");
  xml = xml.replace(/-(!|\?)”/g, "—$1”");
  xml = xml.replace(/-[,.]?<\/([a-z]+)>”/g, "—</$1>”");
  xml = xml.replace(/-“/g, "—”");
  xml = xml.replace(/<p>-/g, "<p>—");
  xml = xml.replace(/-<\/p>/g, "—</p>");
  xml = xml.replace(/-<br \/>/g, "—<br />");
  xml = xml.replace(/-<\/([a-z]+)><\/p>/g, "—</$1></p>");
  xml = xml.replace(/\s?\s?–\s?\s?/g, "—");
  xml = xml.replace(/-\s\s?/g, "—");
  xml = xml.replace(/\s?\s-/g, "—");
  xml = xml.replace(/\s+—”/g, "—”");
  xml = xml.replace(/I-I/g, "I—I");
  xml = xml.replace(/I-uh/g, "I—uh");
  xml = xml.replace(/-\?/g, "—?");

  return xml;
}

function enDashJointNames(xml) {
  // Joint names should use en dashes
  xml = xml.replace(/Dallon-Pelham/g, "Dallon–Pelham");
  xml = xml.replace(/Bet-Gimel/g, "Bet–Gimel");
  xml = xml.replace(/Cheit-Gimel/g, "Bet–Gimel");
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
  xml = xml.replace(/Creutzfeldt-Jakob/g, "Creutzfeldt–Jakob");
  xml = xml.replace(/Astaroth-Nidhug/g, "Astaroth–Nidhug");
  xml = xml.replace(/Capulet-Montague/g, "Capulet–Montague");
  xml = xml.replace(/Weaver-Clockblocker/g, "Weaver–Clockblocker");
  xml = xml.replace(/Alexandria-Pretender/g, "Alexandria–Pretender");
  xml = xml.replace(/Night Hag-Nyx/g, "Night Hag–Nyx");
  xml = xml.replace(/Crawler-Breed/g, "Crawler–Breed");
  xml = xml.replace(/Simurgh-Myrddin-plant/g, "Simurgh–Myrddin–plant");
  xml = xml.replace(/Armsmaster-Defiant/g, "Armsmaster–Defiant");
  xml = xml.replace(/Matryoshka-Valentin/g, "Matryoshka–Valentin");
  xml = xml.replace(/Gaea-Eden/g, "Gaea–Eden");
  xml = xml.replace(/([Aa])gent-parahuman/g, "$1gent–parahuman");
  xml = xml.replace(/([Pp])arahuman-agent/g, "$1arahuman–agent");

  return xml;
}

function fixPossessives(xml) {
  // Fix possessive of names ending in "s".
  xml = xml.replace(
    // eslint-disable-next-line max-len
    /(?<!‘)(Judas|Brutus|Jess|Aegis|Dauntless|Circus|Sirius|Brooks|Genesis|Atlas|Lucas|Gwerrus|Chris|Eligos|Animos|Mags|Huntress|Hephaestus|Lord of Loss|John Combs|Mama Mathers|Monokeros|Goddess|Boundless|Paris|Tress|Harris|Antares|Nieves|Backwoods|Midas|Mrs. Sims|Ms. Stillons|Chuckles|Amias|Semiramis|Mother of Mothers)’(?!s)/g,
    "$1’s"
  );

  // Note: if the "s" is unvoiced, as in Marquis, then it doesn't get the second "s".
  xml = xml.replace(/Marquis’s/g, "Marquis’");

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
  xml = xml.replace(/([Tt])he clairvoyant(?!s)/g, "$1he Clairvoyant");

  // ReSound's name is sometimes miscapitalized. The word is never used in a non-name context.
  xml = xml.replace(/Resound/g, "ReSound");

  // The Speedrunners team name is missing its capitalization a couple times.
  xml = xml.replace(/speedrunners/g, "Speedrunners");

  // The Machine Army is missing its capitalization a couple times.
  xml = xml.replace(/machine army/g, "Machine Army");

  // "patrol block" is capitalized three different ways: "patrol block", "Patrol block", and "Patrol Block". "patrol
  // group" is always lowercased. It seems like "Patrol" is a proper name, and is used as a capitalized modifier in
  // other contexts (e.g. Patrol leader). So let's standardize on "Patrol <lowercase>".
  xml = xml.replace(/patrol (block|group|leader|guard|student|uniform|squad|soldier|officer|crew|girl|bus|training)/ig,
    (_, $1) => `Patrol ${$1.toLowerCase()}`);
  // This usually works in Ward (some instances corrected back in substitutions.json), and has a few false positives in
  // Worm, where it is never needed:
  if (book === "ward") {
    xml = xml.replace(/the patrol(?!s|ling)/g, "the Patrol");
  }

  // This is sometimes missing its capitalization.
  xml = xml.replace(/the birdcage/g, "the Birdcage");

  // There's no reason why these should be capitalized.
  xml = xml.replace(/(?<! {2}|“|>)Halberd/g, "halberd");
  xml = xml.replace(/(?<! {2}|“|>)Loft/g, "loft");

  // These are treated as common nouns and not traditionally capitalized. "Krav Maga" remains capitalized,
  // interestingly (according to dictionaries and Wikipedia).
  xml = xml.replace(/(?<! {2}|“|>)Judo/g, "judo");
  xml = xml.replace(/(?<! {2}|“|>)Aikido/g, "aikido");
  xml = xml.replace(/(?<! {2}|“|>)Karate/g, "karate");
  xml = xml.replace(/(?<! {2}|“|>)Tae Kwon Do/g, "tae kwon do");

  // There's no reason why university should be capitalized in most contexts, although sometimes it's used as part of
  // a compound noun or at the beginning of a sentence.
  xml = xml.replace(/(?<! {2}|“|>|Cornell |Nilles )University(?! Road)/, "university");

  // Organ names (e.g. brain, arm) or scientific names are not capitalized, so the "corona pollentia" and friends should
  // not be either. The books are inconsistent.
  xml = xml.replace(/(?<! {2}|“|>|-)Corona/g, "corona");
  xml = xml.replace(/Pollentia/g, "pollentia");
  xml = xml.replace(/Radiata/g, "radiata");
  xml = xml.replace(/Gemma/g, "gemma");

  // We de-capitalize Valkyrie's "flock", since most uses are de-capitalized (e.g. the many instances in Gleaming
  // Interlude 9, or Dying 15.z). This is a bit surprising; it seems like an organization name. But I guess it's
  // informal.
  xml = xml.replace(/(?<! {2}|“|>)Flock/g, "flock");

  // Especially early in Worm, PRT designations are capitalized; they should not be. This fixes the cases where we
  // can be reasonably sure they don't start a sentence, although more specific instances are done in
  // substitutions.json, and some need to be back-corrected.
  //
  // Note: "Master" is specifically omitted because it fails poorly on Worm Interlude 4. Other instances need to be
  // corrected via substitutions.json.
  //
  // This also over-de-capitalizes "The Stranger" in Ward (a titan name). Those also get fixed in substitutions.json.
  xml = xml.replace(
    // eslint-disable-next-line max-len
    /(?<! {2}|“|>|\n|: )(Mover|Shaker|Brute|Breaker|Tinker|Blaster|Thinker|Striker|Changer|Trump|Stranger|Shifter|Shaper)(?! [A-Z])/g,
    (_, designation) => designation.toLowerCase()
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

  // Capitalization is inconsistent, but shard names seems to usually be capitalized.
  xml = xml.replace(/Grasping self/g, "Grasping Self");
  xml = xml.replace(/Cloven stranger/g, "Cloven Stranger");
  xml = xml.replace(/Princess shaper/g, "Princess Shaper");
  xml = xml.replace(/Fragile one/g, "Fragile One");

  // Place names need to always be capitalized
  xml = xml.replace(/North end/g, "North End");
  xml = xml.replace(/(Stonemast|Shale) avenue/g, "$1 Avenue");
  xml = xml.replace(/(Lord|Slater) street/g, "$1 Street");
  xml = xml.replace(/(Hollow|Cedar) point/g, "$1 Point");
  xml = xml.replace(/(Norwalk|Fenway|Stratford) station/g, "$1 Station");
  xml = xml.replace(/the megalopolis/g, "the Megalopolis");
  xml = xml.replace(/earths(?![a-z])/g, "Earths");
  if (book === "ward") {
    xml = xml.replace(/the bunker/g, "the Bunker");
    xml = xml.replace(/‘bunker’/g, "‘Bunker’");
  }

  // "Mom" and "Dad" should be capitalized when used as a proper name. These regexps are tuned to catch a good amount of
  // instances, without over-correcting for non-proper-name-like cases. Many other instances are handled in
  // substitutions.json.
  xml = xml.replace(/(?<!mom), dad(?![a-z])/g, ", Dad");
  xml = xml.replace(/, mom(?![a-z-])/g, ", Mom");

  // Similarly, specific aunts and uncles get capitalized when used as a title. These are often missed.
  xml = xml.replace(/aunt Sarah/g, "Aunt Sarah");
  xml = xml.replace(/aunt Fleur/g, "Aunt Fleur");
  xml = xml.replace(/uncle Neil/g, "Uncle Neil");

  // The majority of "Wardens’ headquarters" is lowercased, and always prefixed with "the", indicating it's not a proper
  // place name. So we remove the capitalization in the few places where it does appear.
  xml = xml.replace(/Wardens’ Headquarters/g, "Wardens’ headquarters");

  // Some style guides try to reserve capitalized "Nazi" for historical discussions of members of the Nazi party. This
  // seems fuzzy when it comes to phrases like "neo-Nazi", and doesn't seem to be what the author is doing; the books
  // are just plain inconsistent. So, let's standardize on always uppercasing.
  xml = xml.replace(/(?<![a-z])nazi/g, "Nazi");
  xml = xml.replace(/ Neo-/g, " neo-");

  // Style guides disagree on whether items like "english muffin", "french toast", and "french kiss" need their
  // adjective capitalized. The books mostly use lowercase, so let's stick with that. (substitutions.json corrects one
  // case of "French toast".)
  xml = xml.replace(/english(?! muffin)/g, "English");
  xml = xml.replace(/(?<! {2})English muffin/g, "english muffin");

  // I was very torn on what to do with capitalization for "Titan" and "Titans". In general you don't capitalize species
  // names or other classifications, e.g. style guides are quite clear you don't capitalize "gods". The author
  // capitalizes them more often than not (e.g., 179 raw "Titans" to 49 "titans"), but is quite inconsistent.
  //
  // In the end, I decided against de-capitalization, based on the precedent set by "Endbringers" (which are
  // conceptually paired with Titans several times in the text). However, we only capitalize the class after they are
  // _introduced_ as a class in Sundown 17.y. (Before then we still capitalize individual names like "Dauntless Titan"
  // or "Kronos Titan".)
  if (book === "ward") {
    // All plural discussions of "Titans" are after Sundown 17.y.
    xml = xml.replace(/titans/g, "Titans");

    // Since we can't safely change all instances of "titan", most are in substitutions.json. We can do a few here,
    // though.
    xml = xml.replace(/dauntless titan/ig, "Dauntless Titan"); // Sometimes "Dauntless" isn't even capitalized.
    xml = xml.replace(/Kronos titan/g, "Kronos Titan");
  }

  // For the giants, the prevailing usage seems to be to keep the term lowercase, but capitalize when used as a name.
  xml = xml.replace(/(?<=Mathers |Goddess )giant/g, "Giant");
  xml = xml.replace(/mother giant/ig, "Mother Giant");
  xml = xml.replace(/(?<! {2}|“|>)Giants/g, "giants");

  return xml;
}

function fixMispellings(xml) {
  // This is commonly misspelled.
  xml = xml.replace(/([Ss])houlderblade/g, "$1houlder blade");

  // All dictionaries agree this is capitalized.
  xml = xml.replace(/u-turn/g, "U-turn");

  // https://www.dictionary.com/browse/scot-free
  xml = xml.replace(/scott(?: |-)free/g, "scot-free");

  // https://grammarist.com/idiom/change-tack/
  xml = xml.replace(/changed tacks/g, "changed tack");

  return xml;
}

function fixHyphens(xml) {
  // "X-year-old" should use hyphens; all grammar guides agree. The books are very inconsistent but most often omit
  // them.
  xml = xml.replace(/(\w+)[ -]year[ -]old(s?)(?!\w)/g, "$1-year-old$2");
  xml = xml.replace(/(\w+) or (\w+)-year-old/g, "$1- or $2-year-old");

  // Compound numbers from 11 through 99 must be hyphenated, but others should not be.
  xml = xml.replace(
    /(?<!\w)(twenty|thirty|fourty|fifty|sixty|seventy|eighty|ninety) (one|two|three|four|five|six|seven|eight|nine)/ig,
    "$1-$2"
  );
  xml = xml.replace(/[- ]hundred-and-/g, " hundred and ");
  xml = xml.replace(/(?<!-)(one|two|three|four|five|six|seven|eight|nine|twelve)-hundred/, "$1 hundred");
  xml = xml.replace(/(hundred|ninety)-percent(?!-)/g, "$1 percent");

  // "red-haired", "long-haired", etc.: they all need hyphens
  xml = xml.replace(/ haired/g, "-haired");

  // These are consistently missing hyphens.
  xml = xml.replace(/([Ll]ife) threatening/g, "life-threatening");
  xml = xml.replace(/([Hh]ard) headed/g, "$1-headed");
  xml = xml.replace(/([Ss]houlder) mounted/g, "$1-mounted");
  xml = xml.replace(/([Gg]olden) skinned/g, "$1-skinned");
  xml = xml.replace(/([Cc]reepy) crawl/g, "$1-crawl");
  xml = xml.replace(/([Ww]ell) armed/g, "$1-armed");
  xml = xml.replace(/([Aa]ble) bodied/g, "$1-bodied");
  xml = xml.replace(/([Ll]evel) headed/g, "$1-headed");
  xml = xml.replace(/([Cc]lear) cut/g, "$1-cut");
  xml = xml.replace(/([Vv]at) grown/g, "$1-grown");
  xml = xml.replace(/([Ss]hell) shocked/g, "$1-shocked");
  xml = xml.replace(/([Dd]og) tired/g, "$1-tired");
  xml = xml.replace(/([Nn]ightmare) filled/g, "$1-filled");
  xml = xml.replace(/([Oo]ne) sided/g, "$1-sided");
  xml = xml.replace(/([Mm]edium) sized/g, "$1-sized");
  xml = xml.replace(/([Tt]eary) eyed/g, "$1-eyed");
  xml = xml.replace(/([Ww]orst) case scenario/g, "$1-case scenario");
  xml = xml.replace(/([Ss]elf) (conscious|esteem|loathing|harm|destruct|preservation)/g, "$1-$2");
  xml = xml.replace(/([Oo]ne|[Tt]wo|[Tt]hree|[Ff]our|[Ff]ourth) dimensional/g, "$1-dimensional");
  xml = xml.replace(/(?<=\b)([Oo]ne) on one(?=\b)/g, "$1-on-one");

  // Preemptive(ly) is often hyphenated (not always). It should not be.
  xml = xml.replace(/([Pp])re-emptive/g, "$1reemptive");

  // These should be hyphenated only when used as a verb. We correct those cases back in substitutions.json.
  xml = xml.replace(/fist-bump/g, "fist bump");
  xml = xml.replace(/high-five/g, "high five");

  // This should be hyphenated when used as an adjective (instead of an adverb or noun). I.e. it should be
  // "hand-to-hand combat", but "passed from hand to hand", and "capable in hand to hand". The following heuristic works
  // in the books.
  xml = xml.replace(/hand to hand(?= [a-z])/g, "hand-to-hand");

  // This is usually wrong but sometimes correct. The lookarounds avoid specific cases where it's referring to an actual
  // second in a series of guesses.
  xml = xml.replace(/(?<!my |that )([Ss]econd) guess(?!es)/g, "$1-guess");

  // When used as a phrase "just in case" gets no hyphens. When used as a noun or adjective it does. A couple of the
  // noun cases are missing one or both hyphens.
  xml = xml.replace(/([Aa]) just[ -]in case/g, "$1 just-in-case");

  // When used as an adjective, it's hyphenated. It turns out most cases are as an adverb, so we go with this approach:
  xml = xml.replace(
    /face to face(?= meeting| hang-out| interaction| contact| conversation| confrontation| fight)/g,
    "face-to-face");

  // When used as an adjective, it's hyphenated. This heuristic works in the books.
  xml = xml.replace(/fight or flight(?= [a-z])/g, "fight-or-flight");

  // This is usually correct but sometimes wrong.
  xml = xml.replace(/neo /g, "neo-");

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
  xml = xml.replace(/(?<! {2})T-shirt/g, "t-shirt");

  // "gray" is the majority spelling, except for "greyhound"
  xml = xml.replace(/(G|g)rey(?!hound)/g, "$1ray");

  // 12 instances of "Dragon-craft", 12 instances of "Dragon craft", 1 instance of "dragon craft"
  xml = xml.replace(/[Dd]ragon[ -](craft|mech)/g, "Dragon-$1");

  // 88 instances of "A.I." to four of "AI"
  xml = xml.replace(/(?<=\b)AI(?=\b)/g, "A.I.");

  // 2 instances of "G.M." to one of "GM"
  xml = xml.replace(/(?<=\b)GM(?=\b)/g, "G.M.");

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

  xml = xml.replace(/case[ -](?:fifty[ -]three|53)(?!’)/ig, "Case Fifty-Three");
  xml = xml.replace(/case[ -](?:thirty[ -]two|53)(?!’)/ig, "Case Thirty-Two");
  xml = xml.replace(/case[ -](?:sixty[ -]nine|53)(?!’)/ig, "Case Sixty-Nine");

  xml = xml.replace(/(?<!in )case[ -](zero|one|two|three|four|twelve|fifteen|seventy|ninety)(?!-)/ig,
    (_, caseNumber) => "Case " + caseNumber[0].toUpperCase() + caseNumber.substring(1));

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
