import {parentPort, workerData} from "node:worker_threads";
import {normalizers} from "./registry.mjs";
import {runNormalization} from "./pipeline.mjs";

try {parentPort.postMessage({result: await runNormalization(workerData, normalizers)});}
catch (error) {
  parentPort.postMessage({error: /^RUNTIME_[A-Z0-9_]+$/u.test(error?.message ?? "") ? error.message : "RUNTIME_NORMALIZATION_FAILED"});
}
