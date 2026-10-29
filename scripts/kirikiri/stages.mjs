import {createHash} from "node:crypto";
import {adler32, resourceBytes, requireFormat} from "./bytes.mjs";

function state(filter) {
  requireFormat(Array.isArray(filter.stages) && filter.stages.length > 0 && filter.stages.length <= 2, "FILTER_AMBIGUOUS");
  return filter.stages.map(stage => ({...stage, checksum: 1, hash: createHash("sha256")}));
}
function update(stages, raw, h, offset) {
  for (const stage of stages) {
    const bytes = Buffer.from(raw); stage.apply(bytes, h, offset);
    stage.checksum = adler32(bytes, stage.checksum); stage.hash.update(bytes);
  }
}
function select(stages, expected) {
  const matched = stages.map(stage => ({...stage, sha256: stage.hash.digest("hex")})).filter(stage => stage.checksum === expected);
  requireFormat(new Set(matched.map(stage => stage.sha256)).size <= 1, "FILTER_AMBIGUOUS");
  return matched[0] ?? null;
}
/** A profile probe authenticates complete bytes, including its actual native stages. */
export function probeStage(filter, bytes, seed, checksum) {
  const stages = state(filter); update(stages, bytes, seed, 0);
  return select(stages, checksum);
}
/** First pass selects one source-checksummed representation with bounded memory.
 * The converter then writes it and compares both complete hashes to this pass.
 */
export async function selectResourceStage(locator, entry, filter, signal) {
  const stages = state(filter), rawHash = createHash("sha256"); let size = 0;
  for await (const bytes of resourceBytes(locator, entry, signal)) {
    rawHash.update(bytes); update(stages, bytes, entry.h, size); size += bytes.length;
  }
  requireFormat(size === entry.readable && size === entry.size, "CHECKSUM_MISMATCH");
  const selected = select(stages, entry.adler); requireFormat(selected, "CHECKSUM_MISMATCH");
  return {...selected, rawSha256: rawHash.digest("hex")};
}
