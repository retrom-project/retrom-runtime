import {Worker} from "node:worker_threads";
import {mkdir, rm} from "node:fs/promises";
import {isAbsolute, resolve} from "node:path";

/** Terminate only this request's CPU work, then reclaim only its owned staging directory. */
export async function normalizeKirikiriContent(input, sourceContentHash, signal) {
  signal?.throwIfAborted();
  if (typeof input.outputRoot !== "string" || !isAbsolute(input.outputRoot) || resolve(input.outputRoot) !== input.outputRoot) {
    throw new Error("RUNTIME_CONTENT_LOCATOR_REQUIRED");
  }
  await mkdir(input.outputRoot, {mode: 0o700});
  let worker, retain = false;
  try {
    worker = new Worker(new URL("./worker.mjs", import.meta.url), {workerData: {...input, sourceContentHash},
      resourceLimits: {maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64}});
    const result = await new Promise((complete, reject) => {
      let received = false;
      const abort = () => {reject(signal.reason);};
      signal?.addEventListener("abort", abort, {once: true});
      worker.once("message", message => {
        received = true;
        if (message.error) {reject(new Error(message.error));} else {complete(message.result);}
      });
      worker.once("error", reject);
      worker.once("exit", code => {signal?.removeEventListener("abort", abort); if (code || !received) {reject(new Error("RUNTIME_KIRIKIRI_CONVERSION_FAILED"));}});
      if (signal?.aborted) {abort();}
    });
    signal?.throwIfAborted(); retain = Boolean(result.normalization); return result;
  } finally {
    await worker?.terminate();
    if (!retain || signal?.aborted) {await rm(input.outputRoot, {recursive: true, force: true});}
    signal?.throwIfAborted();
  }
}
