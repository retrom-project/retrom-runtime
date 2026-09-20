// Protocol fixture only: expose snapshots on the parent port, never on the production management protocol.
import {parseBoot} from "../../src/content-io/bridge/protocol.js";
import {contractSha256} from "../../src/content-io/identity.js";
import {ContentSessionService} from "../../src/content-io/service.js";
let service: ContentSessionService | undefined;
globalThis.onmessage = ({data}) => {
  if (data.type === "BOOT" && !service) {service = new ContentSessionService(parseBoot(data, contractSha256));}
  else if (data.type === "TEST_STATS" && service) {postMessage({id: data.id, stats: service.stats});}
};
