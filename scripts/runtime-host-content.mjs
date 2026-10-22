import {open} from "node:fs/promises";
import {constants} from "node:fs";
import {Readable} from "node:stream";

function validate(locator) {
  if (!locator || typeof locator.path !== "string" || !locator.path.startsWith("/") ||
    !Number.isSafeInteger(locator.offset) || locator.offset < 0 || !Number.isSafeInteger(locator.sizeBytes) || locator.sizeBytes < 0 ||
    !Number.isSafeInteger(locator.offset + locator.sizeBytes)) {throw new Error("RUNTIME_CONTENT_LOCATOR_REQUIRED");}
}

/** Open an independent descriptor. All positions and stat sizes belong to the logical file. */
export async function openContent(locator) {
  validate(locator);
  const handle = await open(locator.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || locator.offset > info.size || locator.sizeBytes > info.size - locator.offset) {throw new Error("RUNTIME_CONTENT_CHANGED");}
    return {
      stat: async () => ({size: locator.sizeBytes, isFile: () => true, isSymbolicLink: () => false}),
      read: async (buffer, offset, length, position) => {
        if (!Number.isSafeInteger(position) || position < 0 || position > locator.sizeBytes) {throw new Error("RUNTIME_CONTENT_RANGE_INVALID");}
        return handle.read(buffer, offset, Math.min(length, locator.sizeBytes - position), locator.offset + position);
      },
      close: () => handle.close(),
    };
  } catch (error) {await handle.close(); throw error;}
}

export async function readContent(locator) {
  if (locator?.sizeBytes > 32 * 1024 * 1024) {throw new Error("RUNTIME_EVIDENCE_TOO_LARGE");}
  const chunks = [];
  for await (const chunk of contentStream(locator)) {chunks.push(chunk);}
  return Buffer.concat(chunks);
}

export function contentStream(locator, {start = 0, length = locator?.sizeBytes - start, signal} = {}) {
  validate(locator);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start > locator.sizeBytes || length > locator.sizeBytes - start) {
    throw new Error("RUNTIME_CONTENT_RANGE_INVALID");
  }
  return Readable.from((async function* () {
    const handle = await openContent(locator);
    try {
      for (let position = start; position < start + length;) {
        signal?.throwIfAborted();
        const buffer = Buffer.alloc(Math.min(65536, start + length - position));
        const {bytesRead} = await handle.read(buffer, 0, buffer.length, position);
        if (!bytesRead) {throw new Error("RUNTIME_CONTENT_CHANGED");}
        position += bytesRead; yield buffer.subarray(0, bytesRead);
      }
    } finally {await handle.close();}
  })());
}
