import type { ProviderManifest } from "./manifest.js";

const identity = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const token = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;
const semver = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/u;

const manifestKeys = [
  "clientModulePath", "providerApiVersion", "providerId", "providerVersion", "schemaVersion", "targets",
];
const targetKeys = [
  "assetPaths", "capabilities", "checkpoint", "displayName", "gameCompatibilityLine", "id", "inputs",
  "netplayCompatibilityLine", "targetOptionsSchema",
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
  "ROM_BLOB", "FILE_TREE", "SEEKABLE_BLOB", "NATIVE_WEB", "ISOLATED_WEB",
  "BIOS_BUNDLE", "PARENT_ARCHIVE", "MULTI_DISC", "EXTERNAL_FILE_SET",
  "WASM4_CART",
]);
const videoModes = new Set(["original", "pixel", "smooth", "sharp-bilinear", "adaptive-sharpen"]);
const schemaPropertyName = /^[A-Za-z][A-Za-z0-9]{0,63}$/u;

export function validateProviderManifest(value: unknown): ProviderManifest {
  const manifest = record(value);
  if (!manifest || !exactKeys(manifest, manifestKeys) || manifest.schemaVersion !== 1 ||
    !positiveSafeInteger(manifest.providerApiVersion) || manifest.clientModulePath !== "client.mjs" ||
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
    target.netplayCompatibilityLine !== null && !validToken(target.netplayCompatibilityLine)) {
    invalidManifest();
  }
  validateTargetOptionsSchema(target.targetOptionsSchema, 0, true);
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

function validateTargetOptionsSchema(value: unknown, depth: number, root: boolean): void {
  const schema = record(value);
  if (!schema || depth > 8) {invalidManifest();}
  const baseType = schemaBaseType(schema.type);
  if (!baseType || root && (baseType !== "object" || schema.type !== "object")) {invalidManifest();}
  const allowed = schemaKeys(baseType);
  if (!Object.keys(schema).every((key) => allowed.has(key)) || !Object.hasOwn(schema, "type")) {invalidManifest();}
  switch (baseType) {
  case "object": return validateObjectOptionsSchema(schema, depth);
  case "array": return validateArrayOptionsSchema(schema, depth);
  case "string": return validateStringOptionsSchema(schema);
  case "integer": return validateIntegerOptionsSchema(schema);
  case "boolean":
    return;
  }
}

function validateObjectOptionsSchema(schema: Record<string, unknown>, depth: number): void {
  if (!exactKeys(schema, ["additionalProperties", "properties", "required", "type"]) ||
    schema.additionalProperties !== false) {invalidManifest();}
  const properties = record(schema.properties);
  const required = stringArray(schema.required);
  if (!properties || Object.keys(properties).length > 64 || !required || !isSortedUnique(required) ||
    !Object.keys(properties).every((key) => schemaPropertyName.test(key)) ||
    !required.every((key) => Object.hasOwn(properties, key))) {invalidManifest();}
  for (const property of Object.values(properties)) {validateTargetOptionsSchema(property, depth + 1, false);}
}

function validateArrayOptionsSchema(schema: Record<string, unknown>, depth: number): void {
  if (!Object.hasOwn(schema, "items") || !positiveOrZeroInteger(schema.maxItems) ||
    Number(schema.maxItems) > 256 || Object.hasOwn(schema, "minItems") &&
    (!positiveOrZeroInteger(schema.minItems) || Number(schema.minItems) > Number(schema.maxItems))) {
    invalidManifest();
  }
  validateTargetOptionsSchema(schema.items, depth + 1, false);
}

function validateStringOptionsSchema(schema: Record<string, unknown>): void {
  if (Object.hasOwn(schema, "format") && schema.format !== "safe-path" ||
    Object.hasOwn(schema, "minLength") && !positiveOrZeroInteger(schema.minLength) ||
    Object.hasOwn(schema, "maxLength") && (!positiveOrZeroInteger(schema.maxLength) || Number(schema.maxLength) > 4096) ||
    Object.hasOwn(schema, "minLength") && Object.hasOwn(schema, "maxLength") &&
    Number(schema.minLength) > Number(schema.maxLength)) {invalidManifest();}
  if (Object.hasOwn(schema, "enum")) {
    const values = stringArray(schema.enum, false);
    if (!values || !isSortedUnique(values) || values.length > 64) {invalidManifest();}
  }
}

function validateIntegerOptionsSchema(schema: Record<string, unknown>): void {
  if (Object.hasOwn(schema, "minimum") && !safeInteger(schema.minimum) ||
    Object.hasOwn(schema, "maximum") && !safeInteger(schema.maximum) ||
    Object.hasOwn(schema, "minimum") && Object.hasOwn(schema, "maximum") &&
    Number(schema.minimum) > Number(schema.maximum)) {invalidManifest();}
}

function schemaBaseType(value: unknown): string | null {
  if (["array", "boolean", "integer", "object", "string"].includes(String(value))) {return String(value);}
  if (!Array.isArray(value) || value.length !== 2 || value[1] !== "null" ||
    !["array", "boolean", "integer", "object", "string"].includes(String(value[0]))) {return null;}
  return String(value[0]);
}

function schemaKeys(type: string): Set<string> {
  if (type === "object") {return new Set(["additionalProperties", "properties", "required", "type"]);}
  if (type === "array") {return new Set(["items", "maxItems", "minItems", "type"]);}
  if (type === "string") {return new Set(["enum", "format", "maxLength", "minLength", "type"]);}
  if (type === "integer") {return new Set(["maximum", "minimum", "type"]);}
  return new Set(["type"]);
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

function positiveOrZeroInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
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
