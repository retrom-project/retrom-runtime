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

export type ImplementationInput = {kind: "ASSET" | "ADAPTER" | "CHECKPOINT" | "LIFECYCLE"; path: string; sha256: string};

/** Release names, archive hashes, UI strings and build timestamps do not enter this identity. */
export function implementationFingerprint(targetId: string, implementation: Readonly<Record<string, unknown>>,
  inputs: readonly ImplementationInput[]): string {
  if (!targetId || inputs.length === 0 || inputs.some(input => !logicalPath(input.path) || !digest(input.sha256))) {
    configurationFailure("RUNTIME_IMPLEMENTATION_INVALID");
  }
  const sorted = [...inputs].sort((a, b) => utf8Compare(a.kind, b.kind) || utf8Compare(a.path, b.path));
  if (new Set(sorted.map(input => `${input.kind}:${input.path}`)).size !== sorted.length) {configurationFailure("RUNTIME_IMPLEMENTATION_INVALID");}
  return hashBytes(canonicalJsonBytes({targetId, implementation, inputs: sorted.map(({kind, path, sha256}) => [kind, path, sha256])}));
}

export type Restorability = {restorable: true; reason: null} | {restorable: false;
  reason: "GAME_UNAVAILABLE" | "SAVE_UNAVAILABLE" | "CORE_UNAVAILABLE" | "CORE_CHANGED" | "CONTENT_CHANGED" | "FORMAT_UNREADABLE"};
export function restorability(input: {gameAvailable: boolean; saveAvailable: boolean; current: RuntimeIdentity | null;
  context: SaveContext; readFormats: readonly string[]}): Restorability {
  if (!input.gameAvailable) {return {restorable: false, reason: "GAME_UNAVAILABLE"};}
  if (!input.saveAvailable) {return {restorable: false, reason: "SAVE_UNAVAILABLE"};}
  const current = input.current, saved = input.context;
  if (!current || current.coreId !== saved.coreId || current.providerId !== saved.providerId || current.targetId !== saved.targetId) {
    return {restorable: false, reason: "CORE_UNAVAILABLE"};
  }
  if (current.coreFingerprint !== saved.coreFingerprint) {return {restorable: false, reason: "CORE_CHANGED"};}
  if (current.romHash !== saved.romHash) {return {restorable: false, reason: "CONTENT_CHANGED"};}
  if (!input.readFormats.includes(saved.checkpointFormat)) {return {restorable: false, reason: "FORMAT_UNREADABLE"};}
  return {restorable: true, reason: null};
}
