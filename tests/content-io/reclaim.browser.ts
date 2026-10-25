import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";

async function fixture() {
  const code = (await build({stdin: {contents: `export {ContentMetadata} from './src/content-io/store/metadata.ts';
export {ContentLocks} from './src/content-io/store/locks.ts';
export {CacheBlockStore} from './src/content-io/store/cache-storage.ts';
export {reclaimContentCache} from './src/content-io/store/reclaim.ts';
export {createContentSession} from './src/content-io/client.ts';`, resolveDir: process.cwd(), loader: "ts"},
  bundle: true, format: "esm", platform: "browser", write: false})).outputFiles[0].text;
  const worker = (await build({stdin: {contents: "import './src/content-io/worker.ts';", resolveDir: process.cwd(), loader: "ts"},
    bundle: true, format: "esm", platform: "browser", write: false})).outputFiles[0].text;
  return startFixtureServer({contentModule: code, modules: {"worker.mjs": worker}});
}
type API = typeof import("../../src/content-io/store/metadata.js") & typeof import("../../src/content-io/store/locks.js") &
  typeof import("../../src/content-io/store/cache-storage.js") & typeof import("../../src/content-io/store/reclaim.js") &
  typeof import("../../src/content-io/client.js");

test("recovery creates no content database or cache on a fresh origin", async ({page}) => {
  const server = await fixture();
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async () => {
      const path = "/__test__/content.mjs", api = await import(path) as API;
      const before = {dbs: await indexedDB.databases(), caches: await caches.keys()};
      const recovered = await api.reclaimContentCache({targetBytes: 1});
      return {before, after: {dbs: await indexedDB.databases(), caches: await caches.keys()}, recovered};
    });
    expect(result.before).toEqual(result.after);
    expect(result.recovered).toEqual({reclaimedBytes: 0, removedObjects: 0});
  } finally {await server.close();}
});

test("evicted content is downloaded and verified again in a fresh Session, then reused by the next Session", async ({page}) => {
  const server = await fixture();
  const identity = server.register({id: "reclaimed", fixtureId: "above-block", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async identity => {
      const path = "/__test__/content.mjs", api = await import(path) as API;
      const source = {identity: identity.identity, sizeBytes: identity.sizeBytes,
        url: `${location.origin}/objects/above-block/reclaimed`, purpose: "GAME", transport: "WHOLE_ALLOWED",
        etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
      async function readFresh() {
        const session = await api.createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]});
        try {
          const reader = await session.open(source, {mode: "EAGER", bridge: "NONE", result: "BYTES", maxFileBytes: identity.sizeBytes,
            workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"});
          const result = await session.materialize(reader.id, {kind: "BYTES", maxBytes: identity.sizeBytes});
          if (result.kind !== "BYTES") {throw new Error("expected bytes");}
          const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(result.bytes))),
            value => value.toString(16).padStart(2, "0")).join("");
          return {digest, receipt: result.receipt, length: result.bytes.length};
        } finally {await session.close();}
      }
      const reads = [], counts = [];
      for (let index = 0; index < 2; index++) {
        reads.push(await readFresh()); counts.push((await (await fetch("/__test__/requests/reclaimed")).json() as unknown[]).length);
      }
      const recovered = await api.reclaimContentCache({targetBytes: 1});
      for (let index = 0; index < 2; index++) {
        reads.push(await readFresh()); counts.push((await (await fetch("/__test__/requests/reclaimed")).json() as unknown[]).length);
      }
      const metadata = (await api.ContentMetadata.openExisting())!;
      const final = await metadata.object(reads[0].receipt.objectKey); metadata.close();
      return {reads, counts, recovered, finalState: final?.state};
    }, identity);
    const digest = identity.identity.kind === "FILE_SHA256" ? identity.identity.sha256 : "";
    for (const read of result.reads) {
      expect(read.digest).toBe(digest); expect(read.length).toBe(identity.sizeBytes);
      expect(read.receipt).toMatchObject({localSha256: digest, assurance: "EXPECTED_SHA256", sizeBytes: identity.sizeBytes});
    }
    expect(result.counts[0]).toBeGreaterThan(0); expect(result.counts[1]).toBe(result.counts[0]);
    expect(result.recovered).toEqual({reclaimedBytes: identity.sizeBytes, removedObjects: 1});
    expect(result.counts[2]).toBeGreaterThan(result.counts[1]); expect(result.counts[3]).toBe(result.counts[2]);
    expect(result.reads[2].receipt.storageGeneration).not.toBe(result.reads[0].receipt.storageGeneration);
    expect(result.reads[3].receipt.storageGeneration).toBe(result.reads[2].receipt.storageGeneration);
    expect(result.finalState).toBe("COMPLETE");
  } finally {await server.close();}
});

test("native use leases protect live content while recovery deletes all idle generations and only their metadata", async ({page}) => {
  const server = await fixture();
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async () => {
      const path = "/__test__/content.mjs", api = await import(path) as API;
      const metadata = await api.ContentMetadata.open(), data = await api.CacheBlockStore.open(location.origin);
      const live = "a".repeat(64), idle = "b".repeat(64), locks = new api.ContentLocks();
      const bytes = Uint8Array.of(17, 31, 47);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
      async function seed(key: string, privateGeneration = false) {
        const source = {identity: {kind: "FILE_SHA256", sha256: digest}, sizeBytes: bytes.length,
          url: `${location.origin}/${key}`, purpose: "GAME", transport: "RANGE_REQUIRED",
          etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
        const backing = await metadata.attach(key, source, "CACHE_BLOCKS", privateGeneration);
        const generation = backing.generation.generation;
        const receipt = {objectKey: key, generation, backend: "CACHE_BLOCKS", index: 0, length: bytes.length,
          localSha256: digest, etag: null, provenance: "FULL_VERIFIED", sourceAssurance: "EXPECTED_ETAG",
          location: data.location(key, generation, 0), commitRevision: 1} as const;
        await data.write(receipt, bytes);
        await metadata.update(key, generation, 0, record => {record.state = "COMPLETE";
          record.completionAssurance = "EXPECTED_SHA256"; record.localSha256 = digest; record.committedBytes = bytes.length;
        }, receipt);
        await metadata.transaction(["jobs"], "readwrite", (tx, finish) => {
          tx.objectStore("jobs").put({jobId: generation, objectKey: key, generation, ownerSession: "test",
            state: "COMPLETE", wholeRestartCount: 0, updatedAtMs: 1}); finish(undefined);
        });
      }
      await seed(live); await seed(idle); await seed(idle, true);
      const shell = await caches.open("protected-pwa-test"); await shell.put("/shell", new Response("keep shell"));
      const root = await navigator.storage.getDirectory(), native = await root.getDirectoryHandle("protected-native-test", {create: true});
      const save = await native.getFileHandle("save", {create: true}), writer = await save.createWritable();
      await writer.write("keep native save"); await writer.close();
      const release = await locks.use(live);
      Object.defineProperty(navigator.storage, "estimate", {configurable: true, value: () => {throw new Error("do not estimate");}});
      const recovered = await api.reclaimContentCache({targetBytes: 1});
      const liveRecord = await metadata.object(live), idleRecord = await metadata.object(idle);
      const retained = await metadata.transaction(["generations", "blocks", "jobs"], "readonly", (tx, finish) => {
        const counts: Record<string, number> = {}; let pending = 3;
        for (const name of ["generations", "blocks", "jobs"]) {
          const request = tx.objectStore(name).count(); request.onsuccess = () => {counts[name] = request.result; if (!--pending) {finish(counts);}};
        }
      });
      const cacheKeys = (await (await caches.open("retrom-content-io-v1")).keys()).map(request => request.url);
      release(); metadata.close();
      return {recovered, liveState: liveRecord?.state, idleExists: Boolean(idleRecord), retained, cacheKeys,
        native: await (await save.getFile()).text(), shell: await (await shell.match("/shell"))!.text()};
    });
    expect(result.recovered).toEqual({reclaimedBytes: 6, removedObjects: 1});
    expect(result.liveState).toBe("COMPLETE"); expect(result.idleExists).toBe(false);
    expect(result.retained).toEqual({generations: 1, blocks: 1, jobs: 1});
    expect(result.cacheKeys).toHaveLength(1); expect(result.cacheKeys[0]).toContain("a".repeat(64));
    expect(result.native).toBe("keep native save"); expect(result.shell).toBe("keep shell");
  } finally {await server.close();}
});
