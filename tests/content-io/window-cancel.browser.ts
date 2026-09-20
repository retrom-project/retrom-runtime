import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const B = 262144;
const compile = async (name: string, banner = "") => (await build({entryPoints: [`src/content-io/${name}.ts`], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022", banner: {js: banner}})).outputFiles[0].text;

for (const all of [false, true]) {
  test(`[IO-08] BROWSER/window-cancel-${all ? "all" : "one"} shares one fetch across distinct blocks @S04`, async ({page}) => {
    const server = await startFixtureServer({contentModule: await compile("client"),
      modules: {"worker.mjs": await compile("worker", "Object.defineProperty(globalThis, 'indexedDB', {value: undefined});")}});
    const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
      delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: "pending"});
    await page.exposeFunction("waitRequest", async () => {await expect.poll(() => server.requests("game").length).toBe(1);});
    await page.exposeFunction("waitPrefetch", async () => {await expect.poll(() => server.requests("game").length).toBe(2);});
    await page.exposeFunction("releaseRequest", () => server.release("pending"));
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async ({identity, all, B}) => {
        const url = "/__test__/content.mjs";
        const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 3 * B}});
        const hooks = globalThis as unknown as {waitRequest(): Promise<void>; waitPrefetch(): Promise<void>; releaseRequest(): Promise<void>};
        try {
          const source = {identity: identity.identity, sizeBytes: identity.sizeBytes,
            url: `${location.origin}/objects/multi-tail/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
            etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
          const policy = {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER,
            workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
          const readers = [await session.open(source, policy), await session.open(source, policy)];
          const controllers = [new AbortController(), new AbortController()], bytes = [new Uint8Array(1), new Uint8Array(1)];
          const reads = readers.map((reader, n) => reader.readInto(n * B, bytes[n], controllers[n].signal).then(() => "OK", error => (error as Error).message));
          await hooks.waitRequest(); controllers[0].abort();
          if (all) controllers[1].abort();
          const first = await reads[0]; await hooks.releaseRequest(); const second = await reads[1];
          if (!all) {await readers[1].readInto(2 * B, new Uint8Array(1)); await hooks.waitPrefetch();}
          await session.close(); return {first, second, samples: bytes.map(value => value[0]), stats: session.stats};
        } finally {await session.close();}
      }, {identity, all, B});
      expect(result.first).toBe("CONTENT_IO_ABORTED"); expect(result.second).toBe(all ? "CONTENT_IO_ABORTED" : "OK");
      expect(result.samples[0]).toBe(0);
      expect(server.requests("game")).toHaveLength(all ? 1 : 2); expect(server.requests("game")[0].range).toBe(`bytes=0-${3 * B - 1}`);
      if (!all) {
        expect(server.requests("game")[1].range).toBe(`bytes=${3 * B}-${identity.sizeBytes - 1}`);
        expect(server.requests("game")[1].sentBytes).toBe(0);
        expect(server.requests("game")[1].disconnected).toBe(true);
      }
      expect(result.stats).toMatchObject({pending: 0, channels: 0, files: 0, lruBytes: 0});
    } finally {server.release("pending"); await server.close();}
  });
}
