import {sha256} from "@noble/hashes/sha2.js";
export const saveFormat = "shiina-game-save-v1";
export const maximumSaveBytes = 64 * 1024 * 1024;
export type SaveFiles = Record<string, Uint8Array>;
const magic = new TextEncoder().encode("RTSHNSV1");
const encoder = new TextEncoder();
const invalid = () => new Error("SHIINA_SAVE_INVALID");
const digest = (bytes: Uint8Array) => [...sha256(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
function validName(name: string) {
  return name.length > 0 && name.length <= 255 && name.normalize("NFC") === name &&
    !/[\\/:]/u.test(name) && !Array.from(name).some(c => c.charCodeAt(0) < 32) && name !== "." && name !== "..";
}
// Verified native manual slots for Sorcery Jokers. The global file and slot 103 written at
// startup are settings/continuation data; neither proves an in-game progress save exists.
export function hasProgress(files: SaveFiles) {
  return Object.entries(files).some(([name, bytes]) => /^sjs_save_0\d{2}\.bin$/iu.test(name) && bytes.byteLength > 0);
}
function entries(files: SaveFiles) {
  const list = Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1), names = new Set<string>();
  if (!list.length || list.length > 256 || !hasProgress(files)) {throw invalid();}
  for (const [name, bytes] of list) {
    if (!validName(name) || !(bytes instanceof Uint8Array) || names.has(name.toLowerCase())) {throw invalid();}
    names.add(name.toLowerCase());
  }
  return list;
}
export function encodeSave(identity: string, files: SaveFiles): Uint8Array {
  if (!/^[a-f0-9]{64}$/u.test(identity)) {throw invalid();}
  const list = entries(files);
  let offset = 0;
  const manifest = list.map(([path, bytes]) => {
    const record = {path, offset, size: bytes.length, sha256: digest(bytes)}; offset += bytes.length;
    if (offset > maximumSaveBytes) {throw invalid();} return record;
  });
  const header = encoder.encode(JSON.stringify({schemaVersion: 1, identity, entries: manifest}));
  const total = magic.length + 4 + header.length + offset;
  if (header.length > 256 * 1024 || total > maximumSaveBytes) {throw invalid();}
  const output = new Uint8Array(total); output.set(magic);
  new DataView(output.buffer).setUint32(magic.length, header.length);
  output.set(header, magic.length + 4);
  let at = magic.length + 4 + header.length;
  for (const [, bytes] of list) {output.set(bytes, at); at += bytes.length;}
  return output;
}
export function decodeSave(bytes: Uint8Array, identity: string): SaveFiles {
  try {
    const {value, payload} = readManifest(bytes);
    if (!exact(value, ["schemaVersion", "identity", "entries"]) || value.schemaVersion !== 1 || value.identity !== identity ||
      !Array.isArray(value.entries) || !value.entries.length || value.entries.length > 256) {throw invalid();}
    const files: SaveFiles = Object.create(null) as SaveFiles;
    let offset = 0, previous = "";
    for (const record of value.entries) {
      if (!validRecord(record, offset, previous, payload.length)) {throw invalid();}
      const data = payload.slice(offset, offset + record.size);
      if (digest(data) !== record.sha256) {throw invalid();}
      files[record.path] = data; previous = record.path; offset += record.size;
    }
    if (offset !== payload.length) {throw invalid();} entries(files); return files;
  } catch {throw invalid();}
}
function readManifest(bytes: Uint8Array): {value: unknown; payload: Uint8Array} {
  if (bytes.length < magic.length + 4 || bytes.length > maximumSaveBytes || !magic.every((b, i) => bytes[i] === b)) {throw invalid();}
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(magic.length);
  const start = magic.length + 4, end = start + length;
  if (!length || length > 256 * 1024 || end > bytes.length) {throw invalid();}
  return {value: JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes.subarray(start, end))) as unknown, payload: bytes.subarray(end)};
}
function validRecord(record: unknown, offset: number, previous: string, length: number): record is {path: string; offset: number; size: number; sha256: string} {
  return exact(record, ["path", "offset", "size", "sha256"]) && typeof record.path === "string" && validName(record.path) &&
    record.path > previous && record.offset === offset && typeof record.size === "number" && Number.isSafeInteger(record.size) &&
    record.size >= 0 && record.size <= length - offset && typeof record.sha256 === "string";
}
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === keys.sort().join(",");
}
