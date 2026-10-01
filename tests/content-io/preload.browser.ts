import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";

async function bundle(contents: string) {
  return (await build({stdin: {contents, resolveDir: process.cwd(), loader: "ts"},
    bundle: true, format: "esm", platform: "browser", write: false})).outputFiles[0].text;
}

async function fixture(workerPrefix = "") {
  const worker = workerPrefix + await bundle(`import './src/content-io/worker.ts';
    import {OPFSStore} from './src/content-io/store/opfs.ts';
    import {CacheBlockStore} from './src/content-io/store/cache-storage.ts';
    for (const Store of [OPFSStore, CacheBlockStore]) {
      const read = Store.prototype.read;
      Store.prototype.read = async function(receipt, complete) {
        if (complete && globalThis.name === 'preload') throw new Error('warm preload scanned client bytes');
        return read.call(this, receipt, complete);
      };
    }`);
  const contentModule = await bundle(`
    import {createContentSession} from './src/content-io/client.ts';
    import {ContentMetadata} from './src/content-io/store/metadata.ts';
    import {ContentLocks} from './src/content-io/store/locks.ts';
    import {ContentGC} from './src/content-io/store/gc.ts';
    import {OPFSStore} from './src/content-io/store/opfs.ts';
    import {CacheBlockStore} from './src/content-io/store/cache-storage.ts';
    let preload, session, reader;
    export const progress = [];
    export async function prepare(source, cancelAfter = Infinity) {
      preload = new Worker('/__test__/worker.mjs', {type: 'module', name: 'preload'});
      await new Promise((resolve, reject) => {
        preload.onerror = reject;
        preload.onmessage = ({data}) => {
          if (data.type === 'COMPLETE') resolve();
          if (data.type === 'ERROR') reject(new Error(data.code));
          if (data.type === 'PROGRESS') {
            progress.push(data.loadedBytes);
            if (data.loadedBytes >= cancelAfter) {preload.terminate(); reject(new Error('CANCELLED'));}
          }
        };
        preload.postMessage({type: 'PRELOAD', sources: [source], storageOrigin: location.origin, allowedOrigins: [location.origin]});
      });
      await open(source);
    }
    export async function open(source) {
      await session?.close();
      session = await createContentSession(new Worker('/__test__/worker.mjs', {type:'module'}),
        {storageOrigin: location.origin, allowedOrigins: [location.origin]});
      reader = await session.open(source, {mode:'RANGE', bridge:'ASYNC', result:'READER', maxFileBytes: 32*1024*1024,
        workspace:'NONE', writes:'DENY', contentLengthPolicy:'EXACT_IF_PRESENT'});
    }
    export async function read(offset) {
      const bytes = new Uint8Array(17); await reader.readInto(offset, bytes); return [...bytes];
    }
    export async function collect() {
      const metadata = await ContentMetadata.open();
      const stores = [await OPFSStore.open(), await CacheBlockStore.open(location.origin)];
      try {return await new ContentGC(metadata, new ContentLocks(), stores).collect(0);}
      finally {metadata.close();}
    }
    export async function release() {preload.terminate(); await session?.close();}
  `);
  const server = await startFixtureServer({contentModule, modules: {"worker.mjs": worker}});
  const identity = server.register({id: "preload", behavior: "NORMAL", fixtureId: "cache-trace", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  const source = {identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${server.origin}/objects/cache-trace/preload`,
    purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
  return {server, source};
}

for (const backend of ["OPFS", "Cache Storage"]) {
test(`${backend}: preload commits the complete file, holds GC leases, and serves unread offsets offline across sessions`, async ({page, context}) => {
  const prefix = backend === "OPFS" ? "" : "navigator.storage.getDirectory = async () => {throw new DOMException('denied', 'NotAllowedError');};\n";
  const {server, source} = await fixture(prefix);
  try {
    await page.goto(`${server.origin}/__test__/page`);
    await page.evaluate(async source => {const path = "/__test__/content.mjs"; await (await import(path)).prepare(source);}, source);
    const downloaded = server.requests("preload").length;
    expect(downloaded).toBeGreaterThan(1);
    const warmProgress = await page.evaluate(async source => {
      const path = "/__test__/content.mjs", api = await import(path);
      await api.release(); const start = api.progress.length;
      await api.prepare(source); return api.progress.slice(start);
    }, source);
    expect(warmProgress).toEqual([0, source.sizeBytes, source.sizeBytes]);
    expect(server.requests("preload")).toHaveLength(downloaded);
    expect(await page.evaluate(async () => {const path = "/__test__/content.mjs"; return (await import(path)).collect();})).toBe(0);
    await context.setOffline(true);
    expect(await page.evaluate(async () => {const path = "/__test__/content.mjs"; return (await import(path)).read(8 * 1024 * 1024);})).toHaveLength(17);
    await context.setOffline(false);
    await page.evaluate(async source => {const path = "/__test__/content.mjs"; const api = await import(path); await api.open(source); await api.read(12 * 1024 * 1024);}, source);
    expect(server.requests("preload")).toHaveLength(downloaded);
    const progress = await page.evaluate(async () => {const path = "/__test__/content.mjs"; return (await import(path)).progress as number[];});
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(source.sizeBytes);
    await page.evaluate(async () => {const path = "/__test__/content.mjs"; await (await import(path)).release();});
    await expect.poll(() => page.evaluate(async () => {const path = "/__test__/content.mjs"; return (await import(path)).collect();})).toBe(1);
  } finally {await context.setOffline(false); await server.close();}
});
}

test("denied persistent storage cannot report a completed download", async ({page}) => {
  const {server, source} = await fixture("Object.defineProperty(globalThis, 'indexedDB', {value: undefined});\n");
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async source => {
      const path = "/__test__/content.mjs", api = await import(path);
      try {await api.prepare(source); return "unexpected success";}
      catch (error) {return (error as Error).message;}
    }, source);
    expect(result).toBe("CONTENT_IO_CACHE_UNAVAILABLE");
    expect(server.requests("preload")).toHaveLength(0);
  } finally {await server.close();}
});

test("cancelling a download preserves committed blocks for the next attempt", async ({page}) => {
  const {server, source} = await fixture();
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const cancelled = await page.evaluate(async source => {
      const path = "/__test__/content.mjs", api = await import(path);
      try {await api.prepare(source, 2 * 1024 * 1024); return false;}
      catch (error) {return (error as Error).message === "CANCELLED";}
    }, source);
    expect(cancelled).toBe(true);
    const before = server.requests("preload").length;
    await page.evaluate(async source => {const path = "/__test__/content.mjs"; await (await import(path)).prepare(source);}, source);
    const resumed = server.requests("preload").slice(before);
    expect(resumed.length).toBeGreaterThan(0);
    expect(resumed.every(request => request.range !== null && !request.range.startsWith("bytes=0-"))).toBe(true);
  } finally {await server.close();}
});

test("a quota failure after storage probing never becomes successful completion", async ({page}) => {
  const prefix = `
    navigator.storage.getDirectory = async () => {throw new DOMException('denied', 'NotAllowedError');};
    const open = caches.open.bind(caches);
    caches.open = async (...args) => {
      const cache = await open(...args), put = cache.put.bind(cache);
      cache.put = async (request, response) => {
        if (!String(request).includes('/probe/')) throw new DOMException('full', 'QuotaExceededError');
        return put(request, response);
      };
      return cache;
    };
  `;
  const {server, source} = await fixture(prefix);
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async source => {
      const path = "/__test__/content.mjs", api = await import(path);
      try {await api.prepare(source); return {error: "none", complete: true};}
      catch (error) {return {error: (error as Error).message, complete: api.progress.includes(source.sizeBytes)};}
    }, source);
    expect(result).toEqual({error: "CONTENT_IO_WORKSPACE_UNAVAILABLE", complete: false});
  } finally {await server.close();}
});
