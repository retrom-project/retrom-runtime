import type {MaterializationReceiptV1} from "../../../contracts/content-io/v1/content-io.js";
import {abortable, checkSignal, requestScope} from "../abort.js";
import {createContentHasher} from "../bounded-stream.js";
import {BufferCredits} from "../credits.js";
import {fail} from "../errors.js";
import {BLOCK_BYTES, isDigest} from "../source.js";
import {PersistentBacking} from "./backing.js";
import {requireGeneration} from "./metadata.js";
/** Publication already verified these bytes. Reuse its receipt without scanning client storage. */
export async function completedBacking(backing: PersistentBacking, signal: AbortSignal): Promise<MaterializationReceiptV1 | null> {
  checkSignal(signal);
  const current = requireGeneration(await backing.resources.metadata.generation(backing.key, backing.generation));
  checkSignal(signal);
  if (current.state !== "COMPLETE") {return null;}
  const {source} = backing.object;
  const assurance = source.identity.kind === "FILE_SHA256" ? "EXPECTED_SHA256" : "TRUSTED_IMMUTABLE_INDEX";
  if (current.objectKey !== backing.key || current.generation !== backing.generation || current.committedBytes !== source.sizeBytes ||
    !isDigest(current.localSha256) || current.completionAssurance !== assurance ||
    source.identity.kind === "FILE_SHA256" && current.localSha256 !== source.identity.sha256) {fail("IDENTITY_CHANGED");}
  return {objectKey: backing.key, storageGeneration: backing.generation, sizeBytes: source.sizeBytes,
    localSha256: current.localSha256, assurance, pinnedEtag: current.pinnedEtag};
}
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
