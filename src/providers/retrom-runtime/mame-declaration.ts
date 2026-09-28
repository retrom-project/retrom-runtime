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

export const mameAtomTarget = defineTarget({...mameAppleTarget, id: "mame-atom", displayName: "Acorn Atom (MAME)",
  contentIO: {game: eagerPolicy(65557), external: eagerPolicy(8192)},
  assetPaths: mameAppleTarget.assetPaths.map(path => path.replace("mame-apple.wasm", "mame-acorn.wasm")),
});
export const mamePV1000Target = defineTarget({...mameAppleTarget, id: "mame-pv1000", displayName: "Casio PV-1000 (MAME)",
  contentIO: {game: eagerPolicy(32768)},
  inputs: [{role: "game", kind: "ROM_BLOB", cardinality: "ONE", optional: false}],
  assetPaths: mameAppleTarget.assetPaths.map(path => path.replace("mame-apple.wasm", "mame-vintage.wasm")),
});
