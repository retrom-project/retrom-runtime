import type { ProviderDefinition, TargetOptionsPropertySchema, TargetOptionsSchema } from "./declarations.js";
import { parseCanonicalJSON } from "./canonical-json.js";
import type {
  LaunchEnvelopeV1,
  RuntimeBlobResourceV1,
  RuntimeCapabilitiesV1,
  RuntimeFileEntryV1,
  RuntimeFileSetResourceV1,
  RuntimeFileTreeResourceV1,
  RuntimeHostV1,
  RuntimeMultiDiscResourceV1,
  RuntimeResourceV1,
  RuntimeWebResourceV1,
} from "./generated/provider-module-v1.js";
import { projectProviderManifest, type ProviderManifest } from "./manifest.js";

export type * from "./generated/provider-module-v1.js";

export type RuntimeCheckpointContractV1 = LaunchEnvelopeV1["runtime"]["checkpoint"];
export type AssetIndexV1 = Readonly<Record<string, {sha256: string; sizeBytes: number}>>;

export function parseLaunchEnvelopeJSON(source: string): LaunchEnvelopeV1 {
  try {return validateLaunchEnvelopeBoundary(parseCanonicalJSON(source));}
  catch {return invalidRequest();}
}

export function validateLaunchEnvelopeBoundary(value: unknown): LaunchEnvelopeV1 {
  if (!isRecord(value) || !exactKeys(value, [
    "netplay", "resources", "restore", "runtime", "schemaVersion", "session", "targetOptions", "validation",
  ]) || value.schemaVersion !== 1) {invalidRequest();}
  const runtime = validateRuntime(value.runtime);
  if (!validSession(value.session) || !validTargetOptionsShape(value.targetOptions) ||
    !validResourceSetShape(value.resources) || !validRestore(value.restore, runtime.checkpoint) ||
    !validValidation(value.validation, runtime.capabilities.validationProbes) ||
    !validNetplay(value.netplay, runtime.capabilities.netplayPort, value.session)) {invalidRequest();}
  return value as LaunchEnvelopeV1;
}

export function validateProviderLaunchRequest(
  value: unknown,
  definition: ProviderDefinition,
): LaunchEnvelopeV1 {
  const envelope = validateLaunchEnvelopeBoundary(value);
  const runtime = envelope.runtime;
  const manifest = projectProviderManifest(definition);
  const target = manifest.targets.find((entry) => entry.id === runtime.targetId);
  if (!target || !validEnvelopeContract(envelope, runtime, manifest, target)) {
    invalidRequest();
  }
  return envelope;
}

export function validateTargetOptionsAgainstSchema(
  value: unknown,
  schema: TargetOptionsSchema,
): LaunchEnvelopeV1["targetOptions"] {
  if (!validTargetOptions(value, schema)) {invalidRequest();}
  return value as LaunchEnvelopeV1["targetOptions"];
}

export function validateRuntimeHost(value: unknown): RuntimeHostV1 {
  const host = isRecord(value) ? value : null;
  const signal = host && isRecord(host.signal) ? host.signal : null;
  if (!host || typeof host.mountFrame !== "function" || typeof host.loadRestore !== "function" ||
    typeof host.reportDiagnostic !== "function" || !signal || typeof signal.aborted !== "boolean" ||
    typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function") {
    throw new Error("PROVIDER_HOST_INVALID");
  }
  return value as RuntimeHostV1;
}

function validEnvelopeContract(
  value: LaunchEnvelopeV1,
  runtime: LaunchEnvelopeV1["runtime"],
  manifest: ProviderManifest,
  target: ProviderManifest["targets"][number],
) {
  return runtime.providerId === manifest.providerId && runtime.providerVersion === manifest.providerVersion &&
    runtime.providerApiVersion === manifest.providerApiVersion && validBundleURLs(runtime) &&
    sameCapabilities(runtime.capabilities, target.capabilities) &&
    sameCheckpoint(runtime.checkpoint, target.checkpoint) && validSession(value.session) &&
    validTargetOptions(value.targetOptions, target.targetOptionsSchema) && validResources(value.resources, target.inputs) &&
    validRestore(value.restore, target.checkpoint) && validValidation(value.validation, target.capabilities.validationProbes) &&
    validNetplay(value.netplay, target.capabilities.netplayPort, value.session);
}

function validateRuntime(value: unknown) {
  const runtime = isRecord(value) ? value : null;
  if (!runtime || !exactKeys(runtime, [
    "bundleSha256", "capabilities", "checkpoint", "moduleSha256", "moduleUrl", "providerApiVersion",
    "providerId", "providerVersion", "runtimeBaseUrl", "targetId",
  ]) || !validIdentity(runtime.providerId) || !validSemver(runtime.providerVersion) ||
    runtime.providerApiVersion !== 1 || !validIdentity(runtime.targetId) ||
    !validDigest(runtime.bundleSha256) || !validDigest(runtime.moduleSha256) ||
    !validCapabilities(runtime.capabilities) || !validCheckpointShape(runtime.checkpoint)) {invalidRequest();}
  return runtime as unknown as LaunchEnvelopeV1["runtime"];
}

function validBundleURLs(runtime: LaunchEnvelopeV1["runtime"]) {
  const base = `/runtime/providers/${runtime.providerId}/${runtime.bundleSha256}/`;
  return runtime.runtimeBaseUrl === base && runtime.moduleUrl === `${base}client.mjs`;
}

function validSession(value: unknown) {
  if (!isRecord(value) || !exactKeys(value, [
    "coreName", "id", "mode", "platformName", "purpose", "returnTo", "title", "warnings",
  ]) || !uuid(value.id) || !["PRODUCT", "REVIEW_PREVIEW", "RUNTIME_VALIDATION"].includes(String(value.purpose)) ||
    !["SINGLE", "NETPLAY"].includes(String(value.mode)) || !boundedText(value.title, 1, 500) ||
    !boundedText(value.platformName, 1, 200) || !boundedText(value.coreName, 1, 200) ||
    !relativeURL(value.returnTo) || !Array.isArray(value.warnings) ||
    value.warnings.length > 16 || !value.warnings.every((warning) => boundedText(warning, 1, 200))) {return false;}
  return true;
}

function validCapabilities(value: unknown): value is RuntimeCapabilitiesV1 {
  if (!isRecord(value) || !exactKeys(value, [
    "checkpoint", "discSwitch", "frameCounter", "frameMode", "inputFilter", "nativeSettings", "netplayPort",
    "pause", "requiresThreads", "screenshot", "standardGamepad", "validationProbes", "videoModes", "volume",
  ])) {return false;}
  for (const key of [
    "checkpoint", "discSwitch", "frameCounter", "inputFilter", "nativeSettings", "netplayPort", "pause",
    "requiresThreads", "screenshot", "standardGamepad", "volume",
  ]) {if (typeof value[key] !== "boolean") {return false;}}
  return ["NONE", "SAME_ORIGIN_BLANK", "SAME_ORIGIN_RESOURCE", "ISOLATED_ORIGIN_RESOURCE"]
    .includes(String(value.frameMode)) && Array.isArray(value.validationProbes) &&
    sortedUnique(value.validationProbes) && value.validationProbes.every(validToken) &&
    Array.isArray(value.videoModes) && sortedUnique(value.videoModes) &&
    value.videoModes.every((mode) => ["original", "pixel", "smooth", "sharp-bilinear", "adaptive-sharpen"].includes(mode));
}

function validCheckpointShape(value: unknown): value is RuntimeCheckpointContractV1 {
  return value === null || isRecord(value) && exactKeys(value, ["maxBytes", "readFormats", "writeFormat"]) &&
    validToken(value.writeFormat) && positiveInteger(value.maxBytes) && Array.isArray(value.readFormats) &&
    sortedUnique(value.readFormats) && value.readFormats.every(validToken) && value.readFormats.includes(value.writeFormat);
}

function sameCapabilities(actual: RuntimeCapabilitiesV1, expected: RuntimeCapabilitiesV1) {
  return actual.checkpoint === expected.checkpoint && actual.frameCounter === expected.frameCounter &&
    actual.discSwitch === expected.discSwitch && actual.frameMode === expected.frameMode &&
    actual.inputFilter === expected.inputFilter && actual.nativeSettings === expected.nativeSettings &&
    actual.netplayPort === expected.netplayPort && actual.pause === expected.pause &&
    actual.requiresThreads === expected.requiresThreads && actual.screenshot === expected.screenshot &&
    actual.standardGamepad === expected.standardGamepad && actual.volume === expected.volume &&
    actual.validationProbes.length === expected.validationProbes.length &&
    actual.validationProbes.every((probe, index) => probe === expected.validationProbes[index]) &&
    actual.videoModes.length === expected.videoModes.length &&
    actual.videoModes.every((mode, index) => mode === expected.videoModes[index]);
}

function sameCheckpoint(
  actual: RuntimeCheckpointContractV1,
  expected: ProviderManifest["targets"][number]["checkpoint"],
) {
  return actual === null && expected === null || actual !== null && expected !== null &&
    actual.writeFormat === expected.writeFormat && actual.maxBytes === expected.maxBytes &&
    actual.readFormats.length === expected.readFormats.length &&
    actual.readFormats.every((format, index) => format === expected.readFormats[index]);
}

function validResources(
  value: unknown,
  inputs: ProviderManifest["targets"][number]["inputs"],
) {
  if (!validResourceSetShape(value)) {return false;}
  const resources = value as RuntimeResourceV1[];
  for (const resource of resources) {
    const input = inputs.find((entry) => entry.role === resource.role);
    if (!input || input.kind !== resource.kind) {return false;}
  }
  return inputs.every((input) => {
    const matches = resources.filter((resource) => resource.role === input.role);
    if (!input.optional && matches.length === 0 || input.cardinality === "ONE" && matches.length > 1) {return false;}
    return matches.every((resource, index) => resource.ordinal === index);
  });
}

function validResourceSetShape(value: unknown): value is RuntimeResourceV1[] {
  if (!Array.isArray(value) || value.length > 128) {return false;}
  const identities = new Set<string>();
  for (const resource of value) {
    if (!isRecord(resource) || !validIdentity(resource.role) || !Number.isSafeInteger(resource.ordinal) ||
      Number(resource.ordinal) < 0) {return false;}
    const identity = `${resource.role}\0${resource.ordinal}`;
    if (identities.has(identity) || !validResourceShape(resource as RuntimeResourceV1)) {return false;}
    identities.add(identity);
  }
  const roles = new Set(value.map((resource) => String(resource.role)));
  return [...roles].every((role) => value.filter((resource) => resource.role === role)
    .every((resource, index) => resource.ordinal === index));
}

function validResourceShape(resource: RuntimeResourceV1) {
  if (resource.kind === "FILE_TREE") {return validFileTreeResource(resource);}
  if (resource.kind === "NATIVE_WEB" || resource.kind === "ISOLATED_WEB") {return validWebResource(resource);}
  if (isBlobResource(resource)) {return validBlobResource(resource);}
  if (resource.kind === "BIOS_BUNDLE" || resource.kind === "EXTERNAL_FILE_SET") {return validFileSetResource(resource);}
  if (resource.kind === "MULTI_DISC") {return validMultiDiscResource(resource);}
  return false;
}

function validFileTreeResource(resource: RuntimeFileTreeResourceV1) {
  return exactKeys(resource, ["contentDigest", "indexUrl", "kind", "ordinal", "role"]) &&
    validDigest(resource.contentDigest) && relativeURL(resource.indexUrl);
}
function validWebResource(resource: RuntimeWebResourceV1) {
  return exactKeys(resource, [
    "bootstrapTicket", "cleanupUrl", "contentDigest", "entryUrl", "kind", "ordinal", "origin", "role",
  ]) && validDigest(resource.contentDigest) && validOrigin(resource.origin) &&
    sameOrigin(resource.entryUrl, resource.origin) && (resource.cleanupUrl === null ||
      sameOrigin(resource.cleanupUrl, resource.origin)) && /^[A-Za-z0-9_-]{43,128}$/u.test(resource.bootstrapTicket);
}
function validBlobResource(resource: RuntimeBlobResourceV1) {
  return exactKeys(resource, ["kind", "ordinal", "rangeRequired", "role", "sha256", "sizeBytes", "url"]) &&
    validDigest(resource.sha256) && positiveInteger(resource.sizeBytes) && relativeURL(resource.url) &&
    resource.rangeRequired === (resource.kind === "SEEKABLE_BLOB" || resource.kind === "PARENT_ARCHIVE");
}
function validFileSetResource(resource: RuntimeFileSetResourceV1) {
  return exactKeys(resource, ["files", "kind", "ordinal", "role"]) && Array.isArray(resource.files) &&
    resource.files.length > 0 && resource.files.every(validFileEntry) &&
    sortedUnique(resource.files.map((entry) => entry.virtualPath));
}
function validMultiDiscResource(resource: RuntimeMultiDiscResourceV1) {
  return exactKeys(resource, ["entries", "initialDiscIndex", "kind", "ordinal", "role"]) &&
    Array.isArray(resource.entries) && resource.entries.length > 0 &&
    resource.entries.every((entry, index) => validDiscEntry(entry, index)) &&
    Number.isSafeInteger(resource.initialDiscIndex) && resource.initialDiscIndex >= 0 &&
    resource.initialDiscIndex < resource.entries.length;
}
function validFileEntry(value: RuntimeFileEntryV1) {
  return isRecord(value) && exactKeys(value, ["logicalName", "sha256", "sizeBytes", "url", "virtualPath"]) &&
    boundedText(value.logicalName, 1, 240) && safePath(value.virtualPath) && relativeURL(value.url) &&
    validDigest(value.sha256) && positiveInteger(value.sizeBytes);
}

function validDiscEntry(value: RuntimeMultiDiscResourceV1["entries"][number], index: number) {
  return isRecord(value) && exactKeys(value, ["index", "label", "sha256", "sizeBytes", "url"]) &&
    value.index === index && boundedText(value.label, 1, 240) && relativeURL(value.url) &&
    validDigest(value.sha256) && positiveInteger(value.sizeBytes);
}

function validTargetOptions(value: unknown, schema: TargetOptionsSchema) {
  return validTargetOptionsShape(value) && validTargetOptionsSchemaValue(value, schema, 0);
}

function validTargetOptionsShape(value: unknown): value is Record<string, unknown> {
  if (!jsonRecord(value)) {return false;}
  try {return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 16 * 1024;}
  catch {return false;}
}

function validTargetOptionsSchemaValue(
  value: unknown,
  schema: TargetOptionsPropertySchema,
  depth: number,
): boolean {
  if (depth > 8) {return false;}
  const shape = schema as unknown as Record<string, unknown>;
  const nullable = Array.isArray(shape.type);
  if (value === null) {return nullable;}
  const type = nullable ? String((shape.type as unknown[])[0]) : String(shape.type);
  if (type === "object") {return validObjectTargetOptions(value, shape, depth);}
  if (type === "array") {return validArrayTargetOptions(value, shape, depth);}
  if (type === "string") {return validStringTargetOption(value, shape);}
  if (type === "integer") {return validIntegerTargetOption(value, shape);}
  return type === "boolean" && typeof value === "boolean";
}

function validObjectTargetOptions(value: unknown, shape: Record<string, unknown>, depth: number): boolean {
  if (!isRecord(value)) {return false;}
  const properties = shape.properties as Readonly<Record<string, TargetOptionsPropertySchema>>;
  const required = shape.required as readonly string[];
  if (!Object.keys(value).every((key) => Object.hasOwn(properties, key)) ||
    !required.every((key) => Object.hasOwn(value, key))) {return false;}
  return Object.entries(value).every(([key, item]) =>
    validTargetOptionsSchemaValue(item, properties[key] as TargetOptionsPropertySchema, depth + 1));
}

function validArrayTargetOptions(value: unknown, shape: Record<string, unknown>, depth: number): boolean {
  return Array.isArray(value) && value.length >= Number(shape.minItems ?? 0) &&
    value.length <= Number(shape.maxItems) && value.every((item) =>
      validTargetOptionsSchemaValue(item, shape.items as TargetOptionsPropertySchema, depth + 1));
}

function validStringTargetOption(value: unknown, shape: Record<string, unknown>): boolean {
  if (typeof value !== "string") {return false;}
  const length = [...value].length;
  return wellFormed(value) && length >= Number(shape.minLength ?? 0) &&
    length <= Number(shape.maxLength ?? 4096) &&
    (!Array.isArray(shape.enum) || shape.enum.includes(value)) &&
    (shape.format !== "safe-path" || safePath(value));
}

function validIntegerTargetOption(value: unknown, shape: Record<string, unknown>): boolean {
  return Number.isSafeInteger(value) && Number(value) >= Number(shape.minimum ?? Number.MIN_SAFE_INTEGER) &&
    Number(value) <= Number(shape.maximum ?? Number.MAX_SAFE_INTEGER);
}

function validRestore(
  value: unknown,
  checkpoint: ProviderManifest["targets"][number]["checkpoint"] | RuntimeCheckpointContractV1,
) {
  if (value === null) {return true;}
  return checkpoint !== null && isRecord(value) && exactKeys(value, ["format", "sha256", "sizeBytes", "url"]) &&
    typeof value.format === "string" && checkpoint.readFormats.includes(value.format) &&
    validDigest(value.sha256) && positiveInteger(value.sizeBytes) && value.sizeBytes <= checkpoint.maxBytes &&
    relativeURL(value.url);
}

function validValidation(value: unknown, probes: readonly string[]) {
  if (value === null) {return true;}
  return isRecord(value) && exactKeys(value, ["input", "probeId"]) &&
    typeof value.probeId === "string" && probes.includes(value.probeId) && jsonRecord(value.input);
}

function validNetplay(value: unknown, supported: boolean, session: unknown) {
  if (value === null) {return isRecord(session) && session.mode !== "NETPLAY";}
  return supported && isRecord(session) && session.mode === "NETPLAY" && isRecord(value) && exactKeys(value, [
    "playerNo", "profile", "roomId", "sessionId", "socketUrl",
  ]) && boundedText(value.roomId, 1, 128) && uuid(value.sessionId) && Number.isSafeInteger(value.playerNo) &&
    Number(value.playerNo) >= 1 && Number(value.playerNo) <= 16 && webSocketURL(value.socketUrl) && jsonRecord(value.profile);
}

function isBlobResource(resource: RuntimeResourceV1): resource is RuntimeBlobResourceV1 {
  return resource.kind === "ROM_BLOB" || resource.kind === "SEEKABLE_BLOB" ||
    resource.kind === "PARENT_ARCHIVE" || resource.kind === "WASM4_CART";
}

function validDigest(value: unknown): value is string {return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);}
function positiveInteger(value: unknown): value is number {return typeof value === "number" && Number.isSafeInteger(value) && value > 0;}
function validOrigin(value: unknown): value is string {
  if (typeof value !== "string") {return false;}
  try {const parsed = new URL(value); return ["http:", "https:"].includes(parsed.protocol) && parsed.origin === value;}
  catch {return false;}
}
function sameOrigin(value: unknown, origin: string) {
  if (typeof value !== "string") {return false;}
  try {const parsed = new URL(value); return ["http:", "https:"].includes(parsed.protocol) && parsed.origin === origin && !parsed.hash;}
  catch {return false;}
}
function relativeURL(value: unknown): value is string {
  return typeof value === "string" && value.length <= 2048 && value.startsWith("/") &&
    !value.startsWith("//") && !value.includes("\\") && !value.includes("#") &&
    [...value].every((character) => character >= " " && character <= "~");
}
function webSocketURL(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) {return false;}
  try {const parsed = new URL(value); return ["ws:", "wss:"].includes(parsed.protocol) && !parsed.hash;}
  catch {return false;}
}
function safePath(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 240 && !value.startsWith("/") &&
    !value.includes("\\") && !value.includes("?") && !value.includes("#") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
function jsonRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length <= 64 && Object.keys(value).every(wellFormed) && jsonValue(value, 0);
}
function jsonValue(value: unknown, depth: number): boolean {
  if (depth > 8) {return false;}
  if (value === null || typeof value === "boolean") {return true;}
  if (typeof value === "string") {return wellFormed(value);}
  if (typeof value === "number") {return Number.isSafeInteger(value);}
  if (Array.isArray(value)) {return value.length <= 256 && value.every((entry) => jsonValue(entry, depth + 1));}
  return isRecord(value) && Object.keys(value).length <= 64 && Object.keys(value).every(wellFormed) &&
    Object.values(value).every((entry) => jsonValue(entry, depth + 1));
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}
function validIdentity(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(value);
}
function validToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u.test(value);
}
function validSemver(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/u.test(value);
}
function boundedText(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && wellFormed(value) &&
    [...value].length >= minimum && [...value].length <= maximum;
}
function sortedUnique(value: unknown[]): value is string[] {
  return value.every((entry) => typeof entry === "string") && new Set(value).size === value.length &&
    value.every((entry, index) => index === 0 || String(value[index - 1]) < String(entry));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function wellFormed(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {return false;}
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {return false;}
  }
  return true;
}
function invalidRequest(): never {throw new Error("PROVIDER_LAUNCH_REQUEST_INVALID");}
