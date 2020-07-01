"use strict";
const path = require("path");
const fs = require("fs").promises;
const request = require("requisition");
const { JSDOM } = require("jsdom");

const FILENAME_PREFIX = "chapter";

module.exports = async (startChapterURL, cachePath, manifestPath) => {
  let manifestContents;
  try {
    manifestContents = await fs.readFile(manifestPath, { encoding: "utf-8" });
  } catch (e) {
    if (e.code === "ENOENT") {
      return downloadAllChapters(null, startChapterURL, cachePath, manifestPath);
    }
    throw e;
  }

  const manifest = JSON.parse(manifestContents);
  return downloadAllChapters(manifest, startChapterURL, cachePath, manifestPath);
};

async function downloadAllChapters(manifest, startChapterURL, cachePath, manifestPath) {
  let currentChapter = startChapterURL;
  let chapterIndex = 0;
  if (manifest !== null) {
    currentChapter = manifest[manifest.length - 1].url;
    chapterIndex = manifest.length - 1;

    // We're going to re-add it to the manifest later, possibly with an updated title.
    manifest.pop();
  } else {
    manifest = [];
  }

  await fs.mkdir(cachePath, { recursive: true });

  while (currentChapter !== null) {
    const filename = `${FILENAME_PREFIX}${chapterIndex.toString().padStart(3, "0")}.html`;

    console.log(`Downloading ${currentChapter}`);

    const response = await downloadChapter(currentChapter);
    const contents = await response.text();
    console.log("- Response body received");
    const rawChapterJSDOM = new JSDOM(contents, { url: currentChapter });
    console.log("- Response body parsed into DOM");

    const chapterURLToSave = currentChapter;
    const chapterTitle = getChapterTitle(rawChapterJSDOM.window.document);
    currentChapter = getNextChapterURL(rawChapterJSDOM.window.document);

    // TODO: this should probably not be necessary... jsdom bug I guess!?
    rawChapterJSDOM.window.close();

    manifest.push({
      url: chapterURLToSave,
      title: chapterTitle,
      filename
    });

    await fs.writeFile(path.resolve(cachePath, filename), contents);
    console.log("- Response text saved to cache file");

    // Incrementally update the manifest after every successful download, instead of waiting until the end.
    const newManifestContents = JSON.stringify(manifest, undefined, 2);
    await fs.writeFile(manifestPath, newManifestContents);
    console.log("- Manifest updated");

    ++chapterIndex;
  }
}

function getNextChapterURL(rawChapterDoc) {
  // `a[title="Next Chapter"]` doesn"t always work. Two different pathologies:
  // - https://parahumans.wordpress.com/2011/09/27/shell-4-2/
  // - https://parahumans.wordpress.com/2012/04/21/sentinel-9-6/
  // So instead search for the first <a> within the main content area starting with "Next", trimmed.

  const aEls = rawChapterDoc.querySelectorAll(".entry-content a");
  for (let i = 0; i < aEls.length; ++i) {
    if (aEls[i].textContent.trim().startsWith("Next")) {
      return aEls[i].href;
    }
  }

  return null;
}

function getChapterTitle(rawChapterDoc) {
  return rawChapterDoc.querySelector("h1.entry-title").textContent;
}

function retry(times, fn) {
  if (times === 0) {
    return fn();
  }

  return fn().catch(() => {
    return retry(times - 1, fn);
  });
}

function downloadChapter(url) {
  return retry(3, async () => {
    const response = await request(url).redirects(10);
    if (response.status !== 200) {
      throw new Error(`Response status for ${url} was ${response.status}`);
    }
    return response;
  });
}
