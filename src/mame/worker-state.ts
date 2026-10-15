import {unzipSync, zipSync} from "fflate";
import {checkpointLimit} from "./state.js";
export type MameWorkerState = {native: Uint8Array; files: {path: string; bytes: Uint8Array}[]};
const limit = checkpointLimit - 108;
function validPath(path: string) {
  return path.length <= 255 && /^(?:diff|nvram)\//u.test(path) && !path.includes("\\") && [...path].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) &&
    path.split("/").every(part => part && part !== "." && part !== "..");
}
export function encodeWorkerState(state: MameWorkerState): Uint8Array {
  const entries: Record<string, Uint8Array> = {"native.bin": state.native};
  let size = state.native.length + 256;
  if (!state.native.length || state.files.length > 128) {invalid();}
  for (const file of state.files) {
    size += file.bytes.length + file.path.length * 2 + 128;
    if (!validPath(file.path) || entries[file.path] || size > limit) {invalid();}
    entries[file.path] = file.bytes;
  }
  if (size > limit) {invalid();}
  // Structural container only; the public checkpoint boundary compresses once.
  const bytes = zipSync(entries, {level: 0, mtime: new Date(1980, 0, 1)});
  if (bytes.length > limit) {invalid();} return bytes;
}
export function decodeWorkerState(bytes: Uint8Array): MameWorkerState {
  if (!bytes.length || bytes.length > limit) {invalid();}
  const seen = new Set<string>(); let total = 0, entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {filter: file => {
      total += file.originalSize;
      if (seen.size >= 129 || seen.has(file.name) || file.compression !== 0 || total > limit ||
        file.name !== "native.bin" && !validPath(file.name)) {invalid();}
      seen.add(file.name); return true;
    }});
  } catch {invalid();}
  if (!entries["native.bin"]?.length) {invalid();}
  return {native: entries["native.bin"], files: Object.entries(entries).filter(([path]) => path !== "native.bin")
    .map(([path, bytes]) => ({path, bytes}))};
}
function invalid(): never {throw new Error("MAME_CHECKPOINT_INVALID");}
