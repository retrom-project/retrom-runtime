import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
test("[ST-08] BROWSER/use-lock [ST-07] BROWSER/data-lock [X-08] BROWSER/idb-cas @S06", async ({page}) => {
  const code = (await build({stdin: {contents: `export {ContentMetadata} from './src/content-io/store/metadata.ts';
export {ContentLocks} from './src/content-io/store/locks.ts';
export {ContentGC} from './src/content-io/store/gc.ts';
export {CacheBlockStore} from './src/content-io/store/cache-storage.ts';`, resolveDir: process.cwd(), loader: "ts"}, bundle: true, format: "esm", platform: "browser", write: false})).outputFiles[0].text;
  const server = await startFixtureServer({contentModule: code});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async () => {
      const moduleUrl = "/__test__/content.mjs";
      const api = await import(moduleUrl) as typeof import("../../src/content-io/store/metadata.js") & typeof import("../../src/content-io/store/locks.js") &
        typeof import("../../src/content-io/store/gc.js") & typeof import("../../src/content-io/store/cache-storage.js");
      const first = await api.ContentMetadata.open(), second = await api.ContentMetadata.open();
      const locks = new api.ContentLocks(), data = await api.CacheBlockStore.open(location.origin), key = "a".repeat(64);
      const source = {identity: {kind: "FILE_SHA256", sha256: "a".repeat(64)}, sizeBytes: 1, url: `${location.origin}/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
        etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
      const backing = await first.attach(key, source, "CACHE_BLOCKS");
      const changes = await Promise.allSettled([first.update(key, backing.generation.generation, 0, (record) => {record.committedBytes = 1;}),
        second.update(key, backing.generation.generation, 0, (record) => {record.committedBytes = 2;})]);
      const generation = (await first.object(key))!;
      await first.update(key, generation.generation, generation.revision, record => {record.state = "QUARANTINED";});
      const lease = await locks.use(key), gc = new api.ContentGC(first, locks, [data]);
      const held = await gc.collect(); const stillPresent = Boolean(await first.object(key));
      lease(); const released = await gc.collect(), gone = !(await first.object(key));
      first.close(); second.close(); return {changes: changes.map((change) => change.status).sort(), held, stillPresent, released, gone};
    });
    expect(result).toEqual({changes: ["fulfilled", "rejected"], held: 0, stillPresent: true, released: 1, gone: true});
  } finally {await server.close();}
});

test("retains old complete and partial entries while collecting quarantine beyond the first page", async ({page}) => {
  const code = (await build({stdin: {contents: `export {ContentMetadata} from './src/content-io/store/metadata.ts';
export {ContentLocks} from './src/content-io/store/locks.ts';export {ContentGC} from './src/content-io/store/gc.ts';
export {CacheBlockStore} from './src/content-io/store/cache-storage.ts';`, resolveDir: process.cwd(), loader: "ts"},
  bundle: true, format: "esm", platform: "browser", write: false})).outputFiles[0].text;
  const server = await startFixtureServer({contentModule: code});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async () => {
      const path = "/__test__/content.mjs";
      const api = await import(path) as typeof import("../../src/content-io/store/metadata.js") & typeof import("../../src/content-io/store/locks.js") &
        typeof import("../../src/content-io/store/gc.js") & typeof import("../../src/content-io/store/cache-storage.js");
      const metadata = await api.ContentMetadata.open(), store = await api.CacheBlockStore.open(location.origin);
      const keys = Array.from({length: 140}, (_, index) => index.toString(16).padStart(64, "0"));
      for (const [index, key] of keys.entries()) {
        const source = {identity: {kind: "FILE_SHA256", sha256: key}, sizeBytes: 10 * 1024 ** 3,
          url: `${location.origin}/game/${key}`, purpose: "GAME", transport: "RANGE_REQUIRED",
          etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
        const entry = await metadata.attach(key, source, "CACHE_BLOCKS");
        await metadata.update(key, entry.generation.generation, 0, record => {
          record.committedBytes = 1024;
          record.state = index === 139 ? "QUARANTINED" : index % 2 ? "PARTIAL" : "COMPLETE";
        });
      }
      await metadata.transaction(["objects"], "readwrite", (tx, finish) => {
        const store = tx.objectStore("objects"), request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {finish(undefined); return;}
          cursor.update({...cursor.value, lastAccessMs: cursor.value.state === "QUARANTINED" ? 1 : 0}); cursor.continue();
        };
      });
      Object.defineProperty(navigator.storage, "estimate", {value: async () => ({quota: 1})});
      const removed = await new api.ContentGC(metadata, new api.ContentLocks(), [store]).collect();
      const retained = (await metadata.list(200)).length, quarantined = await metadata.object(keys[139]);
      metadata.close(); return {removed, retained, quarantined: Boolean(quarantined)};
    });
    expect(result).toEqual({removed: 1, retained: 139, quarantined: false});
  } finally {await server.close();}
});
