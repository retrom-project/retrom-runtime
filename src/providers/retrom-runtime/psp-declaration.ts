import {rangePolicy} from "../../provider/content-policies.js";
import {contentLimits as limits} from "../../content-io/limits.js";
import {defineAdapter, defineTarget} from "../../provider/declarations.js";

export const pspAdapter = defineAdapter({id: "ppsspp-web", kind: "PPSSPP_WEB", abi: "ppsspp-host-v4",
  capabilities: {checkpoint: true, pause: true, screenshot: true, standardGamepad: true, frameCounter: true, volume: true},
  checkpoint: {semantics: "INSTANT", writeFormat: "ppsspp-state-v1", readFormats: ["ppsspp-state-v1"]},
});

export const pspTarget = defineTarget({
  hostKeyboardShortcuts: ["PAUSE", "MENU"],
  id: "ppsspp", displayName: "PPSSPP (PSP)", adapterId: pspAdapter.id,
  checkpointMaxBytes: 268435456, frameMode: "SAME_ORIGIN_BLANK", requiresThreads: true,
  contentIO: {game: rangePolicy("SYNC_WORKER", limits.signedDisc, {contentLengthPolicy: "REQUIRED_EXACT"})},
  inputs: [{role: "game", kind: "SEEKABLE_BLOB", cardinality: "ONE", optional: false}],
  targetOptionsSchema: {type: "object", additionalProperties: false, properties: {}, required: []},
  implementation: {}, inputFilter: true, nativeSettings: false,
  videoModes: ["original", "pixel", "smooth"],
  assetPaths: ["ppsspp.js", "ppsspp.wasm", "ppsspp.data", "ppsspp.worker.mjs", "ppsspp-host.mjs"]
    .map(file => `assets/ppsspp/${file}`),
});
