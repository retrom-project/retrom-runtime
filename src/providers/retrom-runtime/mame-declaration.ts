import {eagerPolicy, rangePolicy} from "../../provider/content-policies.js";
import {contentLimits} from "../../content-io/limits.js";
import {defineAdapter, defineTarget} from "../../provider/declarations.js";
import {checkpointFormat, checkpointLimit} from "../../mame/state.js";
import arcadeFamilies from "../../mame/arcade-families.json" with {type: "json"};
import arcadeProvenance from "../../runtime/arcade-provenance.json" with {type: "json"};
export const mameAdapter = defineAdapter({id: "mame-dylink", kind: "MAME_DYLINK", abi: "retrom-mame-dylink-v1",
  capabilities: {checkpoint: true, pause: true, screenshot: true, standardGamepad: true, frameCounter: true, volume: true},
  checkpoint: {semantics: "INSTANT", writeFormat: checkpointFormat, readFormats: [checkpointFormat]},
});
export const mameAppleTarget = defineTarget({
  hostKeyboardShortcuts: ["PAUSE", "MENU"],
  id: "mame-apple2", displayName: "Apple II+ (MAME)", adapterId: mameAdapter.id,
  checkpointMaxBytes: checkpointLimit, frameMode: "SAME_ORIGIN_BLANK", requiresThreads: false,
  contentIO: {game: eagerPolicy(143360), external: eagerPolicy(2048)},
  inputs: [{role: "game", kind: "ROM_BLOB", cardinality: "ONE", optional: false},
    {role: "external", kind: "EXTERNAL_FILE_SET", cardinality: "ONE", optional: false}],
  targetOptionsSchema: {type: "object", additionalProperties: false, properties: {}, required: []},
  implementation: {}, inputFilter: true, nativeSettings: false,
  videoModes: ["original", "pixel", "smooth"],
  ...mameAssets(["apple"]),
});

export const mameAtomTarget = defineTarget({...mameAppleTarget, id: "mame-atom", displayName: "Acorn Atom (MAME)",
  contentIO: {game: eagerPolicy(65557), external: eagerPolicy(8192)},
  ...mameAssets(["acorn"]),
});
export const mameApple2eTarget = defineTarget({...mameAppleTarget, id: "mame-apple2e", displayName: "Apple IIe (MAME)",
  contentIO: {game: eagerPolicy(143360), external: eagerPolicy(8192)},
});
export const mameSG1000Target = defineTarget({...mameAppleTarget, id: "mame-sg1000", displayName: "SG-1000 (MAME)",
  contentIO: {game: eagerPolicy(2 * 1024 * 1024)},
  inputs: [{role: "game", kind: "ROM_BLOB", cardinality: "ONE", optional: false}],
  ...mameAssets(["sg1000"]),
});
export const mameColecoTarget = defineTarget({...mameAppleTarget, id: "mame-coleco", displayName: "ColecoVision (MAME)",
  contentIO: {game: eagerPolicy(2 * 1024 * 1024), external: eagerPolicy(8192)},
  ...mameAssets(["coleco"]),
});
export const mamePV1000Target = defineTarget({...mameAppleTarget, id: "mame-pv1000", displayName: "Casio PV-1000 (MAME)",
  contentIO: {game: eagerPolicy(32768)},
  inputs: [{role: "game", kind: "ROM_BLOB", cardinality: "ONE", optional: false}],
  ...mameAssets(["vintage"]),
});
export const mameArcadeTarget = defineTarget({...mameAppleTarget, id: "mame-arcade", displayName: "MAME Current Arcade",
  requiresThreads: true,
  romSetSelection: {datSHA256: arcadeProvenance.find(source => source.coreId === "mame_arcade")!.sha256, driver: "MACHINE_OPTION"},
  contentIO: {game: eagerPolicy(128 * 1024 * 1024),
    external: eagerPolicy(128 * 1024 * 1024),
    parent: eagerPolicy(128 * 1024 * 1024), media: rangePolicy("SYNC_WORKER", contentLimits.indexedFile)},
  inputs: [{role: "game", kind: "ROM_BLOB", cardinality: "ONE", optional: false},
    {role: "parent", kind: "EXTERNAL_FILE_SET", cardinality: "ONE", optional: true},
    {role: "media", kind: "EXTERNAL_FILE_SET", cardinality: "ONE", optional: true},
    {role: "external", kind: "EXTERNAL_FILE_SET", cardinality: "ONE", optional: true}],
  targetOptionsSchema: {type: "object", additionalProperties: false,
    properties: {machine: {type: "string", minLength: 1, maxLength: 32}}, required: ["machine"]},
  ...mameAssets(arcadeFamilies),
});

function mameAssets(families: readonly string[]) {
  const coreAssetPaths = ["mame-common.mjs", "mame-common.wasm", ...families.map(family => `mame-${family}.wasm`)]
    .map(file => `assets/mame/${file}`);
  return {coreAssetPaths, assetPaths: ["assets/mame/mame-build.json", ...coreAssetPaths]};
}
