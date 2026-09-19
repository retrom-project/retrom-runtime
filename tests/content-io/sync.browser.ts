import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (name: string, banner = "") => (await build({entryPoints: [fileURLToPath(new URL(`../../src/content-io/${name}.ts`, import.meta.url))],
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022", banner: {js: banner}})).outputFiles[0].text;
test("[BR-02] BROWSER/blocking [BR-03] BROWSER/blocking [X-23] BROWSER/consecutive-slots [X-21] BROWSER/closed-l1 @S08", async ({page}) => {
  const simulator = `import {createSyncContentReader} from './sync-client.mjs';
let reader;
self.onmessage = ({data}) => {
  try {
    if (data.options) {
      reader = createSyncContentReader(data.options);
      const first = new Uint8Array(32), high = new Uint8Array(32);
      reader.readInto(262136, first); reader.readInto(4295229424, high);
      self.postMessage({first: Array.from(first), high: Array.from(high)});
    } else {
      const errors = [];
      for (const read of [() => reader.tryReadInto(262136, new Uint8Array(1)), () => reader.readInto(0, new Uint8Array())]) {
        try {read(); errors.push('success');} catch (error) {errors.push(error.message);}
      }
      reader.close(); self.postMessage({errors});
    }
  } catch (error) {self.postMessage({failure: error.message});}
};`;
  const server = await startFixtureServer({contentModule: await bundle("client"), modules: {"worker.mjs": await bundle("worker", "Object.defineProperty(globalThis, 'indexedDB', {value: undefined});"),
    "sync-client.mjs": await bundle("sync-client"), "simulator.mjs": simulator}});
  const identity = server.register({id: "game", fixtureId: "big-offset", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity}) => {
      const moduleUrl = "/__test__/content.mjs";
      const {createContentSession} = await import(moduleUrl) as typeof import("../../src/content-io/client.js");
      const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
      const simulator = new Worker("/__test__/simulator.mjs", {type: "module"});
      const next = () => new Promise<Record<string, unknown>>((resolve) => {simulator.onmessage = ({data}) => resolve(data as Record<string, unknown>);});
      try {
        const handle = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/big-offset/game`,
          purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT", },
        {mode: "RANGE", bridge: "SYNC_WORKER", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", });
        const options = await session.createSyncChannel(handle.id);
        const read = next(); simulator.postMessage({options}, [options.port]); const values = await read;
        await session.close(); const closed = next(); simulator.postMessage({checkClosed: true});
        return {values, closed: await closed, stats: session.stats};
      } finally {await session.close(); simulator.terminate();}
    }, {identity});
    expect(result.values.failure).toBeUndefined();
    const byteAt = (n: number) => (n % 251 + 17 * (Math.floor(n / 251) % 251) + 31 * (Math.floor(n / 65536) % 251) + 17) % 256;
    expect(result.values.first).toEqual(Array.from({length: 32}, (_, n) => byteAt(262136 + n)));
    expect(result.values.high).toEqual(Array.from({length: 32}, (_, n) => byteAt(4295229424 + n)));
    expect(result.closed.errors).toEqual(["CONTENT_IO_ABORTED", "CONTENT_IO_ABORTED"]);
    expect(server.requests("game").map((request) => request.range)).toEqual(["bytes=0-262143", "bytes=262144-524287", "bytes=4294967296-4295229439", "bytes=4295229440-4295491583"]);
    expect(result.stats).toMatchObject({pending: 0, channels: 0, lruBytes: 0});
  } finally {await server.close();}
});
