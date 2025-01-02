"use strict";
const cliProgress = require("cli-progress");

// This file contains wrappers for cli-progress to fit the style we want to consistently use.

exports.start = total => {
  const progress = new cliProgress.SingleBar({
    stopOnComplete: true,
    clearOnComplete: true,
    format: " {bar} {percentage}% | {time} | {value}/{total}"
  }, cliProgress.Presets.shades_classic);

  const start = performance.now();
  progress.start(total, 0, { time: "     " });

  progress.startTime = start;

  return progress;
};

exports.increment = progress => {
  const seconds = String(Math.round((performance.now() - progress.startTime) / 1000)).padStart(3);
  progress.increment({ time: `${seconds} s` });
};

exports.getTotalSeconds = progress => {
  return (Math.round((performance.now() - progress.startTime) / 100) / 10).toFixed(1);
};
