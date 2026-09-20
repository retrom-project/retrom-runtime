import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile = async (name: string) => (await build({entryPoints: [`src/content-io/${name}.ts`], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;

for (const failure of ["identity", "host-close"] as const) {
  test(`[X-21] BROWSER/async-${failure} revokes cached and zero-byte reads @S05`, async ({page}) => {
    const server = await startFixtureServer({contentModule: await compile("client"), modules: {"worker.mjs": await compile("worker")}});
    const scenario = {id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
      delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null};
    const identity = server.register(scenario);
    server.register({...scenario, id: "changed", behavior: "STATUS_412"});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async ({identity, failure}) => {
        const url = "/__test__/content.mjs";
        const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
        try {
          const source = {identity: identity.identity, sizeBytes: identity.sizeBytes,
            url: `${location.origin}/objects/multi-tail/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
            etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
          const policy = {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER,
            workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
          const first = await session.open(source, policy), second = await session.open(source, policy);
          const output = new Uint8Array(1); await first.readInto(0, output);
          const warm = second.tryReadInto(0, output), errors = [];
          if (failure === "identity") {
            const changed = await session.open({...source, url: `${location.origin}/objects/multi-tail/changed`}, policy);
            try {await changed.readInto(262144, output);} catch (error) {errors.push((error as Error).message);}
          } else {await session.close();}
          for (const reader of [first, second]) for (const length of [0, 1]) {
            try {reader.tryReadInto(0, new Uint8Array(length)); errors.push("UNEXPECTED_SUCCESS");}
            catch (error) {errors.push((error as Error).message);}
          }
          const cachedBytes = session.stats.lruBytes; await session.close();
          return {warm, errors, cachedBytes, stats: session.stats};
        } finally {await session.close();}
      }, {identity, failure});
      expect(result.warm).toBe(1);
      expect(result.errors).toEqual(Array(failure === "identity" ? 5 : 4).fill(
        failure === "identity" ? "CONTENT_IO_IDENTITY_CHANGED" : "CONTENT_IO_ABORTED"));
      expect(result.cachedBytes).toBe(0); expect(result.stats).toMatchObject({pending: 0, channels: 0, files: 0});
    } finally {await server.close();}
  });
}
