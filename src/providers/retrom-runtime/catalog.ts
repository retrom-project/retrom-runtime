import {
  defineAdapter,
  defineProvider,
  defineTarget,
  type AdapterDeclaration,
  type FrameMode,
  type OptionsKind,
  type ProviderCapabilities,
  type ResourceKind,
} from "../../provider/declarations.js";

const rpgCapabilities = capabilities(true, true, false, ["rpgmaker.position.v1"]);
const nativeCapabilities = capabilities(true, true, true, ["rpgmaker.position.v1"]);
const standardCapabilities = capabilities(true, false, false, []);
const isolatedCapabilities = capabilities(true, true, true, []);
const wasm4Capabilities = capabilities(true, true, false, []);

const adapters = [
  adapter("butterscotch-web", "BUTTERSCOTCH_WEB", "butterscotch-checkpoint-v2",
    "butterscotch-checkpoint-v2", standardCapabilities),
  adapter("easyrpg-web", "EASYRPG_WEB", "easyrpg-save", "easyrpg-save-bundle-v1", rpgCapabilities),
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
    "butterscotch-gamemaker", "GameMaker (Butterscotch)", "butterscotch-gamemaker-v1",
    "butterscotch-web", "NONE_V1", true, "NONE", "FILE_TREE_V1", 16 * 1024 * 1024,
    ["assets/butterscotch/butterscotch.mjs", "assets/butterscotch/butterscotch.wasm",
      "assets/butterscotch/worker.mjs"],
  ),
  target(
    "kirikiri2-kag", "KiriKiri2 KAG", "kirikiri2-kag-v1", "kirikiri2-web", "KIRIKIRI_PROJECT_V1",
    true, "NONE", "FILE_TREE_V1", 64 * 1024 * 1024,
    ["assets/kirikiri/assets.zip", "assets/kirikiri/index.js", "assets/kirikiri/index.wasm",
      "assets/kirikiri/vlfs.js"],
  ),
  target(
    "onscripter-yuri", "ONScripter Yuri", "onscripter-yuri-v1", "ons-yuri-web", "ONS_PROJECT_V1",
    false, "NONE", "FILE_TREE_V1", 64 * 1024 * 1024,
    ["assets/ons/onsyuri.js", "assets/ons/onsyuri.wasm"],
  ),
  easyRpgTarget("rpgmaker-2000", "RPG Maker 2000", "rpgmaker-2000-v1", "rpg2k"),
  easyRpgTarget("rpgmaker-2003", "RPG Maker 2003", "rpgmaker-2003-v1", "rpg2k3"),
  nativeRpgTarget("rpgmaker-mv", "RPG Maker MV", "rpgmaker-mv-v1", "RPGMV"),
  nativeRpgTarget("rpgmaker-mz", "RPG Maker MZ", "rpgmaker-mz-v1", "RPGMZ"),
  mkxpTarget("rpgmaker-vx", "RPG Maker VX", "rpgmaker-vx-v1", 2),
  mkxpTarget("rpgmaker-vx-ace", "RPG Maker VX Ace", "rpgmaker-vx-ace-v1", 3),
  mkxpTarget("rpgmaker-xp", "RPG Maker XP", "rpgmaker-xp-v1", 1),
  target(
    "tyranoscript", "TyranoScript", "tyranoscript-v1", "tyranoscript-web", "NONE_V1", false,
    "ISOLATED_ORIGIN_RESOURCE", "ISOLATED_WEB_V1", 32 * 1024 * 1024,
    ["assets/tyranoscript/bridge.js"],
  ),
  target(
    "wasm4", "WASM-4", "wasm4-v1", "wasm4-web", "NONE_V1", false, "NONE", "WASM4_CART_V1",
    132144, ["assets/wasm4/wasm4-retrom.mjs"],
  ),
] as const;

export const retromRuntimeProviderDefinition = defineProvider({
  adapters,
  providerApiVersion: 1,
  providerId: "retrom-runtime",
  providerVersion: "0.12.0",
  targets,
});

function capabilities(
  checkpoint: boolean,
  frameCounter: boolean,
  volume: boolean,
  validationProbes: readonly string[],
): ProviderCapabilities {
  return {
    checkpoint,
    frameCounter,
    pause: true,
    screenshot: true,
    standardGamepad: true,
    validationProbes,
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
  gameCompatibilityLine: string,
  adapterId: string,
  optionsKind: OptionsKind,
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
    gameCompatibilityLine,
    id,
    implementation,
    inputFilter: true,
    inputs: [{cardinality: "ONE", kind: resourceKind, optional: false, role: "game"}],
    netplayCompatibilityLine: null,
    nativeSettings: false,
    netplayPort: false,
    optionsKind,
    requiresThreads,
    videoModes: ["original", "pixel", "smooth"],
  });
}

function mkxpTarget(id: string, displayName: string, line: string, rgssVersion: 1 | 2 | 3) {
  const result = target(
    id, displayName, line, "mkxp-libretro-web", "RPGMAKER_V1", true, "NONE", "SEEKABLE_BLOB_V1",
    256 * 1024 * 1024,
    ["assets/mkxp/mkxp-z_libretro.js", "assets/mkxp/mkxp-z_libretro.wasm",
      "assets/mkxp/position_bridge.rb"], {rgssVersion},
  );
  return defineTarget({
    ...result,
    inputs: [
      result.inputs[0],
      {cardinality: "MANY", kind: "SEEKABLE_BLOB_V1", optional: true, role: "rtp"},
    ],
  });
}

function easyRpgTarget(
  id: string,
  displayName: string,
  line: string,
  engineMode: "rpg2k" | "rpg2k3",
) {
  const result = target(
    id, displayName, line, "easyrpg-web", "RPGMAKER_V1", false, "NONE", "FILE_TREE_V1",
    64 * 1024 * 1024,
    ["assets/easyrpg/easyrpg-player.js", "assets/easyrpg/easyrpg-player.wasm"], {engineMode},
  );
  return defineTarget({
    ...result,
    inputs: [
      result.inputs[0],
      {cardinality: "ONE", kind: "FILE_TREE_V1", optional: true, role: "rtp"},
    ],
  });
}

function nativeRpgTarget(id: string, displayName: string, line: string, bridgeProfile: "RPGMV" | "RPGMZ") {
  return target(
    id, displayName, line, "native-web", "RPGMAKER_V1", false, "ISOLATED_ORIGIN_RESOURCE",
    "NATIVE_WEB_V1", 64 * 1024 * 1024, ["assets/native/bridge.js"], {bridgeProfile},
  );
}
