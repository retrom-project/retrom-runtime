import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile = async (contents: string) => (await build({stdin: {contents, resolveDir: process.cwd()},
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
const B = 262144;
for (const windowBytes of [3 * B, 8 * B]) for (const backend of ["quota", "denied", "hang"]) {
  test(`[IO-12] BROWSER/window-budget-${windowBytes}-${backend} concurrent windows share bounded credits @S04`, async ({page}) => {
    const worker = await compile(`import {BufferCredits} from './src/content-io/credits.ts';
import {OPFSStore} from './src/content-io/store/opfs.ts';
import './src/content-io/worker.ts';
const delayedWrites = []; let finishWrites = false;
${backend === "denied" ? "Object.defineProperty(globalThis, 'indexedDB', {value: undefined});" : backend === "hang" ? "OPFSStore.prototype.write = () => finishWrites ? Promise.resolve() : new Promise(resolve => delayedWrites.push(resolve));" : "OPFSStore.prototype.write = async () => {throw new DOMException('quota', 'QuotaExceededError');};"}
const reserve = BufferCredits.prototype.reserve, credits = new Set();
let peak = 0, output = 0;
BufferCredits.prototype.reserve = async function(...args) {
  credits.add(this); const release = await reserve.apply(this, args);
  peak = Math.max(peak, this.stats.temporaryBytes); output = Math.max(output, this.stats.outputBytes);
  return release;
};
addEventListener('message', ({data}) => {
  if(data?.testBudget) postMessage({peak: Math.max(peak, ...[...credits].map(credit => credit.peaks.temporaryBytes)), output, stats: [...credits].map(credit => credit.stats)});
  if(data?.finishWrites) {finishWrites = true; for (const resolve of delayedWrites.splice(0)) resolve(); postMessage({writesReleased: true});}
});`);
    const server = await startFixtureServer({contentModule: await compile("export {createContentSession} from './src/content-io/client.ts';"), modules: {"worker.mjs": worker}});
    const identity = server.register({id: "game", fixtureId: "big-offset", behavior: "NORMAL", seed: 17,
      delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async ({identity, windowBytes, B}) => {
        const url = "/__test__/content.mjs";
        const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
        const worker = new Worker("/__test__/worker.mjs", {type: "module"});
        const session = await createContentSession(worker, {storageOrigin: location.origin, allowedOrigins: [location.origin]},
          {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: windowBytes}});
        try {
          const source = {identity: identity.identity, sizeBytes: identity.sizeBytes,
            url: `${location.origin}/objects/big-offset/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
            etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
          const policy = {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER,
            workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
          const readers = await Promise.all(Array.from({length: 8}, () => session.open(source, policy)));
          const samples = await Promise.all(readers.map(async (reader, index) => {
            const offset = (index % 4) * windowBytes + (index >= 4 ? B : 0), bytes = new Uint8Array(B + 17);
            await reader.readInto(offset, bytes);
            for (let n = 0; n < bytes.length; n++) {
              const position = offset + n;
              if (bytes[n] !== (position % 251 + 17 * (Math.floor(position / 251) % 251) + 31 * (Math.floor(position / 65536) % 251) + 17) % 256) throw new Error("BYTES_MISMATCH");
            }
            return bytes.length;
          }));
          const budget = await new Promise<{peak: number; output: number; stats: {temporaryBytes: number; waiting: number; cacheWriteBytes: number}[]}>(resolve => {
            worker.addEventListener("message", event => resolve(event.data), {once: true}); worker.postMessage({testBudget: true});
          });
          // Observe retained optional-write credits first, then release injected I/O before graceful shutdown.
          await new Promise<void>(resolve => {
            worker.addEventListener("message", () => resolve(), {once: true}); worker.postMessage({finishWrites: true});
          });
          return {samples, budget, backend: session.stats.backend};
        } finally {await session.close();}
      }, {identity, windowBytes, B});
      expect(result.samples).toEqual(Array(8).fill(B + 17));
      expect(result.budget.peak).toBeGreaterThanOrEqual(windowBytes + 2 * B);
      expect(result.budget.peak).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(result.budget.output).toBeLessThanOrEqual(4 * 1024 * 1024);
      expect(result.budget.stats.every(stat => stat.waiting === 0)).toBe(true);
      if (backend === "hang") expect(result.budget.stats.some(stat => stat.cacheWriteBytes >= B)).toBe(true);
      else expect(result.backend).toBe(backend === "denied" ? "MEMORY" : "CACHE_BLOCKS");
      const ranges = server.requests("game").map(request => request.range);
      const adjacent = `bytes=${4 * windowBytes}-${5 * windowBytes - 1}`;
      expect(ranges.filter(range => range !== adjacent).sort()).toEqual(
        Array.from({length: 4}, (_, index) => `bytes=${index * windowBytes}-${(index + 1) * windowBytes - 1}`).sort());
      expect(new Set(ranges).size).toBe(ranges.length);
      if (windowBytes === 8 * B) {expect(ranges).toHaveLength(4);}
      else {expect(ranges.length).toBeLessThanOrEqual(5);}
    } finally {await server.close();}
  });
}
