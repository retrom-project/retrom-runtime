import type {ContentSourceV1} from "../../../contracts/content-io/v1/content-io.js";
import {ContentIOError, fail} from "../errors.js";
import {namespace, type Backend, type Backing, type BlockReceipt, type GenerationRecord, type ObjectRecord} from "./types.js";
/** Callbacks are synchronous: no fetch, file I/O or hash may enter an IDB transaction. */
export class ContentMetadata {
  constructor(private readonly db: IDBDatabase) {db.onversionchange = () => db.close();}
  static open(): Promise<ContentMetadata> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(namespace, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("objects", {keyPath: "key"}).createIndex("byLastAccess", "lastAccessMs");
        db.createObjectStore("blocks", {keyPath: ["objectKey", "generation", "index"]}).createIndex("byObject", ["objectKey", "generation"]);
        db.createObjectStore("jobs", {keyPath: "jobId"}).createIndex("byObject", "objectKey");
        db.createObjectStore("generations", {keyPath: ["objectKey", "generation"]}).createIndex("byObject", "objectKey");
      };
      request.onsuccess = () => resolve(new ContentMetadata(request.result)); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new ContentIOError("CACHE_UNAVAILABLE"));
    });
  }
  close(): void {this.db.close();}
  object(key: string): Promise<ObjectRecord | undefined> {return this.get("objects", key);}
  generation(key: string, generation: string): Promise<GenerationRecord | undefined> {return this.get("generations", [key, generation]);}
  block(key: string, generation: string, index: number): Promise<BlockReceipt | undefined> {return this.get("blocks", [key, generation, index]);}
  attach(key: string, source: ContentSourceV1, backend: Backend, privateGeneration = false): Promise<Backing> {
    return this.transaction(["objects", "generations"], "readwrite", (tx, finish) => {
      const objects = tx.objectStore("objects"), request = objects.get(key);
      request.onsuccess = () => {
        const current = request.result as ObjectRecord | undefined;
        if (current && !privateGeneration && current.backend === backend && current.state !== "QUARANTINED") {
          current.lastAccessMs = Date.now(); objects.put(current);
          const generation = tx.objectStore("generations").get([key, current.generation]);
          generation.onsuccess = () => {if (!generation.result) {tx.abort();} else {finish({object: current, generation: generation.result as GenerationRecord});}}; return;
        }
        const generation: GenerationRecord = {objectKey: key, generation: crypto.randomUUID(), backend, state: "PARTIAL", pinnedEtag: null,
          completionAssurance: null, localSha256: null, committedBytes: 0, revision: 0, retiredAtMs: null};
        const object: ObjectRecord = {key, identity: source.identity, sizeBytes: source.sizeBytes, purpose: source.purpose,
          sourceOrigin: new URL(source.url).origin, generation: generation.generation, backend, state: "PARTIAL", pinnedEtag: null,
          completionAssurance: null, localSha256: null, committedBytes: 0, revision: 0, lastAccessMs: Date.now()};
        tx.objectStore("generations").put(generation);
        if (!current || !privateGeneration && current.state === "QUARANTINED") {
          if(current){const old=tx.objectStore("generations").get([key,current.generation]);old.onsuccess=()=>{if(old.result){tx.objectStore("generations").put({...old.result,retiredAtMs:Date.now()});}};}
          objects.put(object);
        }
        finish({object, generation});
      };
    });
  }
  update(key: string, generation: string, revision: number, change: (record: GenerationRecord) => void,
    block?: BlockReceipt | {deleteIndex: number}): Promise<GenerationRecord> {
    return this.transaction(["objects", "generations", "blocks"], "readwrite", (tx, finish) => {
      const generations = tx.objectStore("generations"), request = generations.get([key, generation]);
      request.onsuccess = () => {
        const record = request.result as GenerationRecord | undefined;
        if (!record || record.revision !== revision || record.state === "QUARANTINED") {tx.abort(); return;}
        try {change(record);} catch {tx.abort(); return;}
        record.revision++; if (!Number.isSafeInteger(record.revision)) {tx.abort(); return;}
        generations.put(record);
        if (block) {
          if ("deleteIndex" in block) {tx.objectStore("blocks").delete([key, generation, block.deleteIndex]);}
          else {tx.objectStore("blocks").put({...block, commitRevision: record.revision});}
        }
        const objects = tx.objectStore("objects"), current = objects.get(key);
        current.onsuccess = () => {
          const object = current.result as ObjectRecord | undefined;
          if (object?.generation === generation) {
            objects.put({...object, backend: record.backend, state: record.state, pinnedEtag: record.pinnedEtag,
              completionAssurance: record.completionAssurance, localSha256: record.localSha256,
              committedBytes: record.committedBytes, revision: record.revision, lastAccessMs: Date.now()});
          }
          finish(record);
        };
      };
    });
  }
  replace(key: string, expectedGeneration: string, next: Backing): Promise<void> {
    return this.transaction(["objects", "generations"], "readwrite", (tx, finish) => {
      const objects = tx.objectStore("objects"), request = objects.get(key);
      request.onsuccess = () => {
        const current = request.result as ObjectRecord | undefined;
        if (current?.generation !== expectedGeneration) {tx.abort(); return;}
        const generations = tx.objectStore("generations"), old = generations.get([key, expectedGeneration]);
        old.onsuccess = () => {if (old.result) {generations.put({...old.result, retiredAtMs: Date.now()});} objects.put(next.object); generations.put(next.generation); finish();};
      };
    });
  }
  totalBytes(): Promise<number> {
    return this.transaction(["generations"], "readonly", (tx, finish) => {
      let bytes = 0;
      const request = tx.objectStore("generations").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {finish(bytes); return;}
        bytes += (cursor.value as GenerationRecord).committedBytes; cursor.continue();
      };
    });
  }
  list(limit = 128): Promise<ObjectRecord[]> {
    return this.transaction(["objects"], "readonly", (tx, finish) => {
      const request = tx.objectStore("objects").index("byLastAccess").getAll(undefined, limit);
      request.onsuccess = () => finish(request.result as ObjectRecord[]);
    });
  }
  generations(key: string): Promise<GenerationRecord[]> {
    return this.transaction(["generations"], "readonly", (tx, finish) => {
      const request = tx.objectStore("generations").index("byObject").getAll(key);
      request.onsuccess = () => finish(request.result as GenerationRecord[]);
    });
  }
  remove(key: string): Promise<void> {
    return this.transaction(["objects", "generations", "blocks", "jobs"], "readwrite", (tx, finish) => {
      tx.objectStore("objects").delete(key);
      for (const name of ["generations", "blocks", "jobs"]) {
        const store = tx.objectStore(name), cursor = store.openCursor();
        cursor.onsuccess = () => {const value = cursor.result; if (!value) {return;} if (value.value.objectKey === key) {value.delete();} value.continue();};
      }
      finish();
    });
  }
  private get<Value>(store: string, key: IDBValidKey): Promise<Value | undefined> {
    return this.transaction([store], "readonly", (tx, finish) => {
      const request = tx.objectStore(store).get(key); request.onsuccess = () => finish(request.result as Value | undefined);
    });
  }
  transaction<Value>(stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction, finish: (value: Value) => void) => void): Promise<Value> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, mode); let value: Value, finished = false;
      tx.oncomplete = () => {if (finished) {resolve(value);} else {reject(new ContentIOError("CACHE_UNAVAILABLE"));}};
      tx.onabort = tx.onerror = () => reject(new ContentIOError("CACHE_UNAVAILABLE", {cause: tx.error}));
      try {action(tx, (result) => {value = result; finished = true;});} catch (cause) {tx.abort(); reject(cause);}
    });
  }
}
export function requireGeneration(value: GenerationRecord | undefined): GenerationRecord {
  if (!value || value.state === "QUARANTINED") {fail("IDENTITY_CHANGED");} return value;
}
