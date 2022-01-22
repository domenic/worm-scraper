#!/usr/bin/env node
"use strict";
/* eslint-disable no-process-exit */
const path = require("path");
const fs = require("fs").promises;
const yargs = require("yargs");

const packageJson = require("../package.json");
const books = require("./books.js");
const download = require("./download.js");
const convert = require("./convert.js");
const scaffold = require("./scaffold.js");
const zip = require("./zip.js");

const OUTPUT_DEFAULT = "(Book name).epub";

const { argv } = yargs
  .usage(`${packageJson.description}\n\n${packageJson.name} [<command1> [<command2> [<command3> ...]]]\n\n` +
         "Each command will fail if the previously-listed one has not yet been run (with matching options).\n\n" +
         "Running with no commands is equivalent to running download convert scaffold zip.")
  .command("download", "download all chapters into the cache")
  .command("convert", "convert the raw HTML into cleaned-up ebook chapters")
  .command("scaffold", "assemble the table of contents, etc.")
  .command("zip", "zip up the created files into a .epub output")
  .option("b", {
    alias: "book",
    default: Object.keys(books)[0],
    describe: "the book to operate on",
    choices: Object.keys(books),
    requiresArg: true,
    global: true
  })
  .option("c", {
    alias: "cache",
    default: "cache",
    describe: "cache directory for downloaded raw chapters",
    requiresArg: true,
    global: true
  })
  .option("s", {
    alias: "staging",
    default: "staging",
    describe: "directory in which to assemble the EPUB files",
    requiresArg: true,
    global: true
  })
  .option("o", {
    alias: "out",
    default: OUTPUT_DEFAULT,
    describe: "output file destination",
    requiresArg: true,
    global: true
  })
  .option("j", {
    alias: "jobs",
    default: undefined,
    defaultDescription: "# of CPU cores - 1",
    describe: "number of concurrent read/write conversion jobs",
    requiresArg: true,
    global: true
  })
  .recommendCommands()
  .help()
  .version();

const outputFilename = argv.out === OUTPUT_DEFAULT ? `${books[argv.book].title}.epub` : argv.out;

const cachePath = path.resolve(argv.cache, argv.book);
const manifestPath = path.resolve(cachePath, "manifest.json");

const scaffoldingPath = path.resolve(__dirname, "../scaffolding");
const coverPath = path.resolve(__dirname, "../covers", argv.book);
const stagingPath = path.resolve(argv.staging, argv.book);
const contentPath = path.resolve(stagingPath, "OEBPS");
const chaptersPath = path.resolve(contentPath, "chapters");

const commands = [];

if (argv._.length === 0) {
  argv._ = ["download", "convert", "scaffold", "zip"];
}

if (argv._.includes("download")) {
  const { startURL } = books[argv.book];
  commands.push(() => download(startURL, cachePath, manifestPath));
}

if (argv._.includes("convert")) {
  commands.push(() => {
    return fs.rm(chaptersPath, { force: true, recursive: true, maxRetries: 3 })
      .then(() => fs.mkdir(chaptersPath, { recursive: true }))
      .then(() => convert(cachePath, manifestPath, chaptersPath, argv.book, argv.jobs));
  });
}

if (argv._.includes("scaffold")) {
  const bookInfo = books[argv.book];
  commands.push(() => scaffold(
    scaffoldingPath,
    coverPath,
    stagingPath,
    contentPath,
    chaptersPath,
    manifestPath,
    bookInfo
  ));
}

if (argv._.includes("zip")) {
  commands.push(() => zip(stagingPath, contentPath, path.resolve(outputFilename)));
}

(async () => {
  try {
    for (const command of commands) {
      await command();
    }
  } catch (e) {
    console.error(e.stack);
    process.exit(1);
  }
})();
