/** Stable binary envelope magic shared by native-save adapters. */
export const rpgCheckpointMagic = "RTRPGSV1";

export type RpgCheckpointEngine = "RPG2000" | "RPG2003" | "RPGXP" | "RPGVX" | "RPGVXAce" | "RPGMV" | "RPGMZ";
export type RpgCheckpointStore = "FILESYSTEM" | "LOCAL_STORAGE" | "LOCALFORAGE";

export type RpgCheckpointEntry = {
  store: RpgCheckpointStore;
  key: string;
  mediaType: "application/octet-stream";
  data: Uint8Array;
};

export type RpgCheckpointBundle = {
  engine: RpgCheckpointEngine;
  entries: RpgCheckpointEntry[];
};

type ManifestEntry = Omit<RpgCheckpointEntry, "data"> & {
  offset: number;
  sizeBytes: number;
  sha256: string;
};

type Manifest = {
  schemaVersion: 1;
  engine: RpgCheckpointEngine;
  entries: ManifestEntry[];
};

const maximumBundleBytes = 64 * 1024 * 1024;
const maximumManifestBytes = 256 * 1024;

function hex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function digest(bytes: Uint8Array) {
  const value = await crypto.subtle.digest("SHA-256", bytes.slice());
  return hex(new Uint8Array(value));
}

function validEngine(value: unknown): value is RpgCheckpointEngine {
  return ["RPG2000", "RPG2003", "RPGXP", "RPGVX", "RPGVXAce", "RPGMV", "RPGMZ"].includes(String(value));
}

function validStore(value: unknown): value is RpgCheckpointStore {
  return value === "FILESYSTEM" || value === "LOCAL_STORAGE" || value === "LOCALFORAGE";
}

function validKey(store: RpgCheckpointStore, key: string) {
  if (!key || new TextEncoder().encode(key).byteLength > 1024 || key.includes("\0") || key.normalize("NFC") !== key) {return false;}
  if (store !== "FILESYSTEM") {return true;}
  return !key.startsWith("/") && !key.includes("\\") && !key.includes("//") &&
    key.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function assertHeader(bundle: RpgCheckpointBundle) {
  if (!validEngine(bundle.engine) || !Array.isArray(bundle.entries) || !bundle.entries.length || bundle.entries.length > 512) {
    throw new Error("RPG_CHECKPOINT_INVALID");
  }
}

export async function encodeRpgCheckpoint(bundle: RpgCheckpointBundle) {
  assertHeader(bundle);
  const ordered = bundle.entries.map((entry) => ({ ...entry, data: new Uint8Array(entry.data) }))
    .sort(rpgSaveEntryOrder);
  const manifestEntries: ManifestEntry[] = [];
  let offset = 0;
  let previous = "";
  for (const entry of ordered) {
    const identity = `${entry.store}\0${entry.key}`;
    if (!validStore(entry.store) || !validKey(entry.store, entry.key) ||
      entry.mediaType !== "application/octet-stream" || identity <= previous) {
      throw new Error("RPG_CHECKPOINT_INVALID");
    }
    manifestEntries.push({
      store: entry.store,
      key: entry.key,
      mediaType: entry.mediaType,
      offset,
      sizeBytes: entry.data.byteLength,
      sha256: await digest(entry.data),
    });
    offset += entry.data.byteLength;
    previous = identity;
  }
  const manifest: Manifest = {
    engine: bundle.engine,
    entries: manifestEntries.map((entry) => ({
      key: entry.key,
      mediaType: entry.mediaType,
      offset: entry.offset,
      sha256: entry.sha256,
      sizeBytes: entry.sizeBytes,
      store: entry.store,
    })),
    schemaVersion: 1,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const total = rpgCheckpointMagic.length + 4 + manifestBytes.byteLength + offset;
  if (!manifestBytes.byteLength || manifestBytes.byteLength > maximumManifestBytes || total > maximumBundleBytes) {
    throw new Error("RPG_CHECKPOINT_INVALID");
  }
  const result = new Uint8Array(total);
  result.set(new TextEncoder().encode(rpgCheckpointMagic));
  new DataView(result.buffer).setUint32(rpgCheckpointMagic.length, manifestBytes.byteLength);
  result.set(manifestBytes, rpgCheckpointMagic.length + 4);
  let payloadOffset = rpgCheckpointMagic.length + 4 + manifestBytes.byteLength;
  for (const entry of ordered) {
    result.set(entry.data, payloadOffset);
    payloadOffset += entry.data.byteLength;
  }
  return result;
}

function parseManifest(bytes: Uint8Array): { manifest: Manifest; payload: Uint8Array } {
  if (bytes.byteLength < rpgCheckpointMagic.length + 4 || bytes.byteLength > maximumBundleBytes ||
    new TextDecoder().decode(bytes.subarray(0, rpgCheckpointMagic.length)) !== rpgCheckpointMagic) {
    throw new Error("RPG_CHECKPOINT_INVALID");
  }
  const manifestSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(rpgCheckpointMagic.length);
  const start = rpgCheckpointMagic.length + 4;
  const end = start + manifestSize;
  if (!manifestSize || manifestSize > maximumManifestBytes || end > bytes.byteLength) {throw new Error("RPG_CHECKPOINT_INVALID");}
  let parsed: unknown;
  try {parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, end)));}
  catch {throw new Error("RPG_CHECKPOINT_INVALID");}
  return { manifest: parsed as Manifest, payload: bytes.subarray(end) };
}

export async function decodeRpgCheckpoint(bytes: Uint8Array, expectedEngine: RpgCheckpointEngine) {
  const { manifest, payload } = parseManifest(bytes);
  if (!validManifestHeader(manifest, expectedEngine)) {
    throw new Error("RPG_CHECKPOINT_INVALID");
  }
  const entries = await decodeManifestEntries(manifest.entries, payload);
  return { engine: expectedEngine, entries } satisfies RpgCheckpointBundle;
}

function validManifestHeader(manifest: Manifest, expectedEngine: RpgCheckpointEngine) {
  return manifest && manifest.schemaVersion === 1 && manifest.engine === expectedEngine &&
    Array.isArray(manifest.entries) && manifest.entries.length > 0 && manifest.entries.length <= 512;
}

async function decodeManifestEntries(manifestEntries: ManifestEntry[], payload: Uint8Array) {
  const entries: RpgCheckpointEntry[] = [];
  let offset = 0;
  let previous = "";
  for (const entry of manifestEntries) {
    const identity = `${entry.store}\0${entry.key}`;
    if (!validDecodedEntry(entry, offset, previous, payload.byteLength)) {
      throw new Error("RPG_CHECKPOINT_INVALID");
    }
    const data = payload.slice(offset, offset + entry.sizeBytes);
    if (await digest(data) !== entry.sha256) {throw new Error("RPG_CHECKPOINT_INVALID");}
    entries.push({ store: entry.store, key: entry.key, mediaType: entry.mediaType, data });
    offset += entry.sizeBytes;
    previous = identity;
  }
  if (offset !== payload.byteLength) {throw new Error("RPG_CHECKPOINT_INVALID");}
  return entries;
}

function validDecodedEntry(entry: ManifestEntry, offset: number, previous: string, payloadBytes: number) {
  const identity = `${entry.store}\0${entry.key}`;
  return validStore(entry.store) && validKey(entry.store, entry.key) &&
    entry.mediaType === "application/octet-stream" && entry.offset === offset &&
    Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes >= 0 && /^[0-9a-f]{64}$/.test(entry.sha256) &&
    identity > previous && entry.sizeBytes <= payloadBytes - offset;
}

export function rpgSaveEntryOrder(left: Pick<RpgCheckpointEntry, "store" | "key">, right: Pick<RpgCheckpointEntry, "store" | "key">) {
  const a = `${left.store}\0${left.key}`, b = `${right.store}\0${right.key}`;
  return a < b ? -1 : a > b ? 1 : 0;
}
