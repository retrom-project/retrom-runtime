import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";

async function bundle(contents: string) {
  return (await build({stdin: {contents, resolveDir: process.cwd(), loader: "ts"},
    bundle: true, format: "esm", platform: "browser", write: false})).outputFiles[0].text;
}

test("MAME blob workers give Emscripten an absolute Wasm location even with preloaded bytes", async ({page}) => {
  const server = await startFixtureServer({contentModule: await bundle("export {MameWorkerClient} from './src/mame/worker-client.ts';")});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async () => {
      const url = "/__test__/content.mjs";
      const {MameWorkerClient} = await import(url) as typeof import("../../src/mame/worker-client.js");
      const client = new MameWorkerClient();
      const code = `export default async options => {
        const location = options.locateFile ? options.locateFile('mame-common.wasm') : new URL('mame-common.wasm', import.meta.url).href;
        throw new Error('LOCATOR_PROBE:' + location);
      };`;
      try {
        await client.request("BOOT", {code: new TextEncoder().encode(code), wasm: Uint8Array.of(0), family: Uint8Array.of(0),
          assetBaseURL: "https://provider.test/assets/mame/"});
        return "unexpected success";
      } catch (error) {return (error as Error).message;}
      finally {client.close();}
    });
    expect(result).toBe("LOCATOR_PROBE:https://provider.test/assets/mame/mame-common.wasm");
  } finally {await server.close();}
});

test("MAME media uses bounded synchronous ranges and reuses persistent blocks in a new instance", async ({page}) => {
  const contentModule = await bundle(`export {createContentSession} from './src/content-io/client.ts';
    export {mameArcadeTarget} from './src/providers/retrom-runtime/mame-declaration.ts';`);
  const mediaWorker = await bundle(`import {mountMameMedia} from './src/mame/media-fs.ts';
    import {createSyncContentReader} from './src/content-io/sync-client.ts';
    self.onmessage = ({data}) => {
      const reader = createSyncContentReader(data.channel);
      try {
        const node = {node_ops: {getattr: () => ({size: 0})}, stream_ops: {}};
        const fs = {mkdirTree() {}, writeFile() {}, chmod() {}, lookupPath: () => ({node}),
          ErrnoError: Error, ignorePermissions: true};
        mountMameMedia(fs, 'sample/disk.chd', data.size, reader);
        const bytes = new Uint8Array(32);
        node.stream_ops.read({}, bytes, 0, bytes.length, data.offset);
        self.postMessage({bytes: [...bytes], size: node.node_ops.getattr().size});
      } catch (error) {self.postMessage({error: error.message});}
      finally {reader.close();}
    };`);
  const server = await startFixtureServer({contentModule, modules: {"media.mjs": mediaWorker,
    "worker.mjs": await bundle("import './src/content-io/worker.ts';")}});
  const identity = server.register({id: "disk", fixtureId: "big-offset", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async identity => {
      const url = "/__test__/content.mjs";
      const api = await import(url) as typeof import("./target-session.js") &
        typeof import("../../src/providers/retrom-runtime/mame-declaration.js");
      const policy = api.mameArcadeTarget.contentIO.media;
      const counts: number[] = [], values: unknown[] = [], backends: string[] = [];
      for (let instance = 0; instance < 2; instance++) {
        const session = await api.createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]},
          {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
        const worker = new Worker("/__test__/media.mjs", {type: "module"});
        try {
          const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes,
            url: `${location.origin}/objects/big-offset/disk`, purpose: "GAME", transport: "RANGE_REQUIRED",
            etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT"}, policy);
          const channel = await session.createSyncChannel(reader.id);
          values.push(await new Promise(resolve => {
            worker.onmessage = ({data}) => resolve(data);
            worker.postMessage({channel, size: identity.sizeBytes, offset: 4295229424}, [channel.port]);
          }));
        } finally {worker.terminate(); await session.close();}
        backends.push(session.stats.backend);
        counts.push((await (await fetch("/__test__/requests/disk")).json() as unknown[]).length);
      }
      return {counts, values, backends};
    }, identity);
    expect(result.backends.every(backend => ["OPFS", "CACHE_BLOCKS"].includes(backend))).toBe(true);
    expect(result.counts[0]).toBeGreaterThan(0);
    expect(result.counts[1]).toBe(result.counts[0]);
    const offset = 4295229424;
    const bytes = Array.from({length: 32}, (_, index) => {
      const value = offset + index;
      return (value % 251 + 17 * (Math.floor(value / 251) % 251) + 31 * (Math.floor(value / 65536) % 251) + 17) % 256;
    });
    expect(result.values).toEqual(Array(2).fill({bytes, size: identity.sizeBytes}));
    expect(server.requests("disk").every(request => request.range?.startsWith("bytes=") && request.sentBytes <= 262144)).toBe(true);
  } finally {await server.close();}
});
