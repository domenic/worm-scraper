#!/usr/bin/env node
"use strict";
const path = require("path");
const fs = require("fs").promises;
const yargs = require("yargs");

const packageJson = require("../package.json");
const download = require("./download.js");
const convert = require("./convert.js");
const scaffold = require("./scaffold.js");
const zip = require("./zip.js");

const books = ["worm", "glow-worm", "ward"];

const { argv } = yargs
  .usage(`${packageJson.description}\n\n${packageJson.name}[ <command1> [<command2> [<command3> ...]]]\n\n` +
         "Each command will fail if the previously-listed one has not yet been run (with matching options).\n\n" +
         "Running with no commands is equivalent to running download convert scaffold zip.")
  .command("download", "Download all chapters into the cache")
  .command("convert", "Convert the raw HTML into cleaned-up ebook chapters")
  .command("scaffold", "Assemble the table of contents, etc.")
  .command("zip", "Zip up the created files into a .epub output")
  .option("b", {
    alias: "book",
    choices: books,
    default: books[0],
    describe: "The book to operate on",
    requiresArg: true
  })
  .option("t", {
    alias: "chapter-titles",
    default: "simplified",
    choices: ["simplified", "character-names", "original"],
    describe: "How to format chapter titles",
    requiresArg: true
  })
  .option("c", {
    alias: "cache",
    default: "cache",
    describe: "Cache directory for downloaded raw chapters",
    requiresArg: true
  })
  .option("s", {
    alias: "staging",
    default: "staging",
    describe: "Directory in which to assemble the EPUB files",
    requiresArg: true
  })
  .option("o", {
    alias: "out",
    default: undefined,
    defaultDescription: "(Book name).epub",
    describe: "Output file destination",
    requiresArg: true
  })
  .option("j", {
    alias: "jobs",
    default: undefined,
    defaultDescription: "# of CPU cores - 1",
    describe: "Number of concurrent read/write conversion jobs",
    requiresArg: true
  })
  .recommendCommands()
  .help()
  .version();

const bookData = require(`../book-data/${argv.book}.js`);
const substitutionsPath = path.resolve(__dirname, `../substitutions/${argv.book}.subs`);
const outputFilename = argv.out === undefined ? `${bookData.title}.epub` : argv.out;

const cachePath = path.resolve(argv.cache, argv.book);
const manifestPath = path.resolve(cachePath, "manifest.json");
const chapterDataPath = path.resolve(cachePath, "chapter-data.json");

const scaffoldingPath = path.resolve(__dirname, "../scaffolding");
const coverImagePath = path.resolve(__dirname, "../covers", `${argv.book}.jpg`);
const stagingPath = path.resolve(argv.staging, argv.book);
const contentPath = path.resolve(stagingPath, "OEBPS");
const chaptersPath = path.resolve(contentPath, "chapters");

const commands = [];

if (argv._.length === 0) {
  argv._ = ["download", "convert", "scaffold", "zip"];
}

if (argv._.includes("download")) {
  commands.push(() => download(cachePath, manifestPath, bookData));
}

if (argv._.includes("convert")) {
  commands.push(async () => {
    await fs.rm(chaptersPath, { force: true, recursive: true, maxRetries: 3 });
    await fs.mkdir(chaptersPath, { recursive: true });
    await convert(
      cachePath,
      manifestPath,
      chapterDataPath,
      chaptersPath,
      bookData,
      substitutionsPath,
      argv.jobs,
      argv["chapter-titles"]
    );
  });
}

if (argv._.includes("scaffold")) {
  commands.push(() => scaffold(
    scaffoldingPath,
    coverImagePath,
    stagingPath,
    contentPath,
    chaptersPath,
    chapterDataPath,
    bookData
  ));
}

if (argv._.includes("zip")) {
  commands.push(() => zip(stagingPath, contentPath, path.resolve(outputFilename)));
}

(async () => {
  try {
    for (const command of commands) {
      await command();
      console.log();
    }
  } catch (e) {
    console.error(e.stack);
    process.exit(1);
  }
})();
