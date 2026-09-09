import type {AdapterDeclaration} from "./declarations.js";
import {checkpointError, checkpointSize, transformCheckpoint} from "./checkpoint-compression.js";
import {decodeLegacyMkxpCheckpoint} from "./legacy-mkxp-checkpoint.js";

const suffix = "-storage-v1";
export function nativeCheckpointFormat(format: string) {
  return format.endsWith(suffix) ? format.slice(0, -suffix.length) : format;
}
export function storageAdapters(adapters: readonly AdapterDeclaration[]) {
  return adapters.map(adapter => {
    const contract = adapter.checkpoint;
    if (!contract) {return adapter;}
    const writeFormat = contract.writeFormat + suffix;
    return {...adapter, checkpoint: {...contract, writeFormat, readFormats: [...contract.readFormats, writeFormat]}};
  });
}

/** All new storage-v1 payloads contain exactly one gzip member around native bytes. */
export async function encodeStoredCheckpoint(bytes: Uint8Array, format: string, maximum: number, signal?: AbortSignal) {
  checkpointSize(bytes, maximum); signal?.throwIfAborted();
  if (!format.endsWith(suffix)) {throw checkpointError();}
  return transformCheckpoint(bytes, false, maximum, signal);
}

export async function decodeStoredCheckpoint(bytes: Uint8Array, format: string, maximum: number, signal?: AbortSignal) {
  checkpointSize(bytes, maximum); signal?.throwIfAborted();
  if (format.endsWith(suffix) || format === "emulatorjs-state-gzip-v1") {return transformCheckpoint(bytes, true, maximum, signal);}
  if (format === "mkxp-state-compact-v1") {return decodeLegacyMkxpCheckpoint(bytes, maximum, signal);}
  return bytes;
}
