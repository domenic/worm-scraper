"use strict";
const fs = require("fs").promises;
const path = require("path");
const chooseChapterTitle = require("./choose-chapter-title.js");

const BOOK_PUBLISHER = "Domenic Denicola";
const BOOK_AUTHOR = "Wildbow";

const COVER_DOCUMENT_FILENAME = "cover.xhtml";
const COVER_IMAGE_FILENAME = "cover.jpg";
const COVER_IMAGE_MIMETYPE = "image/jpeg";
const NAV_FILENAME = "nav.xhtml";

module.exports = async (
  scaffoldingPath,
  coverImagePath,
  bookPath,
  contentPath,
  chaptersPath,
  manifestPath,
  chapterDataPath,
  bookInfo,
  chapterTitleStyle
) => {
  await Promise.all([
    fs.cp(scaffoldingPath, bookPath, { recursive: true, filter: noThumbs }),
    fs.cp(coverImagePath, path.resolve(bookPath, "OEBPS", COVER_IMAGE_FILENAME)),
    getChapterInfo(contentPath, chaptersPath, manifestPath, chapterDataPath, chapterTitleStyle).then(info => {
      return Promise.all([
        writeOPF(contentPath, bookInfo, info.manifestAndSpineFiles, info.datePublished),
        writeNav(contentPath, info.manifestAndSpineFiles, info.tocHTML),
        writeArcTitlePages(chaptersPath, info.arcTitlePages)
      ]);
    })
  ]);

  console.log(`EPUB contents assembled into ${scaffoldingPath}`);
};

function noThumbs(filePath) {
  return path.basename(filePath) !== "Thumbs.db";
}

function writeOPF(contentPath, bookInfo, manifestAndSpineFiles, datePublished) {
  const manifestItems = manifestAndSpineFiles.map(f => {
    return `    <item id="${f.id}" href="${f.href}" media-type="application/xhtml+xml"/>`;
  }).join("\n");

  const spineItemrefs = manifestAndSpineFiles.map(f => {
    return `    <itemref idref="${f.id}"/>`;
  }).join("\n");

  const dateWithoutMilliseconds = `${(new Date()).toISOString().split(".")[0]}Z`;

  // Note: per the spec at https://www.w3.org/TR/epub-33/#sec-group-position it seems like the collection-type should be
  // "set", but Calibre only recognizes "series" as of now:
  // https://github.com/kovidgoyal/calibre/blob/37dd0f5c70ebf8952d7be6dd7c37afd2a4fce9f0/src/calibre/ebooks/metadata/opf3.py#L792

  /* eslint-disable max-len */
  const contents = `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">

  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">urn:uuid:${bookInfo.id}</dc:identifier>
    <dc:language>en</dc:language>

    <dc:title id="title">${bookInfo.title}</dc:title>
    <meta refines="#title" property="title-type">main</meta>

    <meta property="belongs-to-collection" id="collection">Parahumans</meta>
    <meta refines="#collection" property="collection-type">series</meta>
    <meta refines="#collection" property="group-position">${bookInfo.groupPosition}</meta>

    <dc:creator id="creator">${BOOK_AUTHOR}</dc:creator>
    <meta refines="#creator" property="role" scheme="marc:relators">aut</meta>
    <dc:publisher>${BOOK_PUBLISHER}</dc:publisher>

    <dc:date>${datePublished}</dc:date>
    <meta property="dcterms:modified">${dateWithoutMilliseconds}</meta>

    <dc:description>${bookInfo.description}</dc:description>
  </metadata>

  <manifest>
    <item id="nav" href="${NAV_FILENAME}" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="${COVER_DOCUMENT_FILENAME}" media-type="application/xhtml+xml"/>
    <item id="cover-image" href="${COVER_IMAGE_FILENAME}" media-type="${COVER_IMAGE_MIMETYPE}" properties="cover-image"/>
${manifestItems}
  </manifest>

  <spine>
    <itemref idref="cover"/>
${spineItemrefs}
  </spine>
</package>`;
  /* eslint-enable max-len */

  return fs.writeFile(path.resolve(contentPath, "content.opf"), contents);
}


function writeNav(contentPath, manifestAndSpineFiles, tocHTML) {
  const contents = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Table of Contents</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
${tocHTML}
  </nav>
  <nav epub:type="landmarks">
    <h2>Guide</h2>
    <ol>
      <li><a epub:type="cover" href="${COVER_DOCUMENT_FILENAME}">Cover</a></li>
      <li><a epub:type="bodymatter" href="${manifestAndSpineFiles[0].href}">Begin Reading</a></li>
    </ol>
  </nav>
</body>
</html>`;

  return fs.writeFile(path.resolve(contentPath, NAV_FILENAME), contents);
}

async function getChapterInfo(contentPath, chaptersPath, manifestPath, chapterDataPath, chapterTitleStyle) {
  const hrefPrefix = `${path.relative(contentPath, chaptersPath)}/`;

  const [manifestContents, chapterDataContents] = await Promise.all([
    fs.readFile(manifestPath, { encoding: "utf-8" }),
    fs.readFile(chapterDataPath, { encoding: "utf-8" })
  ]);
  const manifestChapters = JSON.parse(manifestContents);
  const chapterData = JSON.parse(chapterDataContents);

  augmentAndCheckChapterData(chapterData, manifestChapters);

  const arcTitlePages = [];
  const manifestAndSpineFiles = [];
  let tocHTML = "    <ol>\n";
  let arcIdCounter = 0;
  for (const arc of chapterData) {
    const arcFilename = `arc${arcIdCounter}.xhtml`;
    const arcId = path.basename(arcFilename, ".xhtml");
    const arcHref = `${hrefPrefix}${arcFilename}`;

    arcTitlePages.push({
      filename: arcFilename,
      label: arc.label,
      title: arc.title
    });
    manifestAndSpineFiles.push({
      id: arcId,
      href: arcHref
    });
    tocHTML += `      <li>
        <a href="${arcHref}">${arcPlaintextTitle(arc)}</a>
        <ol>\n`;

    for (const chapter of arc.chapters) {
      const chapterHref = `${hrefPrefix}${chapter.filename}`;
      const chapterTitle = chooseChapterTitle(chapter, chapterTitleStyle);
      manifestAndSpineFiles.push({
        id: path.basename(chapter.filename, ".xhtml"),
        href: chapterHref
      });

      tocHTML += `          <li><a href="${chapterHref}">${chapterTitle}</a></li>\n`;
    }
    tocHTML += `        </ol>
      </li>\n`;

    ++arcIdCounter;
  }

  tocHTML += `    </ol>`;

  // We say that the publication date of the book is equal to the publication date of the last chapter.
  const { datePublished } = manifestChapters.at(-1);

  return { arcTitlePages, manifestAndSpineFiles, tocHTML, datePublished };
}

async function writeArcTitlePages(chaptersPath, arcTitlePages) {
  const promises = [];
  for (const arc of arcTitlePages) {
    const output = `<?xml version="1.0" encoding="utf-8" ?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en" class="arc-title">
  <head>
    <meta charset="utf-8"/>
    <title>${arcPlaintextTitle(arc)}</title>
    <link rel="stylesheet" href="../chapter.css"/>
  </head>
  <body>
    <h1><span class="arc-label">${arc.label}</span> ${arc.title}</h1>
  </body>
</html>`;

    promises.push(fs.writeFile(path.resolve(chaptersPath, arc.filename), output));
  }

  await Promise.all(promises);
}

// This function modifies chapterData in place, adding filename and originalTitle properties to each chapter. (filename
// contains the converted filename, not the original input one). It also checks that the downloaded-chapters manifest
// and the prepackaged chapter data are in sync. If they're not, we'll be unable to create arc title pages and a table
// of contents, so we'll error out.
function augmentAndCheckChapterData(chapterData, manifestChapters) {
  for (const manifestChapter of manifestChapters) {
    let found = false;
    for (const arc of chapterData) {
      for (const chapterInArc of arc.chapters) {
        if (manifestChapter.url === chapterInArc.url) {
          chapterInArc.filename = `${path.basename(manifestChapter.filename, ".html")}.xhtml`;
          chapterInArc.originalTitle = manifestChapter.title;
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

function arcPlaintextTitle(arc) {
  return `${arc.label}: ${arc.title}`;
}
