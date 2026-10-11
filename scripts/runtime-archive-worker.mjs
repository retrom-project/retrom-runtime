import {parentPort, workerData} from "node:worker_threads";
import {parentArchive} from "./runtime-archive-input.mjs";

// This execution worker imports no DAT catalog or runtime declaration bundle.
try {parentPort.postMessage({result: await parentArchive(workerData)});}
catch (error) {parentPort.postMessage({error: error instanceof Error ? error.message : "RUNTIME_REQUEST_FAILED"});}
finally {parentPort.close();}
