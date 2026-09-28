import {parseBoot} from "./bridge/protocol.js";
import {contractSha256} from "./identity.js";
import {ContentSessionService} from "./service.js";
import {startContentPreload} from "./preload-worker.js";
import {record} from "./source.js";
const workerScope = globalThis as unknown as {onmessage: ((event: MessageEvent<unknown>) => void) | null; close: () => void; postMessage(value: unknown): void};
workerScope.onmessage = ({data}) => {
  workerScope.onmessage = null;
  try {
    if (record(data) && data.type === "PRELOAD") {startContentPreload(data, workerScope);}
    else {new ContentSessionService(parseBoot(data, contractSha256));}
  } catch {workerScope.postMessage({type: "ERROR", code: "CONTENT_IO_SOURCE_INVALID"}); workerScope.close();}
};
