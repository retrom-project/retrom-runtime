import type {ContentSourceV1, ManagedInputPolicyV1} from "../contracts/content-io/v1/content-io.js";
import {BlockPool, type BlockObject} from "../src/content-io/block-pool.js";
import {ContentStoreManager} from "../src/content-io/store/manager.js";
import {ContentMaterializer} from "../src/content-io/materializer.js";
import {RangeReader} from "../src/content-io/range-reader.js";
import {contentObjectKey, validateSource} from "../src/content-io/source.js";
import {validateManagedPolicy, validateSourcePolicy} from "../src/content-io/policy.js";
import {ContentIOError} from "../src/content-io/errors.js";
import type {AdapterContentSession} from "../src/provider/content-inputs.js";
/** Node integration harness using production reader/HTTP/materializer, without pretending to test Workers. */
export function contentSessionFixture(origin: string, allowedOrigins = [origin]) {
  const context = {storageOrigin: origin, allowedOrigins};
  const files = new Map<string, {reader: RangeReader; object: BlockObject; policy: ManagedInputPolicyV1}>();
  const objects = new Map<string, BlockObject>();
  const pool: BlockPool = new BlockPool(0, (object, index, signal) => store.read(object, index, signal), undefined,
    (object, signal) => store.prepare(object, signal));
  const store = new ContentStoreManager(origin, pool.credits), materializer = new ContentMaterializer(pool, store);
  const session: AdapterContentSession = {
    async open(input: ContentSourceV1, inputPolicy: ManagedInputPolicyV1, signal?: AbortSignal) {
      signal?.throwIfAborted(); const source = validateSource(input, context), policy = validateManagedPolicy(inputPolicy); validateSourcePolicy(source, policy);
      const key = contentObjectKey(source, origin);
      let object = objects.get(key);
      if (!object) {object = {key, source, state: {generation: crypto.randomUUID(), pinnedEtag: null, revoked: false}}; objects.set(key, object);}
      const id = crypto.randomUUID(), reader = new RangeReader(id, {...object, source}, pool, async () => {files.delete(id);});
      files.set(id, {reader, object: {...object, source}, policy}); return reader;
    },
    async materialize(fileId, request, signal, report) {
      const file = files.get(fileId); if (!file) {throw new ContentIOError("ABORTED");}
      if (request.maxBytes > file.policy.maxFileBytes) {throw new ContentIOError("SOURCE_INVALID");}
      return materializer.prepare(file.object, request, signal, report);
    },
    async closeFile(fileId) {await files.get(fileId)?.reader.close();},
  };
  return {session, pool, store, files,
    async close() {await Promise.all([...files.values()].map(file => file.reader.close())); materializer.close(); store.close(); pool.close();}};
}
