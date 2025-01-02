"use strict";
const path = require("path");
const fs = require("fs").promises;
const { JSDOM } = require("jsdom");

const FILENAME_PREFIX = "chapter";

module.exports = async (cachePath, manifestPath, bookData) => {
  await fs.mkdir(cachePath, { recursive: true });

  let manifestContents;
  try {
    manifestContents = await fs.readFile(manifestPath, { encoding: "utf-8" });
  } catch (e) {
    if (e.code === "ENOENT") {
      return downloadAllChapters(null, bookData, cachePath, manifestPath);
    }
    throw e;
  }

  const manifest = JSON.parse(manifestContents);
  return downloadAllChapters(manifest, bookData, cachePath, manifestPath);
};

async function downloadAllChapters(manifest, bookData, cachePath, manifestPath) {
  const toDownloadManifestIndicesByURL = new Map();
  if (manifest === null) {
    // If we've never run the program before, create a skeleton manifest from the book data which consists of just URLs.
    manifest = [];
    for (const arc of bookData.arcs) {
      for (const chapter of arc.chapters) {
        const manifestEntry = { url: chapter.url };
        toDownloadManifestIndicesByURL.set(chapter.url, manifest.length);
        manifest.push(manifestEntry);
      }
    }
  } else {
    // Otherwise, note all the chapters which need to be downloaded, and their manifest entry indices which will be
    // updated as we perform those downloads.
    for (let i = 0; i < manifest.length; ++i) {
      const manifestEntry = manifest[i];
      if (!("filename" in manifestEntry)) {
        toDownloadManifestIndicesByURL.set(manifestEntry.url, i);
      }
    }
  }

  for (const [chapterURL, manifestIndex] of toDownloadManifestIndicesByURL) {
    const filename = `${FILENAME_PREFIX}${manifestIndex.toString().padStart(3, "0")}.html`;

    process.stdout.write(`Downloading ${chapterURL}... `);

    const { contents, dom } = await downloadChapter(chapterURL);
    const title = getChapterTitle(dom.window.document);
    const datePublished = getChapterDatePublished(dom.window.document);

    dom.window.close();

    manifest[manifestIndex].title = title;
    manifest[manifestIndex].datePublished = datePublished;
    manifest[manifestIndex].filename = filename;
    await fs.writeFile(path.resolve(cachePath, filename), contents);

    // Incrementally update the manifest after every successful download, instead of waiting until the end.
    const newManifestContents = JSON.stringify(manifest, undefined, 2);
    await fs.writeFile(manifestPath, newManifestContents);
    process.stdout.write("done\n");
  }
}

function getChapterTitle(rawChapterDoc) {
  // Remove " – " because it's present in Ward but not in Worm, which is inconsistent. (And leaving it in causes slight
  // issues down the line where we remove spaces around em dashes during conversion.)
  //
  // TODO: now that we have an "original" option, figure out how to just leave this as-is (without messing up the em
  // dash processing).
  return rawChapterDoc.querySelector("h1.entry-title").textContent.replace(/ – /u, " ");
}

function getChapterDatePublished(rawChapterDoc) {
  return rawChapterDoc.querySelector(".entry-date").dateTime;
}

async function downloadChapter(url) {
  const response = await downloadWithRetry(url);
  const contents = await response.text();
  const dom = new JSDOM(contents, { url });

  return { url, contents, dom };
}

function downloadWithRetry(url) {
  return retry(3, async () => {
    const response = await fetch(url);
    if (response.status !== 200) {
      throw new Error(`Response status for ${url} was ${response.status}`);
    }
    return response;
  });
}

function retry(times, fn) {
  if (times === 0) {
    return fn();
  }

  return fn().catch(() => {
    return retry(times - 1, fn);
  });
}
