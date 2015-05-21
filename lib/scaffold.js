"use strict";
const fs = require("mz/fs");
const path = require("path");

const BOOK_TITLE = "Worm";
const BOOK_AUTHOR = "wildbow";
const BOOK_ID = "urn:uuid:e7f3532d-8db6-4888-be80-1976166b7059";

const NCX_FILENAME = "toc.ncx";

module.exports = function (contentPath, chaptersPath, manifestPath) {
  return getChapters(contentPath, chaptersPath, manifestPath).then(function (chapters) {
    return Promise.all([
      writeOpf(chapters, contentPath),
      writeNcx(chapters, contentPath)
    ]);
  });
};

function writeOpf(chapters, contentPath) {
  const manifestChapters = chapters.map(function (c) {
    return `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`;
  }).join("\n");

  const spineChapters = chapters.map(function (c) {
    return `<itemref idref="${c.id}"/>`;
  }).join("\n");

  const contents = `<?xml version="1.0"?>
<package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId">

  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${BOOK_TITLE}</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId" opf:scheme="UUID">${BOOK_ID}</dc:identifier>
    <dc:creator opf:file-as="${BOOK_AUTHOR}" opf:role="aut">${BOOK_AUTHOR}</dc:creator>
  </metadata>

  <manifest>
${manifestChapters}
<item id="ncx" href="${NCX_FILENAME}" media-type="application/x-dtbncx+xml"/>
  </manifest>

  <spine toc="ncx">
${spineChapters}
  </spine>
</package>`;

  return fs.writeFile(path.resolve(contentPath, "content.opf"), contents);
}

function writeNcx(chapters, contentPath) {
  const navPoints = chapters.map(function (c, i) {
    return `<navPoint class="chapter" id="${c.id}" playOrder="${i + 1}">
  <navLabel><text>${c.title}</text></navLabel>
  <content src="${c.href}"/>
</navPoint>`;
  }).join("\n");

  const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
 <ncx version="2005-1" xml:lang="en" xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <head>
    <meta name="dtb:uid" content="${BOOK_ID}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>

  <docTitle>
    <text>${BOOK_TITLE}</text>
  </docTitle>

  <docAuthor>
    <text>${BOOK_AUTHOR}</text>
  </docAuthor>

  <navMap>
${navPoints}
  </navMap>
</ncx>`;

  return fs.writeFile(path.resolve(contentPath, NCX_FILENAME), contents);
}

function getChapters(contentPath, chaptersPath, manifestPath) {
  const hrefPrefix = `${path.relative(contentPath, chaptersPath)}/`;

  return fs.readFile(manifestPath, { encoding: "utf-8" }).then(function (manifestContents) {
    const manifestChapters = JSON.parse(manifestContents);

    return fs.readdir(chaptersPath).then(function (filenames) {
      return filenames.filter(function (f) {
        return path.extname(f) === ".xhtml";
      })
      .sort()
      .map(function (f, i) {
        return {
          id: path.basename(f),
          title: manifestChapters[i].title,
          href: `${hrefPrefix}${f}`
        };
      });
    });
  });
}
