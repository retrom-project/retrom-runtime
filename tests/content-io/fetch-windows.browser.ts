import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const B = 262144;
const compile = async (name: string, banner = "") => (await build({entryPoints: [`src/content-io/${name}.ts`], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022", banner: {js: banner}})).outputFiles[0].text;

for (const policy of [undefined, {smallFileThresholdBytes: 0, networkWindowBytes: 3 * B},
  {smallFileThresholdBytes: B + 1, networkWindowBytes: 5 * B}]) {
  test(`[IO-02] BROWSER/fetch-window-${policy?.networkWindowBytes ?? "default"} keeps demand timing and memory reuse @S04`, async ({page}) => {
    const server = await startFixtureServer({contentModule: await compile("client"),
      modules: {"worker.mjs": await compile("worker", "Object.defineProperty(globalThis, 'indexedDB', {value: undefined});")}});
    const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
      delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async ({identity, policy, B}) => {
        const url = "/__test__/content.mjs";
        const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: policy});
        try {
          const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes,
            url: `${location.origin}/objects/multi-tail/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
            etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", },
          {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER,
            workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", });
          const requests = async () => (await (await fetch("/__test__/requests/game")).json() as unknown[]).length;
          const before = await requests(), samples = [];
          for (const offset of [0, B + 3, identity.sizeBytes - 1, 0, B + 3]) {
            const bytes = new Uint8Array(1); await reader.readInto(offset, bytes); samples.push({offset, value: bytes[0]});
          }
          await session.close(); return {before, samples, stats: session.stats};
        } finally {await session.close();}
      }, {identity, policy, B});
      expect(result.before).toBe(0);
      for (const {offset, value} of result.samples) {
        expect(value).toBe((offset % 251 + 17 * (Math.floor(offset / 251) % 251) + 31 * (Math.floor(offset / 65536) % 251) + 17) % 256);
      }
      const expected = !policy ? [null] : policy.networkWindowBytes > identity.sizeBytes ? [`bytes=0-${identity.sizeBytes - 1}`] :
        [`bytes=0-${policy.networkWindowBytes - 1}`, `bytes=${policy.networkWindowBytes}-${identity.sizeBytes - 1}`];
      expect(server.requests("game").map(request => request.range)).toEqual(expected);
      expect(result.stats).toMatchObject({pending: 0, channels: 0, files: 0});
    } finally {await server.close();}
  });
}
