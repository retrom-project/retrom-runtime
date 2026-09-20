import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const B = 262144;
const compile = async (name: string) => (await build({entryPoints: [`src/content-io/${name}.ts`], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;

test("[ST-01] BROWSER/window-change reuses old blocks and fetches only the holes across Sessions @S06", async ({page}) => {
  const server = await startFixtureServer({contentModule: await compile("client"), modules: {"worker.mjs": await compile("worker")}});
  const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity, B}) => {
      const url = "/__test__/content.mjs";
      const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
      const cases = [
        {policy: {smallFileThresholdBytes: 0, networkWindowBytes: B}, offsets: [B, 2 * B, 3 * B]},
        {policy: {smallFileThresholdBytes: 4 * B, networkWindowBytes: 5 * B}, offsets: [0, B, 2 * B]},
        {policy: {smallFileThresholdBytes: B - 1, networkWindowBytes: 3 * B}, offsets: [0, B, 2 * B, 3 * B]},
      ], counts = [], backends = [], samples = [];
      for (const item of cases) {
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: item.policy});
        try {
          const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes,
            url: `${location.origin}/objects/multi-tail/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
            etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", },
          {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER,
            workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", });
          for (const offset of item.offsets) {
            const bytes = new Uint8Array(1); await reader.readInto(offset, bytes); samples.push({offset, value: bytes[0]});
          }
          backends.push(session.stats.backend);
          counts.push((await (await fetch("/__test__/requests/game")).json() as unknown[]).length);
        } finally {await session.close();}
      }
      return {counts, backends, samples};
    }, {identity, B});
    expect(result.backends).toEqual(["OPFS", "OPFS", "OPFS"]);
    expect(result.counts).toEqual([3, 4, 4]);
    expect(server.requests("game").map(request => request.range)).toEqual([
      `bytes=${B}-${2 * B - 1}`, `bytes=${2 * B}-${3 * B - 1}`, `bytes=${3 * B}-${identity.sizeBytes - 1}`, `bytes=0-${B - 1}`,
    ]);
    for (const {offset, value} of result.samples) {
      expect(value).toBe((offset % 251 + 17 * (Math.floor(offset / 251) % 251) + 31 * (Math.floor(offset / 65536) % 251) + 17) % 256);
    }
  } finally {await server.close();}
});
