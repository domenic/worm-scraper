"use strict";
const path = require("path");
const fs = require("fs").promises;
const { performance } = require("perf_hooks");
const workerpool = require("workerpool");
const cliProgress = require("cli-progress");
const chooseChapterTitle = require("./choose-chapter-title.js");

module.exports =
async (cachePath, manifestPath, chapterDataPath, contentPath, book, concurrentJobs, chapterTitleStyle) => {
  const [manifestContents, chapterDataContents] = await Promise.all([
    fs.readFile(manifestPath, { encoding: "utf-8" }),
    fs.readFile(chapterDataPath, { encoding: "utf-8" })
  ]);
  const manifestChapters = JSON.parse(manifestContents);
  const chapterData = JSON.parse(chapterDataContents);

  for (const chapter of manifestChapters) {
    let found = false;
    for (const arc of chapterData) {
      for (const chapterInArc of arc.chapters) {
        if (chapter.url === chapterInArc.url) {
          chapter.title = chooseChapterTitle(chapterInArc, chapterTitleStyle);
          found = true;
          break;
        }
      }
    }
    if (!found) {
      throw new Error(`Chapter data not found for ${chapter.url}`);
    }
  }

  console.log("Converting raw downloaded HTML to EPUB chapters");
  const progress = new cliProgress.SingleBar({
    stopOnComplete: true,
    clearOnComplete: true,
    format: " {bar} {percentage}% | {time} | {value}/{total}"
  }, cliProgress.Presets.shades_classic);

  const start = performance.now();
  progress.start(manifestChapters.length, 0, { time: "     " });

  const poolOptions = {};
  if (concurrentJobs !== undefined) {
    poolOptions.maxWorkers = concurrentJobs;
  }
  const pool = workerpool.pool(path.resolve(__dirname, "convert-worker.js"), poolOptions);

  const warnings = [];
  await Promise.all(manifestChapters.map(async chapter => {
    const inputPath = path.resolve(cachePath, chapter.filename);

    const destFileName = `${path.basename(chapter.filename, ".html")}.xhtml`;
    const outputPath = path.resolve(contentPath, destFileName);

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
