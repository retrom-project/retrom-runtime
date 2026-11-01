import type {ContentCacheClearRequestV1, ContentCacheClearResultV1, ContentCacheInspectRequestV1, ContentCacheSummaryV1} from "../../provider/generated/provider-module-v1.js";
import {checkSignal, requestScope} from "../abort.js";
import {ContentIOError, fail} from "../errors.js";
import {isDigest} from "../source.js";
import {CacheBlockStore} from "./cache-storage.js";
import {ContentGC} from "./gc.js";
import {ContentLocks} from "./locks.js";
import {ContentMetadata} from "./metadata.js";
import {OPFSStore} from "./opfs.js";

export function inspectContentCache(request: ContentCacheInspectRequestV1 = {}): Promise<ContentCacheSummaryV1> {
  return withMetadata(request.signal, async (metadata, signal) => {
    const summary = metadata ? await metadata.summary() : {cachedBytes: 0, objectCount: 0};
    checkSignal(signal);
    return {...summary, canClear: typeof globalThis.navigator?.locks?.request === "function"};
  });
}

export async function clearContentCache(request: ContentCacheClearRequestV1): Promise<ContentCacheClearResultV1> {
  if (!request || request.afterKey !== undefined && !isDigest(request.afterKey)) {fail("SOURCE_INVALID");}
  return withMetadata(request.signal, async (metadata, signal) => {
    if (typeof globalThis.navigator?.locks?.request !== "function") {fail("CACHE_UNAVAILABLE");}
    if (!metadata) {return {reclaimedBytes: 0, removedObjects: 0, skippedObjects: 0, nextKey: null};}
    const opfs = await OPFSStore.openExisting(); checkSignal(signal);
    const cache = await CacheBlockStore.openExisting(location.origin); checkSignal(signal);
    const stores = [...(opfs ? [opfs] : []), ...(cache ? [cache] : [])];
    return new ContentGC(metadata, new ContentLocks(), stores).clear({afterKey: request.afterKey, signal});
  });
}

async function withMetadata<Value>(signal: AbortSignal | undefined,
  action: (metadata: ContentMetadata | undefined, signal: AbortSignal) => Promise<Value>): Promise<Value> {
  const scope = requestScope(signal, 5000);
  let metadata: ContentMetadata | undefined;
  try {
    if (typeof globalThis.indexedDB?.databases !== "function") {fail("CACHE_UNAVAILABLE");}
    metadata = await ContentMetadata.openExisting(); checkSignal(scope.signal);
    return await action(metadata, scope.signal);
  } catch (cause) {
    if (cause instanceof ContentIOError) {throw cause;}
    throw new ContentIOError("CACHE_UNAVAILABLE", {cause});
  } finally {metadata?.close(); scope.dispose();}
}
