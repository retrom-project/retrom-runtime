import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {coreFixturePath} from "./core-fixture.js";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (file: string) => (await build({entryPoints: [file], bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
const runtime = (file: string) => fileURLToPath(new URL(`../../src/${file}.ts`, import.meta.url));
test("[BR-06] BROWSER/kirikiri-fork VLFS uses public Worker, keeps metadata lazy and remote raw bytes out of private LRU @S15", async ({page}) => {
  const server = await startFixtureServer({contentModule: await bundle(runtime("content-io/client")), modules: {
    "worker.mjs": await bundle(runtime("content-io/worker")), "vlfs.mjs": await bundle(await coreFixturePath("kirikiri2", "platforms/web/vlfs.js")),
  }});
  const identity = server.register({id: "game", fixtureId: "big-offset", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity}) => {
      const clientUrl = "/__test__/content.mjs", vlfsUrl = "/__test__/vlfs.mjs";
      const {createContentSession} = await import(clientUrl) as typeof import("../../src/content-io/client.js"); await import(vlfsUrl);
      const vlfs = (window as unknown as {VLFS: {init(): Promise<void>; registerContent(path: string, handle: unknown, reader: unknown): void;
        open(path: string, mode: number): number; seek(fd: number, offset: number, whence: number): number; read(fd: number, size: number): Promise<Uint8Array>;
        readCached(fd: number, size: number): Uint8Array | null; stats(): {blockCacheBytes: number}; close(fd: number): number}}).VLFS;
      await vlfs.init();
      const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
      try {
        const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/big-offset/game`,
          purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT", },
        {mode: "RANGE", bridge: "VLFS", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER, workspace: "NONE", writes: "SESSION_OVERLAY", contentLengthPolicy: "EXACT_IF_PRESENT", });
        vlfs.registerContent("/Data.xp3", {fileId: reader.id, sizeBytes: reader.sizeBytes}, reader);
        const fd = vlfs.open("/data.xp3", 0); vlfs.seek(fd, 4294967327, 0);
        const cold = vlfs.readCached(fd, 32), bytes = Array.from(await vlfs.read(fd, 32));
        vlfs.seek(fd, 4294967327, 0); const warm = Array.from(vlfs.readCached(fd, 32)!);
        const privateBytes = vlfs.stats().blockCacheBytes; await session.close();
        let failure = ""; try {vlfs.readCached(fd, 0);} catch (error) {failure = (error as Error).message;}
        vlfs.close(fd); return {cold, bytes, warm, privateBytes, failure};
      } finally {await session.close();}
    }, {identity});
    const byteAt = (n: number) => (n % 251 + 17 * (Math.floor(n / 251) % 251) + 31 * (Math.floor(n / 65536) % 251) + 17) % 256;
    expect(result.bytes).toEqual(Array.from({length: 32}, (_, index) => byteAt(4294967327 + index)));
    expect(result).toMatchObject({cold: null, warm: result.bytes, privateBytes: 0, failure: "CONTENT_IO_ABORTED"});
    expect(server.requests("game")).toHaveLength(1);
  } finally {await server.close();}
});
