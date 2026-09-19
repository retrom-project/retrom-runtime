import {contentLimits} from "../../content-io/limits.js";
import {fileContentSource, type AdapterContentSession} from "../../provider/content-inputs.js";
import {eagerPolicy} from "../../provider/content-policies.js";
import {ContentIOError} from "../../content-io/errors.js";
type Disc = {url: string; sizeBytes: number; sha256: string};
/** The Provider session owns the Blob lease until native exit and ContentSession.close. */
export async function loadDisc(disc: Disc, signal: AbortSignal, progress: (loaded: number, total: number) => void,
  session: AdapterContentSession): Promise<Blob> {
  if (!Number.isSafeInteger(disc.sizeBytes) || disc.sizeBytes < 1 || disc.sizeBytes > contentLimits.signedDisc) {throw new ContentIOError("BOUNDS");}
  const policy = eagerPolicy(contentLimits.signedDisc, {result: "BLOB"});
  const reader = await session.open(fileContentSource(disc, policy), policy, signal);
  try {
    const result = await session.materialize(reader.id, {kind: "BLOB", maxBytes: policy.maxFileBytes}, signal,
      value => progress(value.readyBytes, disc.sizeBytes));
    if (result.kind !== "BLOB") {throw new ContentIOError("INTERNAL");} return result.blob;
  } finally {await reader.close();}
}
