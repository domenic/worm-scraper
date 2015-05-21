"use strict";
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

module.exports = function (bookPath, contentPath, outPath) {
  return new Promise(function (resolve, reject) {
    console.log(`Zipping up ${bookPath} into an EPUB`);

    const archive = archiver("zip");
    const destStream = fs.createWriteStream(outPath);

    destStream.on("close", function () {
      console.log(`EPUB written to ${outPath} (${archive.pointer()} bytes)`);
      resolve();
    });

    archive.on("error", reject);
    destStream.on("error", reject);

    archive.pipe(destStream);

    // Order matters; mimetype must be first for a valid EPUB
    archive.file(path.resolve(bookPath, "mimetype"), { name: "mimetype" });
    archive.directory(contentPath, "OEBPS", { name: "OEBPS" });
    archive.directory(path.resolve(bookPath, "META-INF"), "META-INF", { name: "META-INF" });

    archive.finalize();
  });
};
