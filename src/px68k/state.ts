import {sha256} from "@noble/hashes/sha2.js";
import {unzipSync, zipSync} from "fflate";
export const checkpointFormat = "px68k-state-v1";
export const checkpointLimit = 96 * 1024 * 1024;
export type Snapshot = {state: Uint8Array; files: Record<string, Uint8Array>; frames: number};
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", {fatal: true});
function invalid(): never {throw new Error("PX68K_CHECKPOINT_INVALID");}
function fileName(name: string) {return /^disk[0-9]+\.(?:dim|xdf|hdf)$/u.test(name) || name === "sram.dat";}
function hash(bytes: Uint8Array) {return Array.from(sha256(bytes), (v) => v.toString(16).padStart(2, "0")).join("");}
export function encodeCheckpoint(identity: string, state: Uint8Array, files: Record<string, Uint8Array>, frames: number) {
  if (!/^[0-9a-f]{64}$/u.test(identity) || !state.length || state.length > 32 * 1024 * 1024 ||
    !Number.isSafeInteger(frames) || frames < 0 || Object.keys(files).some((name) => !fileName(name))) {invalid();}
  const entries = {"state.bin": state, ...files};
  if (Object.keys(files).length > 3 || Object.values(entries).reduce((sum, b) => sum + b.length, 0) > checkpointLimit) {invalid();}
  const metadata = {version: 1, identity, frames, hashes: Object.fromEntries(Object.entries(entries).map(([name, bytes]) => [name, hash(bytes)]))};
  const bytes = zipSync({...entries, "manifest.json": encoder.encode(JSON.stringify(metadata))}, {level: 6});
  if (bytes.length > checkpointLimit) {invalid();}
  return bytes;
}
export function decodeCheckpoint(identity: string, bytes: Uint8Array): Snapshot {
  if (!bytes.length || bytes.length > checkpointLimit) {invalid();}
  let total = 0;
  const seen = new Set<string>();
  const entries = unzipSync(bytes, {filter(entry) {
    total += entry.originalSize;
    if (seen.has(entry.name) || (!fileName(entry.name) && !["state.bin", "manifest.json"].includes(entry.name)) ||
      entry.originalSize < 1 || total > checkpointLimit + 4096) {invalid();}
    seen.add(entry.name); return true;
  }});
  if (!entries["manifest.json"] || entries["manifest.json"].length > 4096 || !entries["state.bin"] ||
    entries["state.bin"].length > 32 * 1024 * 1024) {invalid();}
  const metadata = parseMetadata(identity, entries["manifest.json"]);
  delete entries["manifest.json"];
  const hashes = metadata.hashes;
  if (Object.keys(hashes).length !== Object.keys(entries).length || Object.entries(entries).some(([name, data]) =>
    !(name in hashes) || Reflect.get(hashes, name) !== hash(data))) {invalid();}
  const state = entries["state.bin"]; delete entries["state.bin"];
  return {state, files: entries, frames: metadata.frames};
}

function parseMetadata(identity: string, bytes: Uint8Array) {
  const metadata: unknown = JSON.parse(decoder.decode(bytes));
  if (!metadata || typeof metadata !== "object" || !("version" in metadata) || metadata.version !== 1 ||
    !("identity" in metadata) || metadata.identity !== identity || !("frames" in metadata) ||
    typeof metadata.frames !== "number" || !Number.isSafeInteger(metadata.frames) || metadata.frames < 0 ||
    !("hashes" in metadata) || !metadata.hashes || typeof metadata.hashes !== "object") {invalid();}
  return {frames: metadata.frames, hashes: metadata.hashes};
}
