import {adler32, resourceBytes} from "./bytes.mjs";
import {resolveFilteredSeed} from "./resource-format.mjs";

/** A whole native archive may use adlr only as a filter seed. Do not infer this
 * from a failed record: every protected record must disagree with its checksum
 * and independently validate its complete decoded representation. The filter
 * must already be authenticated by checksummed resources outside this archive.
 */
export async function seedMetadataArchive(archive, filter, signal) {
  const entries = archive.entries;
  if (!filter.verified || filter.stages || entries.length < 3 || new Set(entries.map(entry => entry.h)).size < 3 ||
      entries.some(entry => entry.flags !== 0x80000000 || entry.size !== entry.readable || entry.infoSizeCorrection || entry.size > 32 * 1024 * 1024)) {
    return archive;
  }
  for (const entry of entries) {
    signal?.throwIfAborted();
    const chunks = [];
    for await (const bytes of resourceBytes(archive.locator, entry, signal)) {chunks.push(bytes);}
    const raw = Buffer.concat(chunks), decoded = filter.apply(Buffer.from(raw), entry.h, 0);
    // A single genuine checksum makes this a checksummed archive. Corruption
    // elsewhere must fail conversion instead of becoming a metadata exception.
    if (adler32(decoded) === entry.adler) {return archive;}
    try {resolveFilteredSeed(raw, filter, entry.h);}
    catch (error) {
      if (error.message === "RUNTIME_KIRIKIRI_CHECKSUM_MISMATCH") {return archive;}
      throw error;
    }
  }
  return {...archive, filterSeedOnly: true};
}
