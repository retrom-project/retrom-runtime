import {
  defineAdapter,
  defineProvider,
  defineTarget,
  type AdapterDeclaration,
  type FrameMode,
  type ProviderCapabilities,
  type ResourceKind,
  type TargetOptionsSchema,
} from "../../provider/declarations.js";

const noOptionsSchema = {
  additionalProperties: false, properties: {}, required: [], type: "object",
} as const satisfies TargetOptionsSchema;
const onsOptionsSchema = {
  additionalProperties: false,
  properties: {scriptEncoding: {enum: ["gbk", "sjis", "utf8"], type: "string"}},
  required: ["scriptEncoding"],
  type: "object",
} as const satisfies TargetOptionsSchema;
const kirikiriOptionsSchema = {
  additionalProperties: false,
  properties: {startupXp3Path: {format: "safe-path", maxLength: 240, type: ["string", "null"]}},
  required: ["startupXp3Path"],
  type: "object",
} as const satisfies TargetOptionsSchema;

const rpgCapabilities = capabilities(true, true, false);
const nativeCapabilities = capabilities(true, true, true);
const standardCapabilities = capabilities(true, false, false);
const isolatedCapabilities = capabilities(true, true, true);
const wasm4Capabilities = capabilities(true, true, false);

const adapters = [
  adapter("butterscotch-web", "BUTTERSCOTCH_WEB", "butterscotch-checkpoint-v2",
    "butterscotch-checkpoint-v2", standardCapabilities),
  adapter("easyrpg-web", "EASYRPG_WEB", "easyrpg-save", "easyrpg-save-bundle-v1", rpgCapabilities),
  defineAdapter({
    id: "j2me-minijvm-web", kind: "J2ME_MINIJVM_WEB", abi: "j2me-rms",
    capabilities: capabilities(true, true, true),
    checkpoint: {writeFormat: "j2me-rms-bundle-v1", readFormats: ["j2me-rms-bundle-v1"], semantics: "GAME_SAVE"},
  }),
  adapter("kirikiri2-web", "KIRIKIRI2_WEB", "kirikiri-kag-bookmark",
    "kirikiri-save-bundle-v1", standardCapabilities),
  adapter("mkxp-libretro-web", "MKXP_LIBRETRO_WEB", "mkxp-state-compact",
    "mkxp-state-compact-v1", rpgCapabilities),
  adapter("native-web", "NATIVE_WEB", "native-save", "native-save-bundle-v1", nativeCapabilities),
  adapter("ons-yuri-web", "ONS_YURI_WEB", "ons-save", "ons-save-bundle-v1", standardCapabilities),
  adapter("tyranoscript-web", "TYRANOSCRIPT_WEB", "tyranoscript-snapshot-v1",
    "tyranoscript-snapshot-v1", isolatedCapabilities),
  adapter("wasm4-web", "WASM4_WEB", "wasm4-state-v1", "wasm4-state-v1", wasm4Capabilities),
] as const;

const targets = [
  target(
    "butterscotch-gamemaker", "GameMaker (Butterscotch)", "butterscotch-web", noOptionsSchema,
    true, "SAME_ORIGIN_BLANK", "FILE_TREE", 16 * 1024 * 1024,
    ["assets/butterscotch/butterscotch.mjs", "assets/butterscotch/butterscotch.wasm",
      "assets/butterscotch/worker.mjs"],
  ),
  target(
    "j2me", "Java ME", "j2me-minijvm-web", noOptionsSchema,
    true, "SAME_ORIGIN_BLANK", "ROM_BLOB", 2 * 1024 * 1024,
    ["assets/j2me/j2me-runtime.js", "assets/j2me/runtime-loader.js", "assets/j2me/runtime.js",
      "assets/j2me/runtime.wasm", "assets/j2me/runtime.data", "assets/j2me/runtime.worker.js",
      "assets/j2me/audio-transcoder.wasm", "assets/j2me/audio-transcoder.worker.js"],
  ),
  target(
    "kirikiri2-kag", "KiriKiri2 KAG", "kirikiri2-web", kirikiriOptionsSchema,
    true, "SAME_ORIGIN_BLANK", "FILE_TREE", 64 * 1024 * 1024,
    ["assets/kirikiri/assets.zip", "assets/kirikiri/index.js", "assets/kirikiri/index.wasm",
      "assets/kirikiri/vlfs.js"],
  ),
  target(
    "onscripter-yuri", "ONScripter Yuri", "ons-yuri-web", onsOptionsSchema,
    false, "SAME_ORIGIN_BLANK", "FILE_TREE", 64 * 1024 * 1024,
    ["assets/ons/onsyuri.js", "assets/ons/onsyuri.wasm"],
  ),
  easyRpgTarget("rpgmaker-2000", "RPG Maker 2000", "rpg2k"),
  easyRpgTarget("rpgmaker-2003", "RPG Maker 2003", "rpg2k3"),
  nativeRpgTarget("rpgmaker-mv", "RPG Maker MV", "RPGMV"),
  nativeRpgTarget("rpgmaker-mz", "RPG Maker MZ", "RPGMZ"),
  mkxpTarget("rpgmaker-vx", "RPG Maker VX", 2),
  mkxpTarget("rpgmaker-vx-ace", "RPG Maker VX Ace", 3),
  mkxpTarget("rpgmaker-xp", "RPG Maker XP", 1),
  target(
    "tyranoscript", "TyranoScript", "tyranoscript-web", noOptionsSchema, false,
    "ISOLATED_ORIGIN_RESOURCE", "ISOLATED_WEB", 32 * 1024 * 1024,
    ["assets/tyranoscript/bridge.js"],
  ),
  target(
    "wasm4", "WASM-4", "wasm4-web", noOptionsSchema, false, "SAME_ORIGIN_BLANK", "WASM4_CART",
    132144, ["assets/wasm4/wasm4-retrom.mjs"],
  ),
] as const;

export const retromRuntimeProviderDefinition = defineProvider({
  adapters,
  providerApiVersion: 1,
  providerId: "retrom-runtime",
  providerVersion: "0.17.0-dev.10",
  targets,
});

function capabilities(
  checkpoint: boolean,
  frameCounter: boolean,
  volume: boolean,
): ProviderCapabilities {
  return {
    checkpoint,
    frameCounter,
    pause: true,
    screenshot: true,
    standardGamepad: true,
    volume,
  };
}

function adapter(
  id: string,
  kind: string,
  abi: string,
  checkpointFormat: string,
  adapterCapabilities: ProviderCapabilities,
): AdapterDeclaration {
  return defineAdapter({
    abi,
    capabilities: adapterCapabilities,
    checkpoint: {readFormats: [checkpointFormat], writeFormat: checkpointFormat},
    id,
    kind,
  });
}

function target(
  id: string,
  displayName: string,
  adapterId: string,
  targetOptionsSchema: TargetOptionsSchema,
  requiresThreads: boolean,
  frameMode: FrameMode,
  resourceKind: ResourceKind,
  checkpointMaxBytes: number,
  assetPaths: readonly string[],
  implementation: Readonly<Record<string, unknown>> = {},
) {
  return defineTarget({
    adapterId,
    assetPaths,
    checkpointMaxBytes,
    discSwitch: false,
    displayName,
    frameMode,
    id,
    implementation,
    inputFilter: true,
    inputs: [{cardinality: "ONE", kind: resourceKind, optional: false, role: "game"}],
    nativeSettings: false,
    netplayPort: false,
    targetOptionsSchema,
    requiresThreads,
    videoModes: ["original", "pixel", "smooth"],
  });
}

function mkxpTarget(id: string, displayName: string, rgssVersion: 1 | 2 | 3) {
  const result = target(
    id, displayName, "mkxp-libretro-web", noOptionsSchema, true, "SAME_ORIGIN_BLANK", "SEEKABLE_BLOB",
    256 * 1024 * 1024,
    ["assets/mkxp/mkxp-z_libretro.js", "assets/mkxp/mkxp-z_libretro.wasm"], {rgssVersion},
  );
  return defineTarget({
    ...result,
    inputs: [
      result.inputs[0],
      {cardinality: "MANY", kind: "SEEKABLE_BLOB", optional: true, role: "rtp"},
    ],
  });
}

function easyRpgTarget(
  id: string,
  displayName: string,
  engineMode: "rpg2k" | "rpg2k3",
) {
  const result = target(
    id, displayName, "easyrpg-web", noOptionsSchema, false, "SAME_ORIGIN_BLANK", "FILE_TREE",
    64 * 1024 * 1024,
    ["assets/easyrpg/easyrpg-player.js", "assets/easyrpg/easyrpg-player.wasm"], {engineMode},
  );
  return defineTarget({
    ...result,
    inputs: [
      result.inputs[0],
      {cardinality: "ONE", kind: "FILE_TREE", optional: true, role: "rtp"},
    ],
  });
}

function nativeRpgTarget(id: string, displayName: string, bridgeProfile: "RPGMV" | "RPGMZ") {
  return target(
    id, displayName, "native-web", noOptionsSchema, false, "ISOLATED_ORIGIN_RESOURCE",
    "NATIVE_WEB", 64 * 1024 * 1024, ["assets/native/bridge.js"], {bridgeProfile},
  );
}
