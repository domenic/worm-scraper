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

    process.stdout.write(`Downloading ${currentChapter}... `);

    const { contents, dom, url } = await downloadChapter(currentChapter);
    const title = getChapterTitle(dom.window.document);
    currentChapter = getNextChapterURL(dom.window.document);

    dom.window.close();

    manifest.push({ url, title, filename });
    await fs.writeFile(path.resolve(cachePath, filename), contents);

    // Incrementally update the manifest after every successful download, instead of waiting until the end.
    const newManifestContents = JSON.stringify(manifest, undefined, 2);
    await fs.writeFile(manifestPath, newManifestContents);
    process.stdout.write("done\n");

    ++chapterIndex;
  }
}

function getNextChapterURL(rawChapterDoc) {
  // `a[title="Next Chapter"]` doesn"t always work. Two different pathologies:
  // - https://parahumans.wordpress.com/2011/09/27/shell-4-2/
  // - https://parahumans.wordpress.com/2012/04/21/sentinel-9-6/
  // So instead search for the first <a> within the main content area starting with "Next", trimmed.

  let result = null;
  const aEls = rawChapterDoc.querySelectorAll(".entry-content a");
  for (let i = 0; i < aEls.length; ++i) {
    if (aEls[i].textContent.trim().startsWith("Next")) {
      result = aEls[i].href;
      break;
    }
  }

  // Except, this doesn't always work, because the "Next Chapter" link in
  // https://www.parahumans.net/2020/04/28/last-20-e6/ is just broken for some reason. We hard-code that.
  if (result === "https://www.parahumans.net/?p=3365&preview=true") {
    return "https://www.parahumans.net/2020/05/02/last-20-end/";
  }
  return result;
}

function getChapterTitle(rawChapterDoc) {
  // Remove " – " because it's present in Ward but not in Worm, which is inconsistent. (And leaving it in causes slight
  // issues down the line where we remove spaces around em dashes during conversion.) In the future it might be nice to
  // have proper chapter titles, e.g. sections per arc with title pages and then just "1" or similar for the chapter.
  // Until then this is reasonable and uniform.
  return rawChapterDoc.querySelector("h1.entry-title").textContent.replace(/ – /u, " ");
}

function retry(times, fn) {
  if (times === 0) {
    return fn();
  }

  return fn().catch(() => {
    return retry(times - 1, fn);
  });
}

async function downloadChapter(startingURL) {
  let urlToFollow = startingURL;

  let url, contents, dom;
  while (urlToFollow !== null) {
    const response = await downloadWithRetry(urlToFollow);

    url = urlToFollow;
    contents = await response.text();
    dom = new JSDOM(contents, { url });

    const refreshMeta = dom.window.document.querySelector("meta[http-equiv=refresh]");
    if (refreshMeta) {
      [, urlToFollow] = /\d+;url=(.*)/ui.exec(refreshMeta.content);
      process.stdout.write(`\n  Redirected to ${urlToFollow}... `);
      dom.window.close();
    } else {
      urlToFollow = null;
    }
  }

  return { url, contents, dom };
}

function downloadWithRetry(url) {
  return retry(3, async () => {
    const response = await request(url).redirects(10);
    if (response.status !== 200) {
      throw new Error(`Response status for ${url} was ${response.status}`);
    }
    return response;
  });
}
