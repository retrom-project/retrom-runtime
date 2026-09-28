import {eagerPolicy} from "../../provider/content-policies.js";
import {defineAdapter, defineTarget} from "../../provider/declarations.js";
import {checkpointFormat, checkpointLimit} from "../../mame/state.js";
export const mameAdapter = defineAdapter({id: "mame-dylink", kind: "MAME_DYLINK", abi: "retrom-mame-dylink-v1",
  capabilities: {checkpoint: true, pause: true, screenshot: true, standardGamepad: true, frameCounter: true, volume: true},
  checkpoint: {writeFormat: checkpointFormat, readFormats: [checkpointFormat]},
});
export const mameAppleTarget = defineTarget({id: "mame-apple2", displayName: "Apple II+ (MAME)", adapterId: mameAdapter.id,
  checkpointMaxBytes: checkpointLimit, frameMode: "SAME_ORIGIN_BLANK", requiresThreads: false,
  contentIO: {game: eagerPolicy(143360), external: eagerPolicy(2048)},
  inputs: [{role: "game", kind: "ROM_BLOB", cardinality: "ONE", optional: false},
    {role: "external", kind: "EXTERNAL_FILE_SET", cardinality: "ONE", optional: false}],
  targetOptionsSchema: {type: "object", additionalProperties: false, properties: {}, required: []},
  implementation: {}, inputFilter: true, discSwitch: false, nativeSettings: false,
  videoModes: ["original", "pixel", "smooth"],
  assetPaths: ["mame-build.json", "mame-common.mjs", "mame-common.mjs.br", "mame-common.wasm", "mame-common.wasm.br",
    "mame-apple.wasm", "mame-apple.wasm.br"].map(file => `assets/mame/${file}`),
});
