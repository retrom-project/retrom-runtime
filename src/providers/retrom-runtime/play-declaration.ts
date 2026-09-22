import {rangePolicy} from "../../provider/content-policies.js";
import {contentLimits as limits} from "../../content-io/limits.js";
import {defineAdapter, defineTarget} from "../../provider/declarations.js";

export const playAdapter = defineAdapter({id: "play-web", kind: "PLAY_WEB", abi: "play-host-v2",
  capabilities: {checkpoint: true, pause: true, screenshot: true, standardGamepad: true, frameCounter: true, volume: false},
  checkpoint: {writeFormat: "play-state-v1", readFormats: ["play-state-v1"]},
});

export const playTarget = defineTarget({id: "play-ps2", displayName: "Play! (PlayStation 2)", adapterId: playAdapter.id,
  checkpointMaxBytes: 268435456, frameMode: "SAME_ORIGIN_BLANK", requiresThreads: true,
  contentIO: {game: rangePolicy("POLLING", limits.indexedFile)},
  inputs: [{role: "game", kind: "SEEKABLE_BLOB", cardinality: "ONE", optional: false}],
  targetOptionsSchema: {type: "object", additionalProperties: false, properties: {}, required: []},
  implementation: {}, inputFilter: true, discSwitch: false, nativeSettings: false,
  videoModes: ["original", "pixel", "smooth"],
  assetPaths: ["Play.js", "Play.wasm", "checkpoint.mjs", "input.mjs", "play-retrom.mjs", "disc-device.mjs"]
    .map(file => `assets/play/${file}`),
});
