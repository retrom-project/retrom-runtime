import type {
  RpgMakerAdapterConfig,
  RpgMakerGeneration,
  RpgMakerPositionV1,
  RpgMakerRuntimeConfig,
} from "./contract.js";

export function validateRpgMakerRuntimeConfig(config: RpgMakerRuntimeConfig): void {
  if (!config || typeof config !== "object" || !boundedText(config.sessionId, 200) ||
    !validGeneration(config.generation) || typeof config.validationPurpose !== "boolean" ||
    config.expectedRestorePosition !== null && !validPosition(config.expectedRestorePosition)) {
    throw new Error("RPG_RUNTIME_CONFIG_INVALID");
  }
  validateAdapter(config.generation, config.adapter);
}

function validateAdapter(generation: RpgMakerGeneration, adapter: RpgMakerAdapterConfig) {
  const valid = adapter.adapterKind === "EASYRPG_WEB"
    ? validEasyAdapter(generation, adapter)
    : adapter.adapterKind === "MKXP_LIBRETRO_WEB"
      ? validMkxpAdapter(generation, adapter)
      : validNativeAdapter(generation, adapter);
  if (!valid) {throw new Error("RPG_RUNTIME_CONFIG_INVALID");}
}

function validEasyAdapter(
  generation: RpgMakerGeneration,
  adapter: Extract<RpgMakerAdapterConfig, { adapterKind: "EASYRPG_WEB" }>,
) {
  return (generation === "RPG2000" || generation === "RPG2003") &&
    adapter.adapterId === "easyrpg-web" && adapter.checkpointSlot === 100 &&
    adapter.engineMode === (generation === "RPG2000" ? "rpg2k" : "rpg2k3") &&
    validUrl(adapter.runtimeBaseUrl) && validUrl(adapter.projectRootUrl) && validUrl(adapter.projectIndexUrl) &&
    (adapter.rtpSource === null || adapter.rtpSource.kind === "FILE_TREE_V1" && validUrl(adapter.rtpSource.indexUrl));
}

function validMkxpAdapter(
  generation: RpgMakerGeneration,
  adapter: Extract<RpgMakerAdapterConfig, { adapterKind: "MKXP_LIBRETRO_WEB" }>,
) {
  const rgss = generation === "RPGXP" ? 1 : generation === "RPGVX" ? 2 : generation === "RPGVXACE" ? 3 : 0;
  return rgss !== 0 && adapter.adapterId === "mkxp-libretro-web" && adapter.rgssVersion === rgss &&
    adapter.stateBufferBytes === 268435456 && validUrl(adapter.runtimeBaseUrl) &&
    validArchive(adapter.projectArchive) && validCore(adapter.core) &&
    adapter.rtpArchives.every((archive) => boundedText(archive.declaredName, 255) && validArchive(archive));
}

function validNativeAdapter(
  generation: RpgMakerGeneration,
  adapter: Extract<RpgMakerAdapterConfig, { adapterKind: "NATIVE_WEB" }>,
) {
  return (generation === "RPGMV" || generation === "RPGMZ") && adapter.adapterId === "native-web" &&
    adapter.bridgeProfile === generation && validUrl(adapter.uniqueOrigin) && validUrl(adapter.bootstrapUrl) &&
    (adapter.cleanupUrl === null || sameOrigin(adapter.cleanupUrl, adapter.uniqueOrigin)) &&
    /^[A-Za-z0-9_-]{43,128}$/u.test(adapter.bootstrapTicket);
}

function sameOrigin(left: string, right: string) {
  try {return new URL(left).origin === new URL(right).origin;} catch {return false;}
}
function validCore(core: Extract<RpgMakerAdapterConfig, { adapterKind: "MKXP_LIBRETRO_WEB" }>["core"]) {
  return validUrl(core.jsUrl) && validUrl(core.wasmUrl) && positiveInteger(core.jsSizeBytes) &&
    positiveInteger(core.wasmSizeBytes) && validDigest(core.jsSha256) && validDigest(core.wasmSha256) &&
    validDigest(core.artifactSetSha256);
}
function validArchive(archive: {
  kind: string;
  rangeRequired: boolean;
  url: string;
  sha256: string;
  sizeBytes: number;
}) {
  return archive.kind === "SEEKABLE_BLOB_V1" && archive.rangeRequired === true &&
    validUrl(archive.url) && validDigest(archive.sha256) && positiveInteger(archive.sizeBytes);
}
function validPosition(position: RpgMakerPositionV1) {
  return [position.mapId, position.playerX, position.playerY, position.fixtureState]
    .every((value) => Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647);
}
function validGeneration(value: unknown): value is RpgMakerGeneration {
  return value === "RPG2000" || value === "RPG2003" || value === "RPGXP" || value === "RPGVX" ||
    value === "RPGVXACE" || value === "RPGMV" || value === "RPGMZ";
}
function validUrl(value: string) {
  try {return new URL(value, globalThis.location?.origin ?? "https://runtime.invalid").protocol.startsWith("http");}
  catch {return false;}
}
function validDigest(value: string) {return /^[0-9a-f]{64}$/u.test(value);}
function positiveInteger(value: number) {return Number.isSafeInteger(value) && value > 0;}
function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}
