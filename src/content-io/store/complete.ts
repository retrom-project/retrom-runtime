import type {MaterializationReceiptV1} from "../../../contracts/content-io/v1/content-io.js";
import {abortable, checkSignal, requestScope} from "../abort.js";
import {createContentHasher} from "../bounded-stream.js";
import {BufferCredits} from "../credits.js";
import {fail} from "../errors.js";
import {BLOCK_BYTES} from "../source.js";
import {PersistentBacking} from "./backing.js";
import {requireGeneration} from "./metadata.js";
export async function completeBacking(backing: PersistentBacking, receipt: MaterializationReceiptV1, credits: BufferCredits, signal: AbortSignal): Promise<boolean> {
  const {metadata, locks} = backing.resources;
  const before = requireGeneration(await metadata.generation(backing.key, backing.generation));
  if (before.state === "COMPLETE") {return before.localSha256 === receipt.localSha256;}
  const hash = createContentHasher();
  try {
    for (let position = 0; position < receipt.sizeBytes; position += BLOCK_BYTES) {
      const release = await credits.reserve(2 * BLOCK_BYTES, "SCRATCH", signal);
      let scope: ReturnType<typeof requestScope> | undefined;
      try {
        scope = requestScope(signal, 500);
        const bytes = await abortable(backing.read(position / BLOCK_BYTES, scope.signal, true), scope.signal);
        if (!bytes) {return false;} hash.update(bytes);
      } finally {release(); scope?.dispose();}
    }
    checkSignal(signal);
    if (hash.digest() !== receipt.localSha256) {fail("CHECKSUM_MISMATCH");}
    return await locks.data(backing.key, signal, async () => {
      const current = requireGeneration(await metadata.generation(backing.key, backing.generation));
      if (current.revision !== before.revision) {return false;}
      await metadata.update(backing.key, backing.generation, current.revision, (record) => {
        record.state = "COMPLETE"; record.localSha256 = receipt.localSha256; record.completionAssurance = receipt.assurance; record.committedBytes = receipt.sizeBytes;
      }); return true;
    });
  } finally {hash.destroy();}
}
