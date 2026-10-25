export const kirikiriCheckpointMagic = "RTKRKGS1";
export const kirikiriGameSaveFormat = "kirikiri-game-save-v2";

export type KirikiriCheckpointEntry = { path: string; data: Uint8Array | null };
export type KirikiriCheckpointBundle = { progressPaths: string[]; entries: KirikiriCheckpointEntry[] };

type ManifestEntry = { offset: number; path: string; sha256: string | null; sizeBytes: number };
type Manifest = { entries: ManifestEntry[]; progressPaths: string[]; schemaVersion: 1 };

export const maximumKirikiriCheckpointBytes = 64 * 1024 * 1024;
export const maximumKirikiriCheckpointEntries = 512;
const maximumBundleBytes = maximumKirikiriCheckpointBytes;
const maximumManifestBytes = 256 * 1024;
const maximumEntries = maximumKirikiriCheckpointEntries;

export async function encodeKirikiriCheckpoint(bundle: KirikiriCheckpointBundle) {
  if (!bundle || !Array.isArray(bundle.progressPaths)) {throw new Error("KIRIKIRI_CHECKPOINT_INVALID");}
  requireEntries(bundle.entries);
  const entries = bundle.entries.map((entry) => ({ path: entry.path, data: entry.data?.slice() ?? null }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const manifestEntries: ManifestEntry[] = [];
  let offset = 0;
  let previous = "";
  for (const entry of entries) {
    if (!validPath(entry.path) || entry.path <= previous) {throw new Error("KIRIKIRI_CHECKPOINT_INVALID");}
    const sizeBytes = entry.data?.byteLength ?? 0;
    manifestEntries.push({ offset, path: entry.path, sha256: entry.data === null ? null : await digestKirikiriCheckpoint(entry.data), sizeBytes });
    offset += sizeBytes;
    previous = entry.path;
  }
  const progressPaths = bundle.progressPaths.slice().sort();
  if (!validProgress(progressPaths, manifestEntries)) {throw new Error("KIRIKIRI_CHECKPOINT_INVALID");}
  const manifest: Manifest = { entries: manifestEntries, progressPaths, schemaVersion: 1 };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const total = kirikiriCheckpointMagic.length + 4 + manifestBytes.byteLength + offset;
  if (!manifestBytes.byteLength || manifestBytes.byteLength > maximumManifestBytes || total > maximumBundleBytes) {
    throw new Error("KIRIKIRI_CHECKPOINT_INVALID");
  }
  const encoded = new Uint8Array(total);
  encoded.set(new TextEncoder().encode(kirikiriCheckpointMagic));
  new DataView(encoded.buffer).setUint32(kirikiriCheckpointMagic.length, manifestBytes.byteLength);
  encoded.set(manifestBytes, kirikiriCheckpointMagic.length + 4);
  let payloadOffset = kirikiriCheckpointMagic.length + 4 + manifestBytes.byteLength;
  for (const entry of entries) {
    if (entry.data !== null) {encoded.set(entry.data, payloadOffset); payloadOffset += entry.data.byteLength;}
  }
  return encoded;
}

function requireEntries(entries: KirikiriCheckpointEntry[]) {
  if (!Array.isArray(entries) || !entries.length || entries.length > maximumEntries) {
    throw new Error("KIRIKIRI_CHECKPOINT_INVALID");
  }
  let bytes = 0;
  for (const entry of entries) {
    if (!entry || !validPath(entry.path) || entry.data !== null &&
      (!ArrayBuffer.isView(entry.data) || Object.prototype.toString.call(entry.data) !== "[object Uint8Array]")) {
      throw new Error("KIRIKIRI_CHECKPOINT_INVALID");
    }
    bytes += entry.data?.byteLength ?? 0;
    if (bytes > maximumBundleBytes) {throw new Error("KIRIKIRI_CHECKPOINT_INVALID");}
  }
}

export async function decodeKirikiriCheckpoint(bytes: Uint8Array): Promise<KirikiriCheckpointBundle> {
  const { manifest, payload } = parseManifest(bytes);
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries) ||
    !manifest.entries.length || manifest.entries.length > maximumEntries) {
    throw new Error("KIRIKIRI_CHECKPOINT_INVALID");
  }
  const entries: KirikiriCheckpointEntry[] = [];
  let offset = 0;
  let previous = "";
  for (const entry of manifest.entries) {
    if (!validManifestEntry(entry, offset, previous, payload.byteLength)) {
      throw new Error("KIRIKIRI_CHECKPOINT_INVALID");
    }
    const data = entry.sha256 === null ? null : payload.slice(offset, offset + entry.sizeBytes);
    if (data !== null && await digestKirikiriCheckpoint(data) !== entry.sha256) {throw new Error("KIRIKIRI_CHECKPOINT_INVALID");}
    entries.push({ path: entry.path, data });
    offset += entry.sizeBytes;
    previous = entry.path;
  }
  if (offset !== payload.byteLength || !validProgress(manifest.progressPaths, manifest.entries)) {
    throw new Error("KIRIKIRI_CHECKPOINT_INVALID");
  }
  return { entries, progressPaths: manifest.progressPaths };
}

function parseManifest(bytes: Uint8Array): { manifest: Manifest; payload: Uint8Array } {
  if (bytes.byteLength < kirikiriCheckpointMagic.length + 4 || bytes.byteLength > maximumBundleBytes ||
    new TextDecoder().decode(bytes.subarray(0, kirikiriCheckpointMagic.length)) !== kirikiriCheckpointMagic) {
    throw new Error("KIRIKIRI_CHECKPOINT_INVALID");
  }
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(kirikiriCheckpointMagic.length);
  const start = kirikiriCheckpointMagic.length + 4;
  const end = start + size;
  if (!size || size > maximumManifestBytes || end > bytes.byteLength) {throw new Error("KIRIKIRI_CHECKPOINT_INVALID");}
  try {
    const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, end))) as Manifest;
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
      Object.keys(manifest).sort().join() !== "entries,progressPaths,schemaVersion") {throw new Error("Invalid manifest");}
    return { manifest, payload: bytes.subarray(end) };
  } catch {throw new Error("KIRIKIRI_CHECKPOINT_INVALID");}
}

function validManifestEntry(entry: ManifestEntry, offset: number, previous: string, payloadBytes: number) {
  return entry && validPath(entry.path) && entry.path > previous && entry.offset === offset &&
    Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes >= 0 && entry.sizeBytes <= payloadBytes - offset &&
    (entry.sha256 === null ? entry.sizeBytes === 0 : /^[0-9a-f]{64}$/u.test(entry.sha256));
}

function validProgress(paths: unknown, entries: ManifestEntry[]): paths is string[] {
  if (!Array.isArray(paths) || !paths.length || paths.length > maximumEntries) {return false;}
  const files = new Map(entries.map(entry => [entry.path, entry]));
  let previous = "";
  return paths.every(path => {
    if (!validPath(path) || path <= previous || !files.has(path)) {return false;}
    previous = path;
    const entry = files.get(path)!;
    // A tombstone can preserve a player's explicit deletion of a native slot.
    return entry.sha256 === null || entry.sizeBytes > 0;
  });
}

export function validKirikiriCheckpointPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && new TextEncoder().encode(path).byteLength <= 1024 &&
    !path.startsWith("/") && !path.includes("\\") && !path.includes("//") &&
    ![...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

const validPath = validKirikiriCheckpointPath;

export async function digestKirikiriCheckpoint(bytes: Uint8Array) {
  const value = await crypto.subtle.digest("SHA-256", bytes.slice());
  return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join("");
}
