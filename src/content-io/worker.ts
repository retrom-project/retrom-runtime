import {parseBoot} from "./bridge/protocol.js";
import {contractSha256} from "./identity.js";
import {ContentSessionService} from "./service.js";
const workerScope = globalThis as unknown as {onmessage: ((event: MessageEvent<unknown>) => void) | null; close: () => void};
workerScope.onmessage = ({data}) => {
  workerScope.onmessage = null;
  try {new ContentSessionService(parseBoot(data, contractSha256));} catch {workerScope.close();}
};
