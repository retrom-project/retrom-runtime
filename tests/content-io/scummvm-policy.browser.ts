import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const B = 262144;
const compile = async (path: string) => (await build({entryPoints: [`src/${path}.ts`], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022",
  banner: {js: "Object.defineProperty(globalThis, 'indexedDB', {value: undefined});"}})).outputFiles[0].text;

for (const threshold of [B, 4 * B]) for (const relation of ["below", "exact", "above"]) {
  test(`[IO-17] BROWSER/scummvm-${threshold}-${relation} uses the frozen Session small-file policy`, async ({page}) => {
    const fixtureId = `${relation}-${threshold === B ? "block" : "small"}`;
    const server = await startFixtureServer({contentModule: await compile("content-io/client"), modules: {
      "files.mjs": await compile("scummvm/files"), "worker.mjs": await compile("content-io/worker"),
    }});
    const identity = server.register({id: "game", fixtureId, behavior: "NORMAL", seed: 17,
      delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const output = await page.evaluate(async ({threshold, fixtureId, sizeBytes}) => {
        const clientPath = "/__test__/content.mjs", filesPath = "/__test__/files.mjs";
        const {createContentSession} = await import(clientPath) as typeof import("../../src/content-io/client.js");
        const {ScummvmFiles} = await import(filesPath) as typeof import("../../src/scummvm/files.js");
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: threshold, networkWindowBytes: 3 * 262144}});
        const files = new ScummvmFiles({schemaVersion: 1, files: [{path: "game.bin", sizeBytes, url: `${location.origin}/objects/${fixtureId}/game`}]}, "a".repeat(64), session);
        try {return Array.from(await files.read("/game/game.bin", 0, 3));} finally {await files.close(); await session.close();}
      }, {threshold, fixtureId, sizeBytes: identity.sizeBytes});
      expect(output).toEqual([17, 18, 19]);
      expect(server.requests("game").map(row => row.range)).toEqual([identity.sizeBytes <= threshold ? null : `bytes=0-${Math.min(3 * B, identity.sizeBytes) - 1}`]);
    } finally {await server.close();}
  });
}
for (const [behavior, error] of [["IGNORE_RANGE", "RANGE_UNSUPPORTED"], ["MISSING_ETAG", "IDENTITY_CHANGED"],
  ["STATUS_412", "IDENTITY_CHANGED"], ["WRONG_LENGTH", "LENGTH_MISMATCH"], ["SHORT_BODY", "LENGTH_MISMATCH"]]) {
  test(`[IO-17] BROWSER/scummvm-fault-${behavior} does not turn invalid acquisition into successful core bytes`, async ({page}) => {
    const server = await startFixtureServer({contentModule: await compile("content-io/client"), modules: {
      "files.mjs": await compile("scummvm/files"), "worker.mjs": await compile("content-io/worker"),
    }});
    const identity = server.register({id: "game", fixtureId: "multi-tail", behavior, seed: 17,
      delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async ({sizeBytes}) => {
        const clientPath = "/__test__/content.mjs", filesPath = "/__test__/files.mjs";
        const {createContentSession} = await import(clientPath) as typeof import("../../src/content-io/client.js");
        const {ScummvmFiles} = await import(filesPath) as typeof import("../../src/scummvm/files.js");
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0}});
        const files = new ScummvmFiles({schemaVersion: 1, files: [{path: "game.bin", sizeBytes, url: `${location.origin}/objects/multi-tail/game`}]}, "a".repeat(64), session);
        try {
          const error = await files.read("/game/game.bin", 0, 3).then(() => "UNEXPECTED", cause => (cause as Error).message);
          return {error, retained: session.stats.lruBytes};
        } finally {await files.close(); await session.close();}
      }, {sizeBytes: identity.sizeBytes});
      expect(result).toEqual({error: `CONTENT_IO_${error}`, retained: 0});
      expect(server.requests("game")).toHaveLength(1);
    } finally {await server.close();}
  });
}
