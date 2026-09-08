export const scummvmSaveFormat = "scummvm-save-bundle-v1";
export const maximumSaveBytes = 64 * 1024 * 1024;
const magic = "RTSCUMV1";
const maximumManifest = 512 * 1024;
export type SaveFile = {path: string; data: Uint8Array};
export type ScummvmSave = {identity: string; resumeSlot: number | null; files: SaveFile[]};
type RecordEntry = {path: string; offset: number; size: number; sha256: string};
type Manifest = {schemaVersion: 1; identity: string; resumeSlot: number | null; files: RecordEntry[]};

export async function encodeScummvmSave(input: ScummvmSave): Promise<Uint8Array> {
  if (!validIdentity(input.identity) || !validSlot(input.resumeSlot) ||
    !Array.isArray(input.files) || !input.files.length || input.files.length > 1024) {throw invalid();}
  const files = input.files.map((file) => ({path: file.path, data: file.data.slice()}))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const records: RecordEntry[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const file of files) {
    if (!validName(file.path) || seen.has(file.path.toLowerCase()) ||
      file.data.byteLength > maximumSaveBytes - offset) {throw invalid();}
    seen.add(file.path.toLowerCase());
    records.push({path: file.path, offset, size: file.data.byteLength, sha256: await saveDigest(file.data)});
    offset += file.data.byteLength;
  }
  if (!offset) {throw invalid();}
  const manifest: Manifest = {schemaVersion: 1, identity: input.identity, resumeSlot: input.resumeSlot, files: records};
  const header = new TextEncoder().encode(JSON.stringify(manifest));
  const size = magic.length + 4 + header.byteLength + offset;
  if (header.byteLength > maximumManifest || size > maximumSaveBytes) {throw invalid();}
  const result = new Uint8Array(size);
  result.set(new TextEncoder().encode(magic));
  new DataView(result.buffer).setUint32(magic.length, header.byteLength);
  result.set(header, magic.length + 4);
  let position = magic.length + 4 + header.byteLength;
  for (const file of files) {result.set(file.data, position); position += file.data.byteLength;}
  return result;
}

export async function decodeScummvmSave(bytes: Uint8Array, identity: string): Promise<ScummvmSave> {
  const {manifest, body} = parse(bytes);
  if (!validIdentity(identity) || manifest.schemaVersion !== 1 || manifest.identity !== identity ||
    !validSlot(manifest.resumeSlot) || !Array.isArray(manifest.files) ||
    !manifest.files.length || manifest.files.length > 1024 || !body.byteLength) {throw invalid();}
  let offset = 0;
  let previous = "";
  const seen = new Set<string>();
  const files: SaveFile[] = [];
  for (const file of manifest.files) {
    if (!validRecord(file, offset, previous, body.byteLength) || seen.has(file.path.toLowerCase())) {throw invalid();}
    const data = body.slice(offset, offset + file.size);
    if (await saveDigest(data) !== file.sha256) {throw invalid();}
    files.push({path: file.path, data});
    offset += file.size; previous = file.path; seen.add(file.path.toLowerCase());
  }
  if (offset !== body.byteLength) {throw invalid();}
  return {identity, resumeSlot: manifest.resumeSlot, files};
}

function parse(bytes: Uint8Array): {manifest: Manifest; body: Uint8Array} {
  if (bytes.byteLength < magic.length + 4 || bytes.byteLength > maximumSaveBytes ||
    new TextDecoder().decode(bytes.subarray(0, magic.length)) !== magic) {throw invalid();}
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(magic.length);
  const start = magic.length + 4;
  if (!length || length > maximumManifest || length > bytes.byteLength - start) {throw invalid();}
  try {
    const manifest = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes.subarray(start, start + length))) as Manifest;
    if (!manifest || typeof manifest !== "object" ||
      Object.keys(manifest).sort().join(",") !== "files,identity,resumeSlot,schemaVersion") {throw invalid();}
    return {manifest, body: bytes.subarray(start + length)};
  } catch {throw invalid();}
}

function validRecord(file: RecordEntry, offset: number, previous: string, size: number) {
  return file && Object.keys(file).sort().join(",") === "offset,path,sha256,size" &&
    validName(file.path) && file.path > previous && file.offset === offset &&
    Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= size - offset && validIdentity(file.sha256);
}
function validName(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && value.length <= 240 &&
    value !== "." && value !== ".." && value.toLowerCase() !== "scummvm.ini" && !/[\\/]/u.test(value) &&
    [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
}
function validIdentity(value: unknown): value is string {return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);}
function validSlot(value: unknown): value is number | null {
  return value === null || Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 9999;
}
export async function saveDigest(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice()));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function invalid() {return new Error("SCUMMVM_SAVE_INVALID");}
