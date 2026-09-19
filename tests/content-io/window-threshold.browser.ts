import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const B = 262144;
const compile = async (name: string) => (await build({entryPoints: [`src/content-io/${name}.ts`], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022",
  banner: {js: "Object.defineProperty(globalThis, 'indexedDB', {value: undefined});"}})).outputFiles[0].text;

for (const threshold of [B, 4 * B]) {
  for (const relation of ["below", "exact", "above"]) {
    test(`[IO-17] BROWSER/small-${threshold}-${relation} authorizes whole fetching before sending HTTP @S03`, async ({page}) => {
      const server = await startFixtureServer({contentModule: await compile("client"), modules: {"worker.mjs": await compile("worker")}});
      const fixtureId = `${relation}-${threshold === B ? "block" : "small"}`;
      const identity = server.register({id: "game", fixtureId, behavior: "NORMAL", seed: 17,
        delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
      try {
        await page.goto(`${server.origin}/__test__/page`);
        const value = await page.evaluate(async ({identity, threshold, fixtureId, B}) => {
          const url = "/__test__/content.mjs";
          const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
          const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
            {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: threshold, networkWindowBytes: 3 * B}});
          try {
            const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes,
              url: `${location.origin}/objects/${fixtureId}/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
              etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"},
            {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER,
              workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"});
            const output = new Uint8Array(1); await reader.readInto(0, output); return output[0];
          } finally {await session.close();}
        }, {identity, threshold, fixtureId, B});
        expect(value).toBe(17);
        expect(server.requests("game").map(request => request.range)).toEqual([
          identity.sizeBytes <= threshold ? null : `bytes=0-${Math.min(3 * B, identity.sizeBytes) - 1}`,
        ]);
        expect(server.requests("game")[0].ifMatch).toBe(identity.etag);
      } finally {await server.close();}
    });
  }
}

for (const [behavior, threshold, expected] of [
  ["IGNORE_RANGE", 0, "CONTENT_IO_RANGE_UNSUPPORTED"], ["CHANGED_ETAG", 4 * B, "CONTENT_IO_IDENTITY_CHANGED"],
  ["WRONG_LENGTH", 4 * B, "CONTENT_IO_LENGTH_MISMATCH"], ["CORRUPT_BODY", 4 * B, "CONTENT_IO_CHECKSUM_MISMATCH"],
] as const) {
  test(`[IO-17] BROWSER/small-fault-${behavior} retains representation and identity validation @S03`, async ({page}) => {
    const server = await startFixtureServer({contentModule: await compile("client"), modules: {"worker.mjs": await compile("worker")}});
    const identity = server.register({id: "game", fixtureId: "multi-tail", behavior, seed: 17,
      delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async ({identity, threshold, B}) => {
        const url = "/__test__/content.mjs";
        const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: threshold, networkWindowBytes: 5 * B}});
        try {
          const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes,
            url: `${location.origin}/objects/multi-tail/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
            etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"},
          {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER,
            workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"});
          const output = new Uint8Array(1).fill(199);
          const error = await reader.readInto(0, output).then(() => "UNEXPECTED_SUCCESS", error => (error as Error).message);
          return {error, value: output[0], cacheBytes: session.stats.lruBytes};
        } finally {await session.close();}
      }, {identity, threshold, B});
      expect(result).toEqual({error: expected, value: 199, cacheBytes: 0});
    } finally {await server.close();}
  });
}
