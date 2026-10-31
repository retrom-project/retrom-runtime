import {createHash} from "node:crypto";
import {mkdir, open, rm} from "node:fs/promises";
import {dirname, join} from "node:path";
import {contentStream} from "../runtime-host-content.mjs";
import {safePath} from "../runtime-archive-input.mjs";

export async function verifyNormalizationSource(locator, expected, signal) {
  const hash = createHash("sha256");
  for await (const bytes of contentStream(locator, {signal})) {hash.update(bytes);}
  if (hash.digest("hex") !== expected) {throw new Error("RUNTIME_CONTENT_CHANGED");}
}

/** Write only a declared output in this request's private phase directory. */
export async function normalizationDestination(input, logicalKey, source) {
  if (!safePath(logicalKey)) {throw new Error("RUNTIME_NORMALIZATION_OUTPUT_INVALID");}
  const path = join(input.outputRoot, logicalKey); await mkdir(dirname(path), {recursive: true});
  const handle = await open(path, "wx", 0o600), hash = createHash("sha256"); let length = 0;
  try {
    for await (const bytes of source) {
      input.signal?.throwIfAborted(); hash.update(bytes); length += bytes.length; let written = 0;
      if (length > 8 * 1024 ** 3) {throw new Error("RUNTIME_NORMALIZATION_OUTPUT_INVALID");}
      while (written < bytes.length) {
        const result = await handle.write(bytes, written, bytes.length - written);
        if (!result.bytesWritten) {throw new Error("RUNTIME_NORMALIZATION_OUTPUT_INVALID");} written += result.bytesWritten;
      }
    }
    await handle.sync();
  } catch (error) {await handle.close(); await rm(path, {force: true}); throw error;}
  await handle.close();
  return {logicalKey, name: logicalKey, path, sizeBytes: length, sha256: hash.digest("hex")};
}
