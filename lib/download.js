"use strict";
const path = require("path");
const fs = require("fs").promises;
const { JSDOM } = require("jsdom");
const progressUtils = require("./progress-utils.js");

const FILENAME_PREFIX = "chapter";

module.exports = async (cachePath, manifestPath, bookData) => {
  await fs.mkdir(cachePath, { recursive: true });

  let manifest;
  try {
    const manifestContents = await fs.readFile(manifestPath, { encoding: "utf-8" });

    // Include this in the try/catch because it's possible to get interrupted while writing manifest.json, which would
    // result in a corrupt file. In that case we need to treat it as if the file doesn't exist.
    manifest = JSON.parse(manifestContents);
  } catch (e) {
    if (e.code === "ENOENT" || e.name === "SyntaxError") {
      return downloadAllChapters(null, bookData, cachePath, manifestPath);
    }
    throw e;
  }

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

  console.log(
    `Cache contains ${manifest.length - toDownloadManifestIndicesByURL.size}/${manifest.length} HTML pages`
  );
  if (toDownloadManifestIndicesByURL.size === 0) {
    return;
  }

  console.log(`Downloading ${toDownloadManifestIndicesByURL.size} remaining HTML pages`);

  const progress = progressUtils.start(toDownloadManifestIndicesByURL.size);

  const promises = [];
  let manifestUpdatePromise = null;
  for (const [chapterURL, manifestIndex] of toDownloadManifestIndicesByURL) {
    // eslint-disable-next-line no-loop-func
    promises.push((async () => {
      const filename = `${FILENAME_PREFIX}${manifestIndex.toString().padStart(3, "0")}.html`;

      const { contents, dom } = await downloadChapter(chapterURL);
      const title = getChapterTitle(dom.window.document);
      const datePublished = getChapterDatePublished(dom.window.document);
      const dateModified = getChapterDateModified(dom.window.document);

      dom.window.close();

      manifest[manifestIndex].title = title;
      manifest[manifestIndex].datePublished = datePublished;
      manifest[manifestIndex].dateModified = dateModified;
      manifest[manifestIndex].filename = filename;
      await fs.writeFile(path.resolve(cachePath, filename), contents);

      // Incrementally update the manifest after every successful download, instead of waiting until the end.
      // But don't start the update until the previous one is done.
      if (manifestUpdatePromise === null) {
        const newManifestContents = JSON.stringify(manifest, undefined, 2);
        manifestUpdatePromise = fs.writeFile(manifestPath, newManifestContents).then(() => {
          manifestUpdatePromise = null;
        });
      }

      progressUtils.increment(progress);
    })());
  }

  await Promise.all(promises);
  console.log(`All HTML pages downloaded in ${progressUtils.getTotalSeconds(progress)} seconds`);
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
  return rawChapterDoc.querySelector(`meta[property="article:published_time"]`).content;
}

function getChapterDateModified(rawChapterDoc) {
  return rawChapterDoc.querySelector(`meta[property="article:modified_time"]`).content;
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
