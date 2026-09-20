import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (name: string, banner = "") => (await build({entryPoints: [fileURLToPath(new URL(`../../src/content-io/${name}.ts`, import.meta.url))],
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022", banner: {js: banner}})).outputFiles[0].text;
for (const backend of ["OPFS", "CACHE_BLOCKS", "MEMORY"] as const) {
  test(`[${backend === "OPFS" ? "ST-01" : backend === "CACHE_BLOCKS" ? "ST-02" : "ST-03"}] BROWSER/restart-${backend} @S06`, async ({page}) => {
    const banner = backend === "CACHE_BLOCKS" ? "navigator.storage.getDirectory = async () => { throw new Error('test OPFS refused'); };" :
      backend === "MEMORY" ? "Object.defineProperty(globalThis, 'indexedDB', {value: undefined});" : "";
    const server = await startFixtureServer({contentModule: await bundle("client"), modules: {"worker.mjs": await bundle("worker", banner)}});
    const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
      delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async ({identity}) => {
        const moduleUrl = "/__test__/content.mjs";
        const {createContentSession} = await import(moduleUrl) as typeof import("../../src/content-io/client.js");
        const samples = [], backends = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
          try {
            const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/multi-tail/game`,
              purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", },
            {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", });
            const output = new Uint8Array(reader.sizeBytes); await reader.readInto(0, output);
            samples.push(Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", output)))); backends.push(session.stats.backend);
          } finally {await session.close();}
        }
        const cache = await caches.open("retrom-content-io-v1");
        const cachedResponses = [];
        for (const request of await cache.keys()) {cachedResponses.push((await cache.match(request))?.status);}
        return {samples, backends, cachedResponses};
      }, {identity});
      expect(result.samples[0]).toEqual(result.samples[1]); expect(result.backends).toEqual([backend, backend]);
      expect(server.requests("game")).toHaveLength(backend === "MEMORY" ? 8 : 4);
      if (backend === "CACHE_BLOCKS") {expect(result.cachedResponses).toEqual([200, 200, 200, 200]);}
    } finally {await server.close();}
  });
}
test("[IO-18] BROWSER/corrupt-block [IO-19] BROWSER/missing-receipt [ST-18] BROWSER/namespace @S06", async ({page}) => {
  const server = await startFixtureServer({contentModule: await bundle("client"), modules: {"worker.mjs": await bundle("worker")}});
  const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity}) => {
      const moduleUrl = "/__test__/content.mjs";
      const {createContentSession} = await import(moduleUrl) as typeof import("../../src/content-io/client.js");
      const old = await caches.open("old-core-cache-test"); await old.put("/keep", new Response("untouched"));
      const read = async () => {
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
        try {
          const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/multi-tail/game`,
            purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", },
          {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", });
          const bytes = new Uint8Array(reader.sizeBytes); await reader.readInto(0, bytes);
          return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
        } finally {await session.close();}
      };
      const before = await read();
      const db = await new Promise<IDBDatabase>((resolve, reject) => {const request = indexedDB.open("retrom-content-io-v1", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
      const receipts = await new Promise<{objectKey: string; generation: string; index: number}[]>((resolve) => {
        const request = db.transaction("blocks").objectStore("blocks").getAll(); request.onsuccess = () => resolve(request.result);
      });
      const receipt = receipts.find((entry) => entry.index === 0)!;
      let directory = await navigator.storage.getDirectory();
      for (const path of ["retrom-content-io-v1", "objects", receipt.objectKey]) {directory = await directory.getDirectoryHandle(path);}
      const handle = await directory.getFileHandle(`${receipt.generation}.data`), writer = await handle.createWritable({keepExistingData: true});
      await writer.write({type: "write", position: 17, data: new Uint8Array([199])}); await writer.close();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("blocks", "readwrite"); tx.objectStore("blocks").delete([receipt.objectKey, receipt.generation, 2]); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      }); db.close();
      const after = await read();
      return {before, after, old: await (await old.match("/keep"))?.text()};
    }, {identity});
    expect(result.after).toEqual(result.before); expect(result.old).toBe("untouched");
    expect(server.requests("game").slice(4).map((request) => request.range)).toEqual(["bytes=0-262143", "bytes=524288-786431"]);
  } finally {await server.close();}
});
test("[ST-05] BROWSER/crash-before-receipt orphan data is never promoted after Worker termination @S06", async ({page}) => {
  const crashWorker = (await build({stdin: {contents: `
import {ContentMetadata} from "./src/content-io/store/metadata.ts";
import "./src/content-io/worker.ts";
const original = ContentMetadata.prototype.update;
ContentMetadata.prototype.update = function(key, generation, revision, change, block) {
  if (block && "index" in block) {globalThis.postMessage({hook: "AFTER_DATA_FLUSH_BEFORE_RECEIPT"}); return new Promise(() => {});}
  return original.call(this, key, generation, revision, change, block);
};`, resolveDir: process.cwd(), loader: "ts"}, bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
  const server = await startFixtureServer({contentModule: await bundle("client"), modules: {"worker.mjs": await bundle("worker"), "crash.mjs": crashWorker}});
  const identity = server.register({id: "game", fixtureId: "exact-block", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity}) => {
      const moduleUrl = "/__test__/content.mjs";
      const {createContentSession} = await import(moduleUrl) as typeof import("../../src/content-io/client.js");
      const context = {storageOrigin: location.origin, allowedOrigins: [location.origin]};
      const source = {identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/exact-block/game`,
        purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
      const policy = {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
      const worker = new Worker("/__test__/crash.mjs", {type: "module"});
      const hook = new Promise<string>((resolve) => worker.onmessage = ({data}) => resolve(data.hook as string));
      const first = await createContentSession(worker, context, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}}), reader = await first.open(source, policy);
      const read = reader.readInto(0, new Uint8Array(1)).then(() => "success", () => "failed");
      const reached = await hook; worker.terminate(); worker.dispatchEvent(new Event("error")); await read;
      const second = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), context, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
      try {
        const next = await second.open(source, policy), bytes = new Uint8Array(1); await next.readInto(0, bytes);
        return {reached, backend: second.stats.backend, firstStats: first.stats, byte: bytes[0]};
      } finally {await second.close();}
    }, {identity});
    expect(result.reached).toBe("AFTER_DATA_FLUSH_BEFORE_RECEIPT"); expect(result.backend).toBe("OPFS");
    expect(result.firstStats).toMatchObject({pending: 0, files: 0, channels: 0}); expect(server.requests("game")).toHaveLength(2);
  } finally {await server.close();}
});
