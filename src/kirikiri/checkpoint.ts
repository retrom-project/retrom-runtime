export const kirikiriCheckpointMagic = "RTKRKSV1";

export type KirikiriCheckpointEntry = { path: string; data: Uint8Array };
export type KirikiriCheckpointBundle = { resumeSlot: 1999; entries: KirikiriCheckpointEntry[] };

type ManifestEntry = { offset: number; path: string; sha256: string; sizeBytes: number };
type Manifest = { entries: ManifestEntry[]; resumeSlot: 1999; schemaVersion: 1 };

const maximumBundleBytes = 64 * 1024 * 1024;
const maximumManifestBytes = 256 * 1024;
const maximumEntries = 512;

export async function encodeKirikiriCheckpoint(bundle: KirikiriCheckpointBundle) {
  if (bundle.resumeSlot !== 1999 || !Array.isArray(bundle.entries) || !bundle.entries.length ||
    bundle.entries.length > maximumEntries) {throw new Error("KIRIKIRI_CHECKPOINT_INVALID");}
  const entries = bundle.entries.map((entry) => ({ path: entry.path, data: entry.data.slice() }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const manifestEntries: ManifestEntry[] = [];
  let offset = 0;
  let previous = "";
  for (const entry of entries) {
    if (!validPath(entry.path) || entry.path <= previous) {throw new Error("KIRIKIRI_CHECKPOINT_INVALID");}
    manifestEntries.push({ offset, path: entry.path, sha256: await digest(entry.data), sizeBytes: entry.data.byteLength });
    offset += entry.data.byteLength;
    previous = entry.path;
  }
  const manifest: Manifest = { entries: manifestEntries, resumeSlot: 1999, schemaVersion: 1 };
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
  for (const entry of entries) {encoded.set(entry.data, payloadOffset); payloadOffset += entry.data.byteLength;}
  return encoded;
}

export async function decodeKirikiriCheckpoint(bytes: Uint8Array): Promise<KirikiriCheckpointBundle> {
  const { manifest, payload } = parseManifest(bytes);
  if (manifest.schemaVersion !== 1 || manifest.resumeSlot !== 1999 || !Array.isArray(manifest.entries) ||
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
    const data = payload.slice(offset, offset + entry.sizeBytes);
    if (await digest(data) !== entry.sha256) {throw new Error("KIRIKIRI_CHECKPOINT_INVALID");}
    entries.push({ path: entry.path, data });
    offset += entry.sizeBytes;
    previous = entry.path;
  }
  if (offset !== payload.byteLength) {throw new Error("KIRIKIRI_CHECKPOINT_INVALID");}
  return { entries, resumeSlot: 1999 };
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
    return { manifest, payload: bytes.subarray(end) };
  } catch {throw new Error("KIRIKIRI_CHECKPOINT_INVALID");}
}

function validManifestEntry(entry: ManifestEntry, offset: number, previous: string, payloadBytes: number) {
  return entry && validPath(entry.path) && entry.path > previous && entry.offset === offset &&
    Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes >= 0 && entry.sizeBytes <= payloadBytes - offset &&
    /^[0-9a-f]{64}$/u.test(entry.sha256);
}

function validPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && new TextEncoder().encode(path).byteLength <= 1024 &&
    path.normalize("NFC") === path && !path.startsWith("/") && !path.includes("\\") && !path.includes("//") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

async function digest(bytes: Uint8Array) {
  const value = await crypto.subtle.digest("SHA-256", bytes.slice());
  return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join("");
}
