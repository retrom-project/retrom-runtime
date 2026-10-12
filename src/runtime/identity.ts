import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {canonicalJsonBytes} from "../provider/contract.js";
import type {RuntimeContentFile, RuntimeIdentity, SaveContext} from "./types.js";
import {configurationFailure, digest, logicalPath, utf8Compare} from "./validation.js";

export function hashBytes(bytes: Uint8Array): string {return bytesToHex(sha256(bytes));}

export function contentHash(files: readonly RuntimeContentFile[], mode: "FILE" | "TREE"): string {
  if (files.length === 0 || files.length > 100_000) {configurationFailure("RUNTIME_CONTENT_INVALID");}
  const keys = new Set<string>();
  for (const file of files) {
    if (!logicalPath(file.logicalKey) || !logicalPath(file.name) || !digest(file.sha256) ||
      !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || keys.has(file.logicalKey)) {configurationFailure("RUNTIME_CONTENT_INVALID");}
    keys.add(file.logicalKey);
  }
  if (mode === "FILE") {
    if (files.length !== 1) {configurationFailure("RUNTIME_CONTENT_INVALID");}
    return files[0].sha256;
  }
  const entries = [...files].sort((a, b) => utf8Compare(a.logicalKey, b.logicalKey))
    .map(file => [file.logicalKey, file.sizeBytes, file.sha256]);
  return hashBytes(canonicalJsonBytes(entries));
}

export type Restorability = {restorable: true; reason: null; warning: "CORE_CHANGED" | null} | {restorable: false; warning: null;
  reason: "GAME_UNAVAILABLE" | "SAVE_UNAVAILABLE" | "CORE_UNAVAILABLE" | "CONTENT_CHANGED" | "FORMAT_UNREADABLE"};
export function restorability(input: {gameAvailable: boolean; saveAvailable: boolean; current: RuntimeIdentity | null;
  context: SaveContext; readFormats: readonly string[]}): Restorability {
  if (!input.gameAvailable) {return {restorable: false, reason: "GAME_UNAVAILABLE", warning: null};}
  if (!input.saveAvailable) {return {restorable: false, reason: "SAVE_UNAVAILABLE", warning: null};}
  const current = input.current, saved = input.context;
  if (!current || current.coreId !== saved.coreId || current.providerId !== saved.providerId || current.targetId !== saved.targetId) {
    return {restorable: false, reason: "CORE_UNAVAILABLE", warning: null};
  }
  if (current.romHash !== saved.romHash) {return {restorable: false, reason: "CONTENT_CHANGED", warning: null};}
  if (!input.readFormats.includes(saved.checkpointFormat)) {return {restorable: false, reason: "FORMAT_UNREADABLE", warning: null};}
  return {restorable: true, reason: null, warning: current.coreFingerprint !== saved.coreFingerprint ? "CORE_CHANGED" : null};
}
