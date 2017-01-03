"use strict";
const path = require("path");
const fs = require("mz/fs");
const mkdirp = require("mkdirp-then");
const request = require("requisition");
const zfill = require("zfill");
const jsdom = require("./jsdom.js");

const FILENAME_PREFIX = "chapter";

module.exports = function (startChapterUrl, cachePath, manifestPath) {
  return fs.readFile(manifestPath, { encoding: "utf-8" }).then(
    function (manifestContents) {
      const manifest = JSON.parse(manifestContents);

      return downloadAllChapters(manifest, startChapterUrl, cachePath, manifestPath);
    },
    function (e) {
      if (e.code === "ENOENT") {
        return downloadAllChapters(null, startChapterUrl, cachePath, manifestPath);
      } else {
        throw e;
      }
    }
  );
};

function downloadAllChapters(manifest, startChapterUrl, cachePath, manifestPath) {
  let currentChapter = startChapterUrl;
  let chapterIndex = 0;
  if (manifest !== null) {
    currentChapter = manifest[manifest.length - 1].url;
    chapterIndex = manifest.length - 1;

    // We're going to re-add it to the manifest later, possibly with an updated title.
    manifest.pop();
  } else {
    manifest = [];
  }

  return mkdirp(cachePath).then(loop);

  function loop() {
    const filename = `${FILENAME_PREFIX}${zfill(chapterIndex, 3)}.html`;

    console.log(`Downloading ${currentChapter}`);

    return downloadChapter(currentChapter).then(function (response) {
      console.log("- Response received");
      return response.text();
    })
    .then(function (contents) {
      console.log("- Response body received");
      const rawChapterDoc = jsdom(contents, { url: currentChapter });
      console.log("- Response body parsed into DOM");

      const chapterUrlToSave = currentChapter;
      const chapterTitle = getChapterTitle(rawChapterDoc);
      currentChapter = getNextChapterUrl(rawChapterDoc);

      // TODO: this should probably not be necessary... jsdom bug I guess!?
      rawChapterDoc.defaultView.close();

      manifest.push({
        url: chapterUrlToSave,
        title: chapterTitle,
        filename
      });

      fs.writeFile(path.resolve(cachePath, filename), contents);
    })
    .then(function () {
      console.log("- Response text saved to cache file");
      // Incrementally update the manifest after every successful download, instead of waiting until the end.
      return writeManifest();
    })
    .then(function () {
      console.log("- Manifest updated");

      if (currentChapter === null) {
        return;
      }

      ++chapterIndex;

      return loop();
    });
  }

  function writeManifest() {
    const contents = JSON.stringify(manifest, undefined, 2);
    return fs.writeFile(manifestPath, contents);
  }
}

function getNextChapterUrl(rawChapterDoc) {
  // a[title="Next Chapter"] doesn"t always work. Two different pathologies:
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

  return fn().catch(function () {
    return retry(times - 1, fn);
  });
}

function downloadChapter(url) {
  return retry(3, () => {
    return request(url).redirects(10).then(response => {
      if (response.status !== 200) {
        throw new Error(`Response status for ${url} was ${response.status}`);
      }
      return response;
    });
  });
}
