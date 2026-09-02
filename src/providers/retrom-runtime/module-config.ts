import {validateRuntimeConfig, type RuntimeConfig} from "../../catalog.js";
import type {FileTreeSource, SeekableBlobSource} from "../../contract.js";
import {
  validateProviderLaunchRequest,
  type AssetIndexV1,
  type LaunchEnvelopeV1,
  type RuntimeResourceV1,
} from "../../provider/module-api.js";
import {retromRuntimeProviderDefinition} from "./catalog.js";

export function projectLegacyRuntimeConfig(
  envelope: LaunchEnvelopeV1,
  assetIndex: AssetIndexV1,
): RuntimeConfig {
  validateProviderLaunchRequest(envelope, retromRuntimeProviderDefinition, {
    [envelope.runtime.targetId]: envelope.runtime.targetContractSha256,
  });
  const target = retromRuntimeProviderDefinition.targets.find((entry) => entry.id === envelope.runtime.targetId);
  const adapter = retromRuntimeProviderDefinition.adapters.find((entry) => entry.id === target?.adapterId);
  if (!target || !adapter) {invalidRequest();}
  let config: RuntimeConfig;
  switch (adapter.kind) {
  case "EASYRPG_WEB": config = easyRpgConfig(envelope, target.implementation); break;
  case "MKXP_LIBRETRO_WEB": config = mkxpConfig(envelope, target.implementation, assetIndex); break;
  case "NATIVE_WEB": config = nativeRpgConfig(envelope, target.implementation); break;
  case "ONS_YURI_WEB": config = onsConfig(envelope); break;
  case "KIRIKIRI2_WEB": config = kirikiriConfig(envelope); break;
  case "BUTTERSCOTCH_WEB": config = butterscotchConfig(envelope); break;
  case "TYRANOSCRIPT_WEB": config = tyranoScriptConfig(envelope); break;
  case "WASM4_WEB": config = wasm4Config(envelope); break;
  default: invalidRequest();
  }
  try {validateRuntimeConfig(config);} catch {invalidRequest();}
  return config;
}

function easyRpgConfig(envelope: LaunchEnvelopeV1, implementation: Readonly<Record<string, unknown>>): RuntimeConfig {
  const game = resource(envelope, "game", "FILE_TREE_V1");
  const rtp = optionalResource(envelope, "rtp", "FILE_TREE_V1");
  if (implementation.engineMode !== "rpg2k" && implementation.engineMode !== "rpg2k3") {invalidRequest();}
  return {
    adapter: {
      adapterId: "easyrpg-web",
      adapterKind: "EASYRPG_WEB",
      checkpointSlot: 100,
      engineMode: implementation.engineMode,
      projectIndexUrl: game.indexUrl,
      projectRootUrl: rootFromIndex(game.indexUrl),
      rtpSource: rtp ? fileTreeSource(rtp) : null,
      runtimeBaseUrl: assetBase(envelope, "easyrpg"),
    },
    expectedRestorePosition: rpgOptions(envelope).expectedRestorePosition,
    generation: implementation.engineMode === "rpg2k" ? "RPG2000" : "RPG2003",
    sessionId: envelope.session.id,
    validationPurpose: envelope.session.purpose === "RUNTIME_VALIDATION",
  };
}

function mkxpConfig(
  envelope: LaunchEnvelopeV1,
  implementation: Readonly<Record<string, unknown>>,
  assetIndex: AssetIndexV1,
): RuntimeConfig {
  const game = resource(envelope, "game", "SEEKABLE_BLOB_V1");
  const jsPath = "assets/mkxp/mkxp-z_libretro.js";
  const wasmPath = "assets/mkxp/mkxp-z_libretro.wasm";
  const js = assetIndex[jsPath];
  const wasm = assetIndex[wasmPath];
  if (!js || !wasm || ![1, 2, 3].includes(Number(implementation.rgssVersion))) {invalidRequest();}
  const rgssVersion = implementation.rgssVersion as 1 | 2 | 3;
  return {
    adapter: {
      adapterId: "mkxp-libretro-web",
      adapterKind: "MKXP_LIBRETRO_WEB",
      core: {
        artifactSetSha256: envelope.runtime.targetContractSha256,
        jsSha256: js.sha256,
        jsSizeBytes: js.sizeBytes,
        jsUrl: `${envelope.runtime.runtimeBaseUrl}${jsPath}`,
        wasmSha256: wasm.sha256,
        wasmSizeBytes: wasm.sizeBytes,
        wasmUrl: `${envelope.runtime.runtimeBaseUrl}${wasmPath}`,
      },
      projectArchive: seekableSource(game),
      rgssVersion,
      rtpArchives: resources(envelope, "rtp", "SEEKABLE_BLOB_V1").map((entry) => ({
        ...seekableSource(entry), declaredName: `rtp-${entry.ordinal}`,
      })),
      runtimeBaseUrl: assetBase(envelope, "mkxp"),
      stateBufferBytes: 268435456,
    },
    expectedRestorePosition: rpgOptions(envelope).expectedRestorePosition,
    generation: ({1: "RPGXP", 2: "RPGVX", 3: "RPGVXACE"} as const)[rgssVersion],
    sessionId: envelope.session.id,
    validationPurpose: envelope.session.purpose === "RUNTIME_VALIDATION",
  };
}

function nativeRpgConfig(
  envelope: LaunchEnvelopeV1,
  implementation: Readonly<Record<string, unknown>>,
): RuntimeConfig {
  const game = resource(envelope, "game", "NATIVE_WEB_V1");
  if (implementation.bridgeProfile !== "RPGMV" && implementation.bridgeProfile !== "RPGMZ") {invalidRequest();}
  return {
    adapter: {
      adapterId: "native-web",
      adapterKind: "NATIVE_WEB",
      bootstrapTicket: game.bootstrapTicket,
      bootstrapUrl: game.entryUrl,
      bridgeProfile: implementation.bridgeProfile,
      cleanupUrl: game.cleanupUrl,
      uniqueOrigin: game.origin,
    },
    expectedRestorePosition: rpgOptions(envelope).expectedRestorePosition,
    generation: implementation.bridgeProfile,
    sessionId: envelope.session.id,
    validationPurpose: envelope.session.purpose === "RUNTIME_VALIDATION",
  };
}

function onsConfig(envelope: LaunchEnvelopeV1): RuntimeConfig {
  const game = resource(envelope, "game", "FILE_TREE_V1");
  const options = envelope.targetOptions;
  if (options.kind !== "ONS_PROJECT_V1") {invalidRequest();}
  return {
    adapter: {
      adapterId: "ons-yuri-web", adapterKind: "ONS_YURI_WEB", checkpointSlot: 999,
      projectIndexUrl: game.indexUrl, runtimeBaseUrl: assetBase(envelope, "ons"),
      scriptEncoding: options.scriptEncoding,
    },
    sessionId: envelope.session.id,
  };
}

function kirikiriConfig(envelope: LaunchEnvelopeV1): RuntimeConfig {
  const game = resource(envelope, "game", "FILE_TREE_V1");
  const options = envelope.targetOptions;
  if (options.kind !== "KIRIKIRI_PROJECT_V1") {invalidRequest();}
  return {
    adapter: {
      adapterId: "kirikiri2-web", adapterKind: "KIRIKIRI2_WEB", checkpointSlot: 1999,
      projectIndexUrl: game.indexUrl, runtimeBaseUrl: assetBase(envelope, "kirikiri"),
      startupXp3Path: options.startupXp3Path,
    },
    sessionId: envelope.session.id,
  };
}

function butterscotchConfig(envelope: LaunchEnvelopeV1): RuntimeConfig {
  const game = resource(envelope, "game", "FILE_TREE_V1");
  return {
    adapter: {
      adapterId: "butterscotch-web", adapterKind: "BUTTERSCOTCH_WEB",
      projectIndexUrl: game.indexUrl, runtimeBaseUrl: assetBase(envelope, "butterscotch"),
    },
    contentDigest: game.contentDigest,
    sessionId: envelope.session.id,
  };
}

function tyranoScriptConfig(envelope: LaunchEnvelopeV1): RuntimeConfig {
  const game = resource(envelope, "game", "ISOLATED_WEB_V1");
  return {
    adapter: {
      adapterId: "tyranoscript-web", adapterKind: "TYRANOSCRIPT_WEB",
      bootstrapTicket: game.bootstrapTicket, cleanupUrl: game.cleanupUrl,
      entryUrl: game.entryUrl, uniqueOrigin: game.origin,
    },
    contentDigest: game.contentDigest,
    sessionId: envelope.session.id,
  };
}

function wasm4Config(envelope: LaunchEnvelopeV1): RuntimeConfig {
  const game = resource(envelope, "game", "WASM4_CART_V1");
  return {
    adapter: {
      adapterId: "wasm4-web", adapterKind: "WASM4_WEB", cartUrl: game.url,
      runtimeBaseUrl: assetBase(envelope, "wasm4"),
    },
    cartSizeBytes: game.sizeBytes,
    contentDigest: game.sha256,
    sessionId: envelope.session.id,
  };
}

function resource<Kind extends RuntimeResourceV1["kind"]>(
  envelope: LaunchEnvelopeV1,
  role: string,
  kind: Kind,
): RuntimeResourceOfKind<Kind> {
  const matches = resources(envelope, role, kind);
  if (matches.length !== 1) {invalidRequest();}
  return matches[0];
}

function optionalResource<Kind extends RuntimeResourceV1["kind"]>(
  envelope: LaunchEnvelopeV1,
  role: string,
  kind: Kind,
) {
  const matches = resources(envelope, role, kind);
  if (matches.length > 1) {invalidRequest();}
  return matches[0] ?? null;
}

function resources<Kind extends RuntimeResourceV1["kind"]>(
  envelope: LaunchEnvelopeV1,
  role: string,
  kind: Kind,
) {
  return envelope.resources.filter(
    (entry): entry is RuntimeResourceOfKind<Kind> => entry.role === role && entry.kind === kind,
  );
}

type RuntimeResourceOfKind<Kind extends RuntimeResourceV1["kind"]> = RuntimeResourceV1 & {kind: Kind};

function rpgOptions(envelope: LaunchEnvelopeV1) {
  if (envelope.targetOptions.kind !== "RPGMAKER_V1") {invalidRequest();}
  return envelope.targetOptions;
}

function rootFromIndex(indexUrl: string) {
  if (!indexUrl.endsWith("/index.json")) {invalidRequest();}
  return indexUrl.slice(0, -"index.json".length);
}

function fileTreeSource(resourceValue: RuntimeResourceOfKind<"FILE_TREE_V1">): FileTreeSource {
  return {kind: "FILE_TREE_V1", indexUrl: resourceValue.indexUrl};
}

function seekableSource(resourceValue: RuntimeResourceOfKind<"SEEKABLE_BLOB_V1">): SeekableBlobSource {
  return {
    kind: "SEEKABLE_BLOB_V1", rangeRequired: true, sha256: resourceValue.sha256,
    sizeBytes: resourceValue.sizeBytes, url: resourceValue.url,
  };
}

function assetBase(envelope: LaunchEnvelopeV1, directory: string) {
  return `${envelope.runtime.runtimeBaseUrl}assets/${directory}/`;
}

function invalidRequest(): never {throw new Error("PROVIDER_LAUNCH_REQUEST_INVALID");}
