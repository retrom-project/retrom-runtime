import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile = async (contents: string) => (await build({stdin: {contents, resolveDir: process.cwd()},
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;

for (const identityKind of ["FILE_SHA256", "INDEX_ENTRY"] as const) {
test(`[X-09] BROWSER/fallback-restart-${identityKind} committed blocks survive a fresh Session @S06`, async ({page}) => {
  const worker = await compile(`import {OPFSStore} from './src/content-io/store/opfs.ts';
import './src/content-io/worker.ts';
const send = MessagePort.prototype.postMessage;
MessagePort.prototype.postMessage = function(data, ...rest) {
  if (data.type === 'DIAGNOSTIC' || data.type === 'BACKEND_READY') globalThis.postMessage(data);
  return send.call(this, data, ...rest);
};
const write = OPFSStore.prototype.write;
OPFSStore.prototype.write = function(receipt, bytes) {
  if (receipt.index > 0) throw new DOMException('quota', 'QuotaExceededError');
  return write.call(this, receipt, bytes);
};`);
  const server = await startFixtureServer({contentModule: await compile("export {createContentSession} from './src/content-io/client.ts';"),
    modules: {"failed.mjs": worker, "healthy.mjs": await compile("import './src/content-io/worker.ts';")}});
  const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity, identityKind}) => {
      const url = "/__test__/content.mjs";
      const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
      const samples = [], counts = [], events: {type: string; operation?: string; codeNumber?: number; backend?: string}[] = [];
      for (const script of ["failed", "healthy"]) {
        const worker = new Worker(`/__test__/${script}.mjs`, {type: "module"});
        worker.onmessage = ({data}) => events.push(data);
        const session = await createContentSession(worker,
          {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
        try {
          const source = {identity: identityKind === "FILE_SHA256" ? identity.identity :
            {kind: "INDEX_ENTRY" as const, projectDigest: "a".repeat(64), logicalPath: "data/game.bin"}, sizeBytes: identity.sizeBytes,
            url: `${location.origin}/objects/multi-tail/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
            etagPolicy: identityKind === "FILE_SHA256" ? "EXPECTED_SHA256" : "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
          const policy = {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER,
            workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
          const reader = await session.open(source, policy);
          // Block 1 triggers OPFS failure; block 2 is committed in the fallback store.
          for (const index of [0, 1, 2, 3]) {
            const bytes = new Uint8Array(17); await reader.readInto(index * 262144, bytes);
            if (index === 2) samples.push(Array.from(bytes));
          }
          const added = await session.open({...source, purpose: "FIRMWARE"}, policy);
          await added.readInto(2 * 262144, new Uint8Array(17));
          await added.readInto(3 * 262144, new Uint8Array(17));
          counts.push((await (await fetch("/__test__/requests/game")).json() as unknown[]).length);
        } finally {await session.close();}
      }
      const objects = await new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("retrom-content-io-v1");
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction("objects"), count = tx.objectStore("objects").count();
          tx.oncomplete = () => {db.close(); resolve(count.result);}; tx.onerror = () => {db.close(); reject(tx.error);};
        };
        request.onerror = () => reject(request.error);
      });
      return {samples, counts, objects, events};
    }, {identity, identityKind});
    expect(result.events.filter(event => event.type === "DIAGNOSTIC" && event.codeNumber !== 0)).toEqual([expect.objectContaining({operation: "CACHE_WRITE", codeNumber: 12})]);
    expect(result.objects).toBe(2);
    expect(result.samples[1]).toEqual(result.samples[0]);
    expect(result.counts[1]).toBe(result.counts[0]);
  } finally {await server.close();}
});
}
