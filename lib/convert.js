"use strict";
const path = require("path");
const fs = require("fs").promises;
const { performance } = require("perf_hooks");
const workerpool = require("workerpool");
const cliProgress = require("cli-progress");

module.exports = async (
  cachePath,
  manifestPath,
  inputChapterDataPath,
  augmentedChapterDataPath,
  contentPath,
  book,
  concurrentJobs,
  chapterTitleStyle
) => {
  const [manifestContents, chapterDataContents] = await Promise.all([
    fs.readFile(manifestPath, { encoding: "utf-8" }),
    fs.readFile(inputChapterDataPath, { encoding: "utf-8" })
  ]);
  const manifestChapters = JSON.parse(manifestContents);
  const chapterData = JSON.parse(chapterDataContents);
  augmentAndCheckChapterData(chapterData, manifestChapters, chapterTitleStyle);
  await fs.writeFile(augmentedChapterDataPath, JSON.stringify(chapterData, null, 2));
  const flattenedChapters = chapterData.flatMap(arc => arc.chapters);

  console.log("Converting raw downloaded HTML to EPUB chapters");
  const progress = new cliProgress.SingleBar({
    stopOnComplete: true,
    clearOnComplete: true,
    format: " {bar} {percentage}% | {time} | {value}/{total}"
  }, cliProgress.Presets.shades_classic);

  const start = performance.now();
  progress.start(flattenedChapters.length, 0, { time: "     " });

  const poolOptions = {};
  if (concurrentJobs !== undefined) {
    poolOptions.maxWorkers = concurrentJobs;
  }
  const pool = workerpool.pool(path.resolve(__dirname, "convert-worker.js"), poolOptions);

  const warnings = [];
  await Promise.all(flattenedChapters.map(async chapter => {
    const inputPath = path.resolve(cachePath, chapter.inputFilename);
    const outputPath = path.resolve(contentPath, chapter.outputFilename);

    warnings.push(...await pool.exec("convertChapter", [chapter, book, inputPath, outputPath]));

    const seconds = String(Math.round((performance.now() - start) / 1000)).padStart(3);
    progress.increment({ time: `${seconds} s` });
  }));

  pool.terminate();

  for (const warning of warnings) {
    console.warn(warning);
  }

  console.log(`All chapters converted in ${Math.round((performance.now() - start) / 100) / 10} seconds`);
};

// This function modifies chapterData in place, adding filename and originalTitle properties to each chapter. (filename
// contains the converted filename, not the original input one). It also checks that the downloaded-chapters manifest
// and the prepackaged chapter data are in sync. If they're not, we'll be unable to create arc title pages and a table
// of contents, so we'll error out.
function augmentAndCheckChapterData(chapterData, manifestChapters, chapterTitleStyle) {
  for (const manifestChapter of manifestChapters) {
    let found = false;
    for (const arc of chapterData) {
      for (const chapterInArc of arc.chapters) {
        if (manifestChapter.url === chapterInArc.url) {
          chapterInArc.inputFilename = manifestChapter.filename;
          chapterInArc.outputFilename = `${path.basename(chapterInArc.inputFilename, ".html")}.xhtml`;
          chapterInArc.originalTitle = manifestChapter.title;
          chapterInArc.usedTitle = chooseChapterTitle(chapterInArc, chapterTitleStyle);
          chapterInArc.datePublished = manifestChapter.datePublished;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      throw new Error(`Chapter data not found for ${manifestChapter.url} which appeared in the manifest`);
    }
  }

  for (const arc of chapterData) {
    for (const chapter of arc.chapters) {
      let found = false;
      for (const manifestChapter of manifestChapters) {
        if (chapter.url === manifestChapter.url) {
          found = true;
          break;
        }
      }
      if (!found) {
        throw new Error(`Chapter data found for ${chapter.url} which did not appear in the manifest`);
      }
    }
  }
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
