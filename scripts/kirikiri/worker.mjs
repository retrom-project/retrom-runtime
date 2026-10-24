import {parentPort, workerData} from "node:worker_threads";
import {normalizeKirikiri} from "./normalize.mjs";

try {parentPort.postMessage({result: await normalizeKirikiri(workerData)});}
catch (error) {
  parentPort.postMessage({error: error?.message?.startsWith("RUNTIME_") ? error.message : "RUNTIME_KIRIKIRI_CONVERSION_FAILED"});
}
