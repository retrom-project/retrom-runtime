import type {AdapterContentSession} from "../provider/content-inputs.js";
import type {ProjectIndexFile} from "../provider/project-index.js";
import {LazyContentReader} from "../provider/lazy-reader.js";
export function createGameFiles(files: ProjectIndexFile[], identity: string, session: AdapterContentSession, base: string, signal?: AbortSignal) {
  const readers = new Map(files.map(file => [file.path, new LazyContentReader(session, {
    identity: {kind: "INDEX_ENTRY", projectDigest: identity, logicalPath: file.path}, url: new URL(file.url, base).href,
    sizeBytes: file.sizeBytes, purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG",
    contentLengthPolicy: session.inputPolicy("game").contentLengthPolicy,
  }, session.inputPolicy("game"), signal)]));
  let closed = false;
  return {
    async read(path: string, offset: number, count: number, requestSignal?: AbortSignal) {
      if (closed) {throw new Error("SHIINA_CONTENT_CLOSED");}
      const reader = readers.get(path);
      if (!reader || !Number.isSafeInteger(offset) || !Number.isInteger(count) || offset < 0 || count < 1 || count > 65536 || offset + count > reader.sizeBytes) {
        throw new Error("SHIINA_RANGE_INVALID");
      }
      const bytes = new Uint8Array(count); const read = await reader.readInto(offset, bytes, requestSignal);
      if (read !== count) {throw new Error("SHIINA_RANGE_INVALID");} return bytes;
    },
    async close() {closed = true; await Promise.all([...readers.values()].map(reader => reader.close()));},
  };
}
