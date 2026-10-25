import {checkSignal, requestScope} from "../abort.js";
import {ContentIOError, fail} from "../errors.js";
import {CacheBlockStore} from "./cache-storage.js";
import {ContentGC, type ReclaimRequest, type ReclaimResult} from "./gc.js";
import {ContentLocks} from "./locks.js";
import {ContentMetadata} from "./metadata.js";
import {OPFSStore} from "./opfs.js";

/** Stateless Provider storage recovery, also usable after its game runtime has exited. */
export async function reclaimContentCache(request: ReclaimRequest): Promise<ReclaimResult> {
  if (!request || !Number.isSafeInteger(request.targetBytes) || request.targetBytes <= 0) {fail("SOURCE_INVALID");}
  const scope = requestScope(request.signal, 5000);
  let metadata: ContentMetadata | undefined;
  try {
    checkSignal(scope.signal);
    if (!globalThis.navigator?.locks) {return {reclaimedBytes: 0, removedObjects: 0};}
    metadata = await ContentMetadata.openExisting();
    checkSignal(scope.signal);
    if (!metadata) {return {reclaimedBytes: 0, removedObjects: 0};}
    const opfs = await OPFSStore.openExisting();
    checkSignal(scope.signal);
    const cache = await CacheBlockStore.openExisting(location.origin);
    checkSignal(scope.signal);
    const stores = [...(opfs ? [opfs] : []), ...(cache ? [cache] : [])];
    return await new ContentGC(metadata, new ContentLocks(), stores).collect({targetBytes: request.targetBytes, signal: scope.signal});
  } catch (cause) {
    if (cause instanceof ContentIOError) {throw cause;}
    throw new ContentIOError("CACHE_UNAVAILABLE", {cause});
  } finally {metadata?.close(); scope.dispose();}
}
