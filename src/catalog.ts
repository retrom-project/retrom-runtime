import type { RpgAdapterConfig, RpgGeneration, RpgPosition, RpgRuntimeConfig } from "./contract.js";

export const runtimeCatalog = [
  { runtimeId: "easyrpg-0811-r2", generations: ["RPG2000", "RPG2003"], adapterKind: "EASYRPG_WEB", adapterId: "easyrpg-web-v1", adapterAbi: "easyrpg-save-v1" },
  { runtimeId: "easyrpg-0811-r3", generations: ["RPG2000", "RPG2003"], adapterKind: "EASYRPG_WEB", adapterId: "easyrpg-web-v1", adapterAbi: "easyrpg-save-v1" },
  { runtimeId: "mkxp-f2efc98-r3", generations: ["RPGXP", "RPGVX", "RPGVXACE"], adapterKind: "MKXP_LIBRETRO_WEB", adapterId: "mkxp-z-libretro-v4", adapterAbi: "mkxp-state-v1" },
  { runtimeId: "native-mv-v4", generations: ["RPGMV"], adapterKind: "NATIVE_WEB", adapterId: "rpg-native-web-v2", adapterAbi: "rpg-native-save-v1" },
  { runtimeId: "native-mz-v7", generations: ["RPGMZ"], adapterKind: "NATIVE_WEB", adapterId: "rpg-native-web-v5", adapterAbi: "rpg-native-save-v1" },
] as const;

export function validateRuntimeConfig(config: RpgRuntimeConfig): void {
  if (!config || typeof config !== "object" || !boundedText(config.sessionId, 200) ||
    !validGeneration(config.generation) || typeof config.validationPurpose !== "boolean" ||
    config.expectedRestorePosition !== null && !validPosition(config.expectedRestorePosition)) {
    throw new Error("RPG_RUNTIME_CONFIG_INVALID");
  }
  validateAdapter(config.generation, config.adapter);
}

function validateAdapter(generation: RpgGeneration, adapter: RpgAdapterConfig) {
  const valid = adapter.adapterKind === "EASYRPG_WEB"
    ? validEasyAdapter(generation, adapter)
    : adapter.adapterKind === "MKXP_LIBRETRO_WEB"
      ? validMkxpAdapter(generation, adapter)
      : validNativeAdapter(generation, adapter);
  if (!valid) {throw new Error("RPG_RUNTIME_CONFIG_INVALID");}
}

function validEasyAdapter(
  generation: RpgGeneration,
  adapter: Extract<RpgAdapterConfig, { adapterKind: "EASYRPG_WEB" }>,
) {
  return (generation === "RPG2000" || generation === "RPG2003") &&
    adapter.adapterId === "easyrpg-web-v1" && adapter.checkpointSlot === 100 &&
    adapter.engineMode === (generation === "RPG2000" ? "rpg2k" : "rpg2k3") &&
    validUrl(adapter.runtimeBaseUrl) && validUrl(adapter.projectRootUrl) &&
    validUrl(adapter.projectIndexUrl) &&
    (adapter.rtpArchive === null || validDigest(adapter.rtpArchive.sha256));
}

function validMkxpAdapter(
  generation: RpgGeneration,
  adapter: Extract<RpgAdapterConfig, { adapterKind: "MKXP_LIBRETRO_WEB" }>,
) {
  const rgss = generation === "RPGXP" ? 1 : generation === "RPGVX" ? 2 : generation === "RPGVXACE" ? 3 : 0;
  return rgss !== 0 && adapter.adapterId === "mkxp-z-libretro-v4" && adapter.rgssVersion === rgss &&
    adapter.stateBufferBytes === 268435456 && validUrl(adapter.runtimeBaseUrl) &&
    validArchive(adapter.projectArchive) && validCore(adapter.core) &&
    adapter.rtpArchives.every((archive) => boundedText(archive.declaredName, 255) && validArchive(archive));
}

function validNativeAdapter(
  generation: RpgGeneration,
  adapter: Extract<RpgAdapterConfig, { adapterKind: "NATIVE_WEB" }>,
) {
  return (generation === "RPGMV" || generation === "RPGMZ") &&
    adapter.bridgeProfile === (generation === "RPGMV" ? "mv-v1" : "mz-v1") &&
    validUrl(adapter.uniqueOrigin) && validUrl(adapter.bootstrapUrl) &&
    /^[A-Za-z0-9_-]{43,128}$/u.test(adapter.bootstrapTicket);
}

function validCore(core: Extract<RpgAdapterConfig, { adapterKind: "MKXP_LIBRETRO_WEB" }>["core"]) {
  return validUrl(core.jsUrl) && validUrl(core.wasmUrl) && positiveInteger(core.jsSizeBytes) &&
    positiveInteger(core.wasmSizeBytes) && validDigest(core.jsSha256) && validDigest(core.wasmSha256) &&
    validDigest(core.artifactSetSha256);
}

function validArchive(archive: { url: string; sha256: string; sizeBytes: number }) {
  return validUrl(archive.url) && validDigest(archive.sha256) && positiveInteger(archive.sizeBytes);
}

function validPosition(position: RpgPosition) {
  return [position.mapId, position.playerX, position.playerY, position.fixtureState]
    .every((value) => Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647);
}

function validGeneration(value: unknown): value is RpgGeneration {
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
