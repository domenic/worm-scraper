"use strict";
const path = require("path");
const fs = require("fs").promises;
const workerpool = require("workerpool");
const cliProgress = require("cli-progress");

module.exports = async (cachePath, manifestPath, contentPath, book, concurrentJobs) => {
  const manifestContents = await fs.readFile(manifestPath, { encoding: "utf-8" });
  const chapters = JSON.parse(manifestContents);

  console.log("Converting raw downloaded HTML to EPUB chapters");
  const progress = new cliProgress.SingleBar({
    stopOnComplete: true,
    clearOnComplete: true
  }, cliProgress.Presets.shades_classic);
  progress.start(chapters.length, 0);

  const poolOptions = {};
  if (concurrentJobs !== undefined) {
    poolOptions.maxWorkers = concurrentJobs;
  }
  const pool = workerpool.pool(path.resolve(__dirname, "convert-worker.js"), poolOptions);

  await Promise.all(chapters.map(async chapter => {
    const inputPath = path.resolve(cachePath, chapter.filename);

    const destFileName = `${path.basename(chapter.filename, ".html")}.xhtml`;
    const outputPath = path.resolve(contentPath, destFileName);

    await pool.exec("convertChapter", [chapter, book, inputPath, outputPath]);

    progress.increment();
  }));

  pool.terminate();

  console.log("All chapters converted");
};
