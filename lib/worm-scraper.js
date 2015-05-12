"use strict";
const path = require("path");
const mkdirp = require("mkdirp-then");
const rimraf = require("rimraf-then");

const download = require("./download.js");
const convert = require("./convert.js");
const extras = require("./extras.js");

require("./track-rejections.js");

const START_CHAPTER_URL = "https://parahumans.wordpress.com/2011/06/11/1-1/";

const cachePath = path.resolve("cache");
const outPath = path.resolve("out");
const contentPath = path.resolve(outPath, "OEBPS");
const chaptersPath = path.resolve(contentPath, "chapters");
const manifestPath = path.resolve(cachePath, "manifest.json");

Promise.resolve()
  // .then(function () {
  //   return download(START_CHAPTER_URL, cachePath, manifestPath);
  // })
  // .then(function () {
  //   return rimraf(chaptersPath);
  // })
  // .then(function () {
  //   return mkdirp(chaptersPath);
  // })
  // .then(function () {
  //   return convert(cachePath, manifestPath, chaptersPath);
  // })
  .then(function () {
    return extras(contentPath, chaptersPath, manifestPath);
  })
  .then(function () {
    console.log("All done!");
  });
