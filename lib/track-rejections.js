"use strict";

let currentId = 0;
const tracker = new WeakMap();

process.on("unhandledRejection", function (reason, promise) {
  tracker.set(promise, ++currentId);
  console.error(`Unhandled rejection (${currentId}): `);
  console.error(reason.stack);
});

process.on("rejectionHandled", function (promise) {
  const id = tracker.get(promise);
  tracker.delete(promise);

  console.error(`Rejection handled (${id})`);
});
