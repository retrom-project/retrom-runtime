import {Worker} from "node:worker_threads";
import {mkdir, mkdtemp, rm} from "node:fs/promises";
import {dirname, isAbsolute, join, resolve} from "node:path";
import {normalizers} from "./registry.mjs";

/** Terminate only this request's CPU work, then reclaim only its owned staging directory. */
export async function normalizeContent(input, signal) {
  signal?.throwIfAborted();
  if (!normalizers.some(plugin => plugin.platforms.includes(input.platformId))) {return {files: input.files};}
  if (typeof input.outputRoot !== "string" || !isAbsolute(input.outputRoot) || resolve(input.outputRoot) !== input.outputRoot) {
    throw new Error("RUNTIME_CONTENT_LOCATOR_REQUIRED");
  }
  await mkdir(input.outputRoot, {mode: 0o700});
  let worker, workspaceRoot, retain = false;
  try {
    workspaceRoot = await mkdtemp(join(dirname(input.outputRoot), ".normalization-"));
    worker = new Worker(new URL("./worker.mjs", import.meta.url), {workerData: {input, workspaceRoot},
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
      worker.once("exit", code => {signal?.removeEventListener("abort", abort); if (code || !received) {reject(new Error("RUNTIME_NORMALIZATION_FAILED"));}});
      if (signal?.aborted) {abort();}
    });
    signal?.throwIfAborted(); retain = Boolean(result.normalization); return result;
  } finally {
    await worker?.terminate();
    if (workspaceRoot) {await rm(workspaceRoot, {recursive: true, force: true});}
    if (!retain || signal?.aborted) {await rm(input.outputRoot, {recursive: true, force: true});}
    signal?.throwIfAborted();
  }
}
