import {Worker} from "node:worker_threads";
import {link, rm} from "node:fs/promises";
import {randomUUID} from "node:crypto";

let busy = false;
const waiting = [];
async function acquire(signal) {
  signal.throwIfAborted();
  if (!busy) {busy = true; return;}
  await new Promise((resolve, reject) => {
    const entry = {resolve: () => {signal.removeEventListener("abort", abort); resolve();}};
    const abort = () => {waiting.splice(waiting.indexOf(entry), 1); reject(signal.reason);};
    signal.addEventListener("abort", abort, {once: true}); waiting.push(entry);
  });
}
function release() {const next = waiting.shift(); if (next) {next.resolve();} else {busy = false;}}

export async function archiveTask(input, signal) {
  await acquire(signal);
  const temporary = `${input.outputPath}.${randomUUID()}.tmp`;
  let worker;
  try {
    signal.throwIfAborted();
    worker = new Worker(new URL("./runtime-archive-worker.mjs", import.meta.url), {workerData: {...input, outputPath: temporary}});
    const result = await new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, {once: true});
      worker.once("message", message => {signal.removeEventListener("abort", abort);
        if (message.error) {reject(new Error(message.error));} else {resolve(message.result);}});
      worker.once("error", error => {signal.removeEventListener("abort", abort); reject(error);});
      worker.once("exit", () => {signal.removeEventListener("abort", abort); reject(new Error("RUNTIME_ARCHIVE_WORKER_FAILED"));});
    });
    signal.throwIfAborted();
    // Publish only a completed archive, without overwriting an existing destination.
    await link(temporary, input.outputPath);
    return {...result, path: input.outputPath};
  } finally {
    if (worker) {await worker.terminate();}
    try {await rm(temporary, {force: true});} finally {release();}
  }
}
