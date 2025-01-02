"use strict";
const path = require("path");
const fs = require("fs").promises;
const workerpool = require("workerpool");
const cliProgress = require("cli-progress");

module.exports = async (
  cachePath,
  manifestPath,
  chapterDataPath,
  contentPath,
  bookData,
  concurrentJobs,
  chapterTitleStyle
) => {
  const manifestChapters = JSON.parse(await fs.readFile(manifestPath, { encoding: "utf-8" }));
  const chapterData = getChapterData(bookData.arcs, manifestChapters, chapterTitleStyle);

  await fs.writeFile(chapterDataPath, JSON.stringify(chapterData, null, 2));
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

    warnings.push(...await pool.exec("convertChapter", [chapter, bookData.title, inputPath, outputPath]));

    const seconds = String(Math.round((performance.now() - start) / 1000)).padStart(3);
    progress.increment({ time: `${seconds} s` });
  }));

  pool.terminate();

  for (const warning of warnings) {
    console.warn(warning);
  }

  console.log(`All chapters converted in ${Math.round((performance.now() - start) / 100) / 10} seconds`);
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
