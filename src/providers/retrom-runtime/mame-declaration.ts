import {eagerPolicy} from "../../provider/content-policies.js";
import {defineAdapter, defineTarget} from "../../provider/declarations.js";
import {checkpointFormat, checkpointLimit} from "../../mame/state.js";
import arcadeFamilies from "../../mame/arcade-families.json" with {type: "json"};
export const mameAdapter = defineAdapter({id: "mame-dylink", kind: "MAME_DYLINK", abi: "retrom-mame-dylink-v1",
  capabilities: {checkpoint: true, pause: true, screenshot: true, standardGamepad: true, frameCounter: true, volume: true},
  checkpoint: {writeFormat: checkpointFormat, readFormats: [checkpointFormat]},
});
export const mameAppleTarget = defineTarget({
  hostKeyboardShortcuts: ["PAUSE", "MENU"],
  id: "mame-apple2", displayName: "Apple II+ (MAME)", adapterId: mameAdapter.id,
  checkpointMaxBytes: checkpointLimit, frameMode: "SAME_ORIGIN_BLANK", requiresThreads: false,
  contentIO: {game: eagerPolicy(143360), external: eagerPolicy(2048)},
  inputs: [{role: "game", kind: "ROM_BLOB", cardinality: "ONE", optional: false},
    {role: "external", kind: "EXTERNAL_FILE_SET", cardinality: "ONE", optional: false}],
  targetOptionsSchema: {type: "object", additionalProperties: false, properties: {}, required: []},
  implementation: {}, inputFilter: true, discSwitch: false, nativeSettings: false,
  videoModes: ["original", "pixel", "smooth"],
  assetPaths: ["mame-build.json", "mame-common.mjs", "mame-common.wasm",
    "mame-apple.wasm"].map(file => `assets/mame/${file}`),
});

export const mameAtomTarget = defineTarget({...mameAppleTarget, id: "mame-atom", displayName: "Acorn Atom (MAME)",
  contentIO: {game: eagerPolicy(65557), external: eagerPolicy(8192)},
  assetPaths: mameAppleTarget.assetPaths.map(path => path.replace("mame-apple.wasm", "mame-acorn.wasm")),
});
export const mameApple2eTarget = defineTarget({...mameAppleTarget, id: "mame-apple2e", displayName: "Apple IIe (MAME)",
  contentIO: {game: eagerPolicy(143360), external: eagerPolicy(8192)},
});
export const mameSG1000Target = defineTarget({...mameAppleTarget, id: "mame-sg1000", displayName: "SG-1000 (MAME)",
  contentIO: {game: eagerPolicy(2 * 1024 * 1024)},
  inputs: [{role: "game", kind: "ROM_BLOB", cardinality: "ONE", optional: false}],
  assetPaths: mameAppleTarget.assetPaths.map(path => path.replace("mame-apple.wasm", "mame-sg1000.wasm")),
});
export const mameColecoTarget = defineTarget({...mameAppleTarget, id: "mame-coleco", displayName: "ColecoVision (MAME)",
  contentIO: {game: eagerPolicy(2 * 1024 * 1024), external: eagerPolicy(8192)},
  assetPaths: mameAppleTarget.assetPaths.map(path => path.replace("mame-apple.wasm", "mame-coleco.wasm")),
});
export const mamePV1000Target = defineTarget({...mameAppleTarget, id: "mame-pv1000", displayName: "Casio PV-1000 (MAME)",
  contentIO: {game: eagerPolicy(32768)},
  inputs: [{role: "game", kind: "ROM_BLOB", cardinality: "ONE", optional: false}],
  assetPaths: mameAppleTarget.assetPaths.map(path => path.replace("mame-apple.wasm", "mame-vintage.wasm")),
});
export const mameArcadeTarget = defineTarget({...mameAppleTarget, id: "mame-arcade", displayName: "MAME Current Arcade",
  contentIO: {game: eagerPolicy(128 * 1024 * 1024),
    external: eagerPolicy(65536),
    parent: {mode: "UPSTREAM_LOADER", boundaryId: "mame-loader"},
    bios: {mode: "UPSTREAM_LOADER", boundaryId: "mame-loader"}},
  inputs: [{role: "game", kind: "ROM_BLOB", cardinality: "ONE", optional: false},
    {role: "parent", kind: "PARENT_ARCHIVE", cardinality: "ONE", optional: true},
    {role: "bios", kind: "BIOS_BUNDLE", cardinality: "ONE", optional: true},
    {role: "external", kind: "EXTERNAL_FILE_SET", cardinality: "ONE", optional: true}],
  targetOptionsSchema: {type: "object", additionalProperties: false,
    properties: {machine: {type: "string", minLength: 1, maxLength: 32}}, required: ["machine"]},
  assetPaths: ["mame-build.json", "mame-common.mjs", "mame-common.wasm",
    ...arcadeFamilies.map(family => `mame-${family}.wasm`)].map(file => `assets/mame/${file}`),
});
