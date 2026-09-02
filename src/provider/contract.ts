import type { ProviderManifest } from "./manifest.js";

const identity = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const token = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;
const semver = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/u;

const manifestKeys = [
  "clientModulePath", "providerApiVersion", "providerId", "providerVersion", "schemaVersion", "targets",
];
const targetKeys = [
  "assetPaths", "capabilities", "checkpoint", "displayName", "gameCompatibilityLine", "id", "inputs",
  "netplayCompatibilityLine", "optionsKind",
];
const capabilityKeys = [
  "checkpoint", "discSwitch", "frameCounter", "frameMode", "inputFilter", "nativeSettings", "netplayPort",
  "pause", "requiresThreads", "screenshot", "standardGamepad", "validationProbes", "videoModes", "volume",
];
const inputKeys = ["cardinality", "kind", "optional", "role"];
const checkpointKeys = ["maxBytes", "readFormats", "writeFormat"];
const frameModes = new Set([
  "NONE", "SAME_ORIGIN_BLANK", "SAME_ORIGIN_RESOURCE", "ISOLATED_ORIGIN_RESOURCE",
]);
const resourceKinds = new Set([
  "ROM_BLOB_V1", "FILE_TREE_V1", "SEEKABLE_BLOB_V1", "NATIVE_WEB_V1", "ISOLATED_WEB_V1",
  "BIOS_BUNDLE_V1", "PARENT_ARCHIVE_V1", "MULTI_DISC_V1", "EXTERNAL_FILE_SET_V1",
  "WASM4_CART_V1",
]);
const videoModes = new Set(["original", "pixel", "smooth", "sharp-bilinear", "adaptive-sharpen"]);
const optionsKinds = new Set([
  "NONE_V1", "EMULATORJS_V1", "RPGMAKER_V1", "ONS_PROJECT_V1", "KIRIKIRI_PROJECT_V1",
]);

export function validateProviderManifest(value: unknown): ProviderManifest {
  const manifest = record(value);
  if (!manifest || !exactKeys(manifest, manifestKeys) || manifest.schemaVersion !== 1 ||
    manifest.providerApiVersion !== 1 || manifest.clientModulePath !== "client.mjs" ||
    !validIdentity(manifest.providerId) || !validSemver(manifest.providerVersion) ||
    !Array.isArray(manifest.targets) || manifest.targets.length === 0) {
    invalidManifest();
  }
  const targetIds: string[] = [];
  for (const target of manifest.targets) {
    targetIds.push(validateTarget(target));
  }
  if (!isSortedUnique(targetIds)) {invalidManifest();}
  return value as ProviderManifest;
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

function validateTarget(value: unknown): string {
  const target = record(value);
  if (!target || !exactKeys(target, targetKeys) || !validIdentity(target.id) ||
    !boundedText(target.displayName, 1, 120) || !validToken(target.gameCompatibilityLine) ||
    target.netplayCompatibilityLine !== null && !validToken(target.netplayCompatibilityLine) ||
    typeof target.optionsKind !== "string" || !optionsKinds.has(target.optionsKind)) {
    invalidManifest();
  }
  validateCapabilities(target.capabilities);
  validateInputs(target.inputs);
  const capabilities = record(target.capabilities);
  if (!capabilities) {invalidManifest();}
  if (capabilities.checkpoint === true) {
    validateCheckpoint(target.checkpoint);
  } else if (target.checkpoint !== null) {
    invalidManifest();
  }
  const assetPaths = stringArray(target.assetPaths, false);
  if (!assetPaths || !isSortedUnique(assetPaths) || !assetPaths.every(validPath)) {invalidManifest();}
  return target.id;
}

function validateCapabilities(value: unknown): void {
  const capabilities = record(value);
  if (!capabilities || !exactKeys(capabilities, capabilityKeys)) {invalidManifest();}
  for (const key of [
    "checkpoint", "discSwitch", "frameCounter", "inputFilter", "nativeSettings", "netplayPort", "pause",
    "requiresThreads", "screenshot", "standardGamepad", "volume",
  ]) {
    if (typeof capabilities[key] !== "boolean") {invalidManifest();}
  }
  if (typeof capabilities.frameMode !== "string" || !frameModes.has(capabilities.frameMode)) {
    invalidManifest();
  }
  const probes = stringArray(capabilities.validationProbes);
  if (!probes || !isSortedUnique(probes) || !probes.every(validToken)) {invalidManifest();}
  const modes = stringArray(capabilities.videoModes);
  if (!modes || !isSortedUnique(modes) || !modes.every((mode) => videoModes.has(mode))) {invalidManifest();}
}

function validateInputs(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) {invalidManifest();}
  const roles = new Set<string>();
  for (const inputValue of value) {
    const input = record(inputValue);
    if (!input || !exactKeys(input, inputKeys) || !validIdentity(input.role) || roles.has(input.role) ||
      typeof input.kind !== "string" || !resourceKinds.has(input.kind) ||
      input.cardinality !== "ONE" && input.cardinality !== "MANY" || typeof input.optional !== "boolean") {
      invalidManifest();
    }
    roles.add(input.role);
  }
}

function validateCheckpoint(value: unknown): void {
  const checkpoint = record(value);
  if (!checkpoint || !exactKeys(checkpoint, checkpointKeys) || !validToken(checkpoint.writeFormat) ||
    !positiveSafeInteger(checkpoint.maxBytes)) {
    invalidManifest();
  }
  const readFormats = stringArray(checkpoint.readFormats, false);
  if (!readFormats || !isSortedUnique(readFormats) || !readFormats.every(validToken) ||
    !readFormats.includes(checkpoint.writeFormat)) {
    invalidManifest();
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) {return "null";}
  if (typeof value === "boolean" || typeof value === "string") {return JSON.stringify(value);}
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {invalidCanonicalJson();}
    return String(value);
  }
  if (Array.isArray(value)) {return `[${value.map(canonicalJson).join(",")}]`;}
  const object = record(value);
  if (!object) {invalidCanonicalJson();}
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function stringArray(value: unknown, allowEmpty = true): string[] | null {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

function isSortedUnique(values: readonly string[]) {
  if (new Set(values).size !== values.length) {return false;}
  return values.every((value, index) => index === 0 || compareUtf8(values[index - 1] ?? "", value) < 0);
}

function compareUtf8(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) {return difference;}
  }
  return leftBytes.length - rightBytes.length;
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && identity.test(value);
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && token.test(value);
}

function validSemver(value: unknown): value is string {
  return typeof value === "string" && semver.test(value);
}

function boundedText(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validPath(value: string) {
  return value.length > 0 && value.length <= 240 && !value.startsWith("/") && !value.includes("\\") &&
    !value.includes("?") && !value.includes("#") && !value.includes("\0") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function invalidManifest(): never {
  throw new Error("PROVIDER_MANIFEST_INVALID");
}

function invalidCanonicalJson(): never {
  throw new Error("PROVIDER_CANONICAL_JSON_INVALID");
}
