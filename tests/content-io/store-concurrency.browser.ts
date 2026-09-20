import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (contents: string) => (await build({stdin: {contents, resolveDir: process.cwd(), loader: "ts"},
  bundle: true, format: "esm", platform: "browser", write: false})).outputFiles[0].text;
for (const scenario of ["same-block", "different-block", "pin-race"] as const) {
  test(`[ST-07] BROWSER/two-pages-${scenario} share committed metadata without mixing representations @S06`, async ({context}) => {
    const server = await startFixtureServer({contentModule: await bundle('export * from "./src/content-io/client.ts";'),
      modules: {"worker.mjs": await bundle('import "./src/content-io/worker.ts";')}});
    const register = (id: string) => server.register({id, fixtureId: "big-offset", behavior: scenario === "pin-race" && id === "b" ? "CHANGED_ETAG" : "NORMAL",
      seed: 17, delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: "both"});
    const identity = register("a"); register("b");
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    try {
      await Promise.all(pages.map(page => page.goto(`${server.origin}/__test__/page`)));
      const reads = pages.map((page, index) => page.evaluate(async ({identity, id, offset}) => {
        const url = "/__test__/content.mjs";
        const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
        try {
          const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/big-offset/${id}`,
            purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT"},
          {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"});
          const bytes = new Uint8Array(32); await reader.readInto(offset, bytes);
          return {bytes: Array.from(bytes), failure: null, backend: session.stats.backend};
        } catch (error) {return {bytes: null, failure: (error as Error).message, backend: session.stats.backend};}
        finally {await session.close();}
      }, {identity, id: index === 0 ? "a" : "b", offset: scenario === "different-block" ? index * 262144 : 0}));
      await expect.poll(() => server.requests("a").length + server.requests("b").length).toBe(2);
      server.release("both");
      const results = await Promise.all(reads);
      expect(results.every(result => result.backend === "OPFS")).toBe(true);
      if (scenario === "pin-race") {
        expect(results.filter(result => result.failure === null)).toHaveLength(1);
        expect(results.filter(result => result.failure === "CONTENT_IO_IDENTITY_CHANGED")).toHaveLength(1);
      } else for (const [index, result] of results.entries()) {
        const offset = scenario === "different-block" ? index * 262144 : 0;
        const byteAt = (n: number) => (n % 251 + 17 * (Math.floor(n / 251) % 251) + 31 * (Math.floor(n / 65536) % 251) + 17) % 256;
        expect(result.failure).toBeNull(); expect(result.bytes).toEqual(Array.from({length: 32}, (_, n) => byteAt(offset + n)));
      }
      const receipts = await pages[0].evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {const request = indexedDB.open("retrom-content-io-v1", 1);
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
        try {
          return await new Promise<{index: number; etag: string; commitRevision: number; provenance: string}[]>((resolve, reject) => {
            const request = db.transaction("blocks").objectStore("blocks").getAll();
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
          });
        } finally {db.close();}
      });
      expect(receipts.map(receipt => receipt.index).sort()).toEqual(scenario === "different-block" ? [0, 1] : [0]);
      expect(new Set(receipts.map(receipt => receipt.etag)).size).toBe(1);
      expect(receipts.every(receipt => receipt.commitRevision > 0 && receipt.provenance === "RANGE_VALIDATED")).toBe(true);
      const held = await pages[0].evaluate(async () => (await navigator.locks.query()).held?.filter(lock => lock.name?.startsWith("retrom-content-io-v1:")));
      expect(held).toEqual([]);
    } finally {server.release("both"); await Promise.all(pages.map(page => page.close())); await server.close();}
  });
}

test("[X-08] BROWSER/external-await demonstrates transaction auto-commit and the atomic metadata boundary @S06", async ({page}) => {
  const server = await startFixtureServer({contentModule: await bundle('export {ContentMetadata} from "./src/content-io/store/metadata.ts";')});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async () => {
      const url = "/__test__/content.mjs";
      const {ContentMetadata} = await import(url) as typeof import("../../src/content-io/store/metadata.js");
      const metadata = await ContentMetadata.open();
      const db = await new Promise<IDBDatabase>((resolve, reject) => {const request = indexedDB.open("retrom-content-io-v1", 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
      try {
        const tx = db.transaction("jobs", "readwrite"), store = tx.objectStore("jobs");
        const external = new Promise<void>(resolve => {tx.oncomplete = () => resolve();});
        store.put({jobId: "first"}); await external;
        let failure = ""; try {store.put({jobId: "late"});} catch (error) {failure = (error as DOMException).name;}
        const correct = await metadata.transaction<boolean>(["jobs"], "readwrite", (transaction, finish) => {
          const request = transaction.objectStore("jobs").get("first");
          request.onsuccess = () => {transaction.objectStore("jobs").put({jobId: "correct"}); finish(request.result.jobId === "first");};
        });
        const keys = await new Promise<IDBValidKey[]>(resolve => {const request = db.transaction("jobs").objectStore("jobs").getAllKeys(); request.onsuccess = () => resolve(request.result);});
        return {failure, correct, keys};
      } finally {db.close(); metadata.close();}
    });
    expect(result).toEqual({failure: "TransactionInactiveError", correct: true, keys: ["correct", "first"]});
  } finally {await server.close();}
});
