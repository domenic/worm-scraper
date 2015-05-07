"use strict";
const path = require("path");
const fs = require("mz/fs");
const mkdirp = require("mkdirp-then");
const request = require("requisition");
const jsdom = require("./jsdom.js");

const FILENAME_PREFIX = "chapter";
const URL_SUFFIX = "-url.txt";

module.exports = function (startChapterUrl, cachePath) {
  return fs.readdir(cachePath).then(
    function (filenames) {
      const lastChapter = filenames.filter(function (f) {
        return f.endsWith(URL_SUFFIX);
      })
      .map(function (f) {
        return [getChapterNumber(f), f];
      })
      .sort(function (a, b) {
        return b[0] - a[0];
      })
      [0];

      const lastChapterNumber = lastChapter[0];
      const lastChapterUrlFile = lastChapter[1];

      return fs.readFile(path.resolve(cachePath, lastChapterUrlFile), { encoding: "utf-8" }).then(function (url) {
        return downloadAllChapters(url, lastChapterNumber, cachePath);
      });
    },
    function (e) {
      if (e.code === "ENOENT") {
        return downloadAllChapters(startChapterUrl, 1, cachePath);
      } else {
        throw e;
      }
    }
  );
};

function downloadAllChapters(startChapterUrl, startChapterNumber, cachePath) {
  let currentChapter = startChapterUrl;
  let chapterCounter = startChapterNumber;

  return mkdirp(cachePath).then(loop);

  function loop() {
    const filename = `${FILENAME_PREFIX}${chapterCounter}.html`;

    console.log(`Downloading ${currentChapter}`);

    // Necessary for https://parahumans.wordpress.com/2011/10/11/interlude-3½-bonus/
    const escapedUrl = encodeURI(currentChapter);

    return retry(3, function () { return request(escapedUrl).redirects(10); }).then(function (response) {
      console.log("- Response received");
      return response.text();
    })
    .then(function (contents) {
      console.log("- Response body received");
      const rawChapterDoc = jsdom(contents, { url: currentChapter });
      console.log("- Response body parsed into DOM");

      const chapterUrlToSave = currentChapter;
      currentChapter = getNextChapterUrl(rawChapterDoc);
      console.log("- Got next chapter URL");

      // TODO: this should probably not be necessary... jsdom bug I guess!?
      rawChapterDoc.defaultView.close();

      return [
        fs.writeFile(path.resolve(cachePath, filename), contents),
        fs.writeFile(path.resolve(cachePath, urlFilename(filename)), chapterUrlToSave)
      ];
    })
    .then(function () {
      console.log("- Response text saved to cache file");
      if (currentChapter === null) {
        return;
      }

      ++chapterCounter;
      return loop();
    });
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

function retry(times, fn) {
  if (times === 0) {
    return fn();
  }

  return fn().catch(function () {
    return retry(times - 1, fn);
  });
}

function urlFilename(filename) {
  return `${filename}${URL_SUFFIX}`;
}

function getChapterNumber(filename) {
  return Number(filename.substring(FILENAME_PREFIX.length, filename.indexOf(".html")));
}
