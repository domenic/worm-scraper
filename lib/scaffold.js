"use strict";
const fs = require("fs").promises;
const path = require("path");

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
  bookInfo
) => {
  await Promise.all([
    fs.cp(scaffoldingPath, bookPath, { recursive: true, filter: noThumbs }),
    fs.cp(coverImagePath, path.resolve(bookPath, "OEBPS", COVER_IMAGE_FILENAME)),
    getChaptersAndDatePublished(contentPath, chaptersPath, manifestPath).then(([chapters, datePublished]) => {
      return Promise.all([
        writeOPF(chapters, contentPath, bookInfo, datePublished),
        writeNav(chapters, contentPath)
      ]);
    })
  ]);

  console.log(`EPUB contents assembled into ${scaffoldingPath}`);
};

function noThumbs(filePath) {
  return path.basename(filePath) !== "Thumbs.db";
}

function writeOPF(chapters, contentPath, bookInfo, datePublished) {
  const manifestChapters = chapters.map(c => {
    return `    <item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`;
  }).join("\n");

  const spineChapters = chapters.map(c => {
    return `    <itemref idref="${c.id}"/>`;
  }).join("\n");

  const dateWithoutMilliseconds = `${(new Date()).toISOString().split(".")[0]}Z`;

  /* eslint-disable max-len */
  const contents = `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">

  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">urn:uuid:${bookInfo.id}</dc:identifier>
    <dc:language>en</dc:language>

    <dc:title id="title">${bookInfo.title}</dc:title>
    <meta refines="#title" property="title-type">main</meta>

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
${manifestChapters}
  </manifest>

  <spine>
    <itemref idref="cover"/>
${spineChapters}
  </spine>
</package>`;
  /* eslint-enable max-len */

  return fs.writeFile(path.resolve(contentPath, "content.opf"), contents);
}


function writeNav(chapters, contentPath) {
  const navPoints = chapters.map(c => {
    return `      <li><a href="${c.href}">${c.title}</a></li>`;
  }).join("\n");

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
    <ol>
${navPoints}
    </ol>
  </nav>
  <nav epub:type="landmarks">
    <h2>Guide</h2>
    <ol>
      <li><a epub:type="cover" href="${COVER_DOCUMENT_FILENAME}">Cover</a></li>
      <li><a epub:type="bodymatter" href="${chapters[0].href}">Begin Reading</a></li>
    </ol>
  </nav>
</body>
</html>`;

  return fs.writeFile(path.resolve(contentPath, NAV_FILENAME), contents);
}

async function getChaptersAndDatePublished(contentPath, chaptersPath, manifestPath) {
  const hrefPrefix = `${path.relative(contentPath, chaptersPath)}/`;

  const manifestContents = await fs.readFile(manifestPath, { encoding: "utf-8" });
  const manifestChapters = JSON.parse(manifestContents);

  const filenames = await fs.readdir(chaptersPath);

  const chapters = filenames
    .filter(f => path.extname(f) === ".xhtml")
    .sort()
    .map((f, i) => {
      return {
        id: path.basename(f),
        title: manifestChapters[i].title,
        href: `${hrefPrefix}${f}`
      };
    });

  // We say that the publication date of the book is equal to the publication date of the last chapter.
  const { datePublished } = manifestChapters.at(-1);

  return [chapters, datePublished];
}
