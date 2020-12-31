"use strict";
const fs = require("fs").promises;
const path = require("path");
const cpr = require("util").promisify(require("cpr"));

const BOOK_PUBLISHER = "Domenic Denicola";
const BOOK_AUTHOR = "Wildbow";

const NCX_FILENAME = "toc.ncx";

module.exports = async (scaffoldingPath, coverPath, bookPath, contentPath, chaptersPath, manifestPath, bookInfo) => {
  await Promise.all([
    cpr(scaffoldingPath, bookPath, { overwrite: true, confirm: true, filter: noThumbs }),
    cpr(coverPath, path.resolve(bookPath, "OEBPS"), { overwrite: true, confirm: true, filter: noThumbs }),
    Promise.all([
      getChapters(contentPath, chaptersPath, manifestPath),
      getCoverFiles(coverPath)
    ]).then(([chapters, coverFiles]) => {
      return Promise.all([
        writeOPF(chapters, contentPath, coverFiles, bookInfo),
        writeNcx(chapters, contentPath, bookInfo)
      ]);
    })
  ]);

  console.log(`EPUB contents assembled into ${scaffoldingPath}`);
};

function noThumbs(filePath) {
  // Thumbs.db causes the strangest errors as Windows has it locked a lot of the time.
  return path.basename(filePath) !== "Thumbs.db";
}

function writeOPF(chapters, contentPath, coverFiles, bookInfo) {
  const manifestChapters = chapters.map(c => {
    return `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`;
  }).join("\n");

  const spineChapters = chapters.map(c => {
    return `<itemref idref="${c.id}"/>`;
  }).join("\n");

  const contents = `<?xml version="1.0"?>
<package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId">

  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${bookInfo.title}</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId" opf:scheme="UUID">urn:uuid:${bookInfo.id}</dc:identifier>
    <dc:creator opf:file-as="${BOOK_AUTHOR}" opf:role="aut">${BOOK_AUTHOR}</dc:creator>
    <dc:publisher>${BOOK_PUBLISHER}</dc:publisher>
    <dc:description>${bookInfo.description}</dc:description>
    <meta name="cover" content="cover-image"/>
  </metadata>

  <manifest>
<item id="ncx" href="${NCX_FILENAME}" media-type="application/x-dtbncx+xml"/>
<item id="cover" href="${coverFiles.xhtml}" media-type="application/xhtml+xml"/>
<item id="cover-image" href="${coverFiles.image}" media-type="${coverFiles.imageMimeType}"/>
${manifestChapters}
  </manifest>

  <spine toc="ncx">
<itemref idref="cover" linear="no"/>
${spineChapters}
  </spine>

  <guide>
    <reference type="cover" title="Cover" href="${coverFiles.xhtml}"/>
  </guide>
</package>`;

  return fs.writeFile(path.resolve(contentPath, "content.opf"), contents);
}

function writeNcx(chapters, contentPath, bookInfo) {
  const navPoints = chapters.map((c, i) => {
    return `<navPoint class="chapter" id="${c.id}" playOrder="${i + 1}">
  <navLabel><text>${c.title}</text></navLabel>
  <content src="${c.href}"/>
</navPoint>`;
  }).join("\n");

  const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
 <ncx version="2005-1" xml:lang="en" xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${bookInfo.id}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>

  <docTitle>
    <text>${bookInfo.title}</text>
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

async function getChapters(contentPath, chaptersPath, manifestPath) {
  const hrefPrefix = `${path.relative(contentPath, chaptersPath)}/`;

  const manifestContents = await fs.readFile(manifestPath, { encoding: "utf-8" });
  const manifestChapters = JSON.parse(manifestContents);

  const filenames = await fs.readdir(chaptersPath);

  return filenames
    .filter(f => path.extname(f) === ".xhtml")
    .sort()
    .map((f, i) => {
      return {
        id: path.basename(f),
        title: manifestChapters[i].title,
        href: `${hrefPrefix}${f}`
      };
    });
}

async function getCoverFiles(coverPath) {
  const filenames = await fs.readdir(coverPath);

  const images = filenames.filter(f => [".png", ".jpg"].includes(path.extname(f)));
  if (images.length !== 1) {
    throw new Error(`Expected one cover image in ${coverPath}; found ${images.length}`);
  }
  const imageMimeType = path.extname(images[0]) === ".png" ? "image/png" : "image/jpeg";

  return { xhtml: "cover.xhtml", imageMimeType, image: images[0] };
}
