"use strict";
const path = require("path");
const mkdirp = require("mkdirp-then");
const rimraf = require("rimraf-then");
const yargs = require("yargs");

const packageJson = require("../package.json");
const download = require("./download.js");
const convert = require("./convert.js");
const scaffold = require("./scaffold.js");
const zip = require("./zip.js");

require("./track-rejections.js");

const argv = yargs
  .usage(`${packageJson.description}\n\n${packageJson.name} [<command1> [<command2> [<command3> ...]]]\n\n` +
         "Each command will fail if the previously-listed one has not yet been run (with matching options).")
  .command("download", "download all chapters by crawling parahumans.wordpress.com")
  .command("convert", "convert the raw chapter HTML files into cleaned-up ebook chapters")
  .command("scaffold", "assemble the table of contents, etc. to complete the EPUB")
  .command("zip", "zip up the EPUB files into a .epub output")
  .option("s", {
    alias: "start-url",
    default: "https://parahumans.wordpress.com/2011/06/11/1-1/",
    describe: "the URL from which to start crawling, for the download command",
    requiresArg: true,
    global: true
  })
  .option("c", {
    alias: "cache-directory",
    default: "cache",
    describe: "cache directory, for the download and convert commands",
    requiresArg: true,
    global: true
  })
  .option("b", {
    alias: "book-directory",
    default: "book",
    describe: "directory in which to assemble the EPUB files before zipping, for the convert, scaffold, and zip " +
              "commands",
    requiresArg: true,
    global: true
  })
  .option("o", {
    alias: "out",
    default: "Worm.epub",
    describe: "output file destination, for the zip command",
    requiresArg: true,
    global: true
  })
  .demandCommand(1) // TODO remove and allow all
  .recommendCommands()
  .help()
  .version()
  .argv;

const cachePath = path.resolve(argv.cacheDirectory);
const manifestPath = path.resolve(cachePath, "manifest.json");

const scaffoldingPath = path.resolve(__dirname, "../scaffolding");
const bookPath = path.resolve(argv.bookDirectory);
const contentPath = path.resolve(bookPath, "OEBPS");
const chaptersPath = path.resolve(contentPath, "chapters");

const commands = [];

if (argv._.indexOf("download") !== -1) {
  commands.push(function () {
    return download(argv.startUrl, cachePath, manifestPath);
  });
}

if (argv._.indexOf("convert") !== -1) {
  commands.push(function () {
    return rimraf(chaptersPath).then(function () {
      return mkdirp(chaptersPath);
    })
    .then(function () {
      return convert(cachePath, manifestPath, chaptersPath);
    });
  });
}

if (argv._.indexOf("scaffold") !== -1) {
  commands.push(function () {
    return scaffold(scaffoldingPath, bookPath, contentPath, chaptersPath, manifestPath);
  });
}

if (argv._.indexOf("zip") !== -1) {
  commands.push(function () {
    return zip(bookPath, contentPath, path.resolve(argv.out));
  });
}

commands.reduce(function (previous, command) {
  return previous.then(command);
}, Promise.resolve())
.then(function () {
  console.log("All done!");
})
.catch(function (e) {
  console.error(e.stack);
});
