"use strict";
const path = require("path");
const fs = require("fs").promises;
const workerpool = require("workerpool");
const progressUtils = require("./progress-utils.js");

module.exports = async (
  cachePath,
  manifestPath,
  chapterDataPath,
  contentPath,
  bookData,
  substitutionsPath,
  concurrentJobs,
  chapterTitleStyle
) => {
  const manifestChapters = JSON.parse(await fs.readFile(manifestPath, { encoding: "utf-8" }));
  const chapterData = getChapterData(bookData.arcs, manifestChapters, chapterTitleStyle);

  await fs.writeFile(chapterDataPath, JSON.stringify(chapterData, null, 2));
  const flattenedChapters = chapterData.flatMap(arc => arc.chapters);

  const substitutionsText = await fs.readFile(substitutionsPath, { encoding: "utf-8" });
  const substitutions = parseSubstitutions(substitutionsText);

  console.log("Converting raw downloaded HTML to EPUB chapters");
  const progress = progressUtils.start(flattenedChapters.length);

  const poolOptions = {};
  if (concurrentJobs !== undefined) {
    poolOptions.maxWorkers = concurrentJobs;
  }
  const pool = workerpool.pool(path.resolve(__dirname, "convert-worker.js"), poolOptions);

  const warnings = [];
  await Promise.all(flattenedChapters.map(async chapter => {
    const inputPath = path.resolve(cachePath, chapter.inputFilename);
    const outputPath = path.resolve(contentPath, chapter.outputFilename);
    const chapterSubstitutions = substitutions.get(chapter.url) || [];

    warnings.push(...await pool.exec("convertChapter", [
      chapter,
      bookData.title,
      inputPath,
      outputPath,
      chapterSubstitutions
    ]));

    progressUtils.increment(progress);
  }));

  pool.terminate();

  for (const warning of warnings) {
    console.warn(warning);
  }

  console.log(`All chapters converted in ${progressUtils.getTotalSeconds(progress)} seconds`);
};

function getChapterData(arcs, manifest, chapterTitleStyle) {
  const manifestMap = new Map(manifest.map(entry => [entry.url, entry]));

  const chapterData = structuredClone(arcs);
  for (const arc of chapterData) {
    for (const chapter of arc.chapters) {
      const manifestEntry = manifestMap.get(chapter.url);
      chapter.inputFilename = manifestEntry.filename;
      chapter.outputFilename = `${path.basename(chapter.inputFilename, ".html")}.xhtml`;
      chapter.originalTitle = manifestEntry.title;
      chapter.usedTitle = chooseChapterTitle(chapter, chapterTitleStyle);
      chapter.datePublished = manifestEntry.datePublished;
      chapter.dateModified = manifestEntry.dateModified;
    }
  }

  return chapterData;
}

function chooseChapterTitle(chapterData, chapterTitleStyle) {
  if (chapterTitleStyle === "original") {
    if (!chapterData.originalTitle) {
      throw new Error(`originalTitle not found in chapter data for ${chapterData.url}`);
    }
    return chapterData.originalTitle;
  }
  if (chapterTitleStyle === "simplified") {
    if (!chapterData.simplifiedTitle) {
      throw new Error(`simplifiedTitle not found in chapter data for ${chapterData.url}`);
    }
    return chapterData.simplifiedTitle;
  }
  if (chapterTitleStyle === "character-names") {
    if (!chapterData.characterNamesTitle) {
      if (!chapterData.simplifiedTitle) {
        throw new Error(`Neither characterNamesTitle nor simplifiedTitle found in chapter data for ${chapterData.url}`);
      }
      return chapterData.simplifiedTitle;
    }
    return chapterData.characterNamesTitle;
  }

  throw new Error(`Invalid chapter title style: ${chapterTitleStyle}`);
}

function parseSubstitutions(text) {
  const lines = text.split("\n");
  const result = new Map();

  let currentChapter = null;
  let currentBefore = null;
  let currentRegExp = null;

  for (const [lineNumber, line] of Object.entries(lines)) {
    // Skip empty lines
    if (!line.trim()) {
      continue;
    }

    const errorPrefix = `Error in substitutions line "${line}" (line number ${Number(lineNumber) + 1}): `;

    let sigil, content;
    try {
      [, sigil, content] = /(@ | {2}- | {2}\+ ?| {2}r | {2}s | {2}# )(.*)/u.exec(line);
    } catch {
      throw new Error(`${errorPrefix}invalid line format`);
    }

    switch (sigil) {
      // New chapter
      case "@ ": {
        if (!isCanonicalizedURL(content)) {
          throw new Error(`${errorPrefix}invalid chapter URL`);
        }

        currentChapter = content;
        if (!result.has(currentChapter)) {
          result.set(currentChapter, []);
        }
        currentBefore = null;
        currentRegExp = null;

        break;
      }

      // Before line
      case "  - ": {
        if (!currentChapter) {
          throw new Error(`${errorPrefix}missing previous current chapter (@) line`);
        }
        if (currentBefore) {
          throw new Error(`${errorPrefix}appeared after a before (-) line`);
        }
        if (currentRegExp) {
          throw new Error(`${errorPrefix}appeared after a regexp (r) line`);
        }

        currentBefore = content.replaceAll("\\n", "\n");
        currentRegExp = null;

        break;
      }

      // After line
      case "  +":
      case "  + ": {
        if (!currentChapter || !currentBefore) {
          throw new Error(`${errorPrefix}missing previous current chapter (@) or before (-) line`);
        }
        if (currentRegExp) {
          throw new Error(`${errorPrefix}appeared after a regexp (r) line`);
        }

        const change = {
          before: beforeAfterLineToString(currentBefore),
          after: beforeAfterLineToString(content)
        };
        result.get(currentChapter).push(change);
        currentBefore = null;

        break;
      }

      // RegExp line
      case "  r ": {
        if (!currentChapter) {
          throw new Error(`${errorPrefix}missing previous current chapter (@) line`);
        }
        if (currentBefore) {
          throw new Error(`${errorPrefix}appeared after a before (-) line`);
        }

        currentRegExp = new RegExp(content, "ug");

        break;
      }

      // RegExp substitution
      case "  s ": {
        if (!currentChapter || !currentRegExp) {
          throw new Error(`${errorPrefix}missing previous current chapter (@) or regexp (r) line`);
        }

        const change = {
          regExp: currentRegExp,
          replacement: content.replaceAll("\\n", "\n")
        };
        result.get(currentChapter).push(change);
        currentRegExp = null;

        break;
      }

      // Comment
      case "  # ": {
        if (!currentChapter) {
          throw new Error(`${errorPrefix} missing previous current chapter (@) line`);
        }

        break;
      }
    }
  }

  return result;
}

function isCanonicalizedURL(urlString) {
  return URL.parse(urlString).href === urlString;
}

function beforeAfterLineToString(line) {
  return line.replaceAll("\\n", "\n").replace(/(?:\\s)+$/u, match => " ".repeat(match.length / 2));
}
