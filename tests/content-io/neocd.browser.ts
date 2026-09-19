import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {startFixtureServer} from "./fixture-server.mjs";
test("[BR-01] BROWSER/neocd [ST-01] BROWSER/neocd [ST-03] BROWSER/neocd public Worker facade @S10", async ({page}) => {
  const bundle = async (path: string, banner = "") => (await build({entryPoints: [fileURLToPath(new URL(`../../src/${path}.ts`, import.meta.url))],
    bundle: true, format: "esm", platform: "browser", write: false, target: "es2022", banner: {js: banner}})).outputFiles[0].text;
  const server = await startFixtureServer({contentModule: await bundle("content-io/client"), modules: {
    "neocd.mjs": await bundle("providers/emulatorjs/neocd-range"), "worker.mjs": await bundle("content-io/worker"),
    "memory.mjs": await bundle("content-io/worker", "Object.defineProperty(globalThis, 'indexedDB', {value: undefined});"),
  }});
  const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity}) => {
      const clientPath = "/__test__/content.mjs", facadePath = "/__test__/neocd.mjs";
      const {createContentSession} = await import(clientPath) as typeof import("../../src/content-io/client.js");
      const {createNeoCDRange} = await import(facadePath) as typeof import("../../src/providers/emulatorjs/neocd-range.js");
      if (identity.identity.kind !== "FILE_SHA256") {throw new Error("fixture identity");}
      const results = [];
      for (const worker of ["worker.mjs", "worker.mjs", "memory.mjs"]) {
        const session = await createContentSession(new Worker(`/__test__/${worker}`, {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
        try {
          const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/multi-tail/game`,
            purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", },
          {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: 2147483647, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", });
          const facade = createNeoCDRange({sha256: identity.identity.sha256, sizeBytes: identity.sizeBytes}, reader, () => {});
          const before = (await (await fetch("/__test__/requests/game")).json() as unknown[]).length;
          facade.begin(); let idle = false; const barrier = facade.idle().then(() => {idle = true;});
          const cold = facade.read(262140, 19); const snapshot = Array.from(await cold); const during = idle; facade.end(); await barrier;
          const hit = facade.read(262140, 19); const synchronous = hit instanceof Uint8Array;
          const output = await hit; output.fill(255); structuredClone(output, {transfer: [output.buffer]});
          const fresh = Array.from(await facade.read(262140, 19)); const backend = session.stats.backend;
          await facade.dispose(); let closed = ""; try {facade.read(262140, 19);} catch (error) {closed = (error as Error).message;}
          const after = (await (await fetch("/__test__/requests/game")).json() as unknown[]).length;
          results.push({before, after, snapshot, fresh, coldPromise: cold instanceof Promise, synchronous, during, idle, closed, backend});
        } finally {await session.close();}
      }
      return results;
    }, {identity});
    expect(result.map(entry => entry.after - entry.before)).toEqual([2, 0, 2]);
    expect(result.map(entry => entry.backend)).toEqual(["OPFS", "OPFS", "MEMORY"]);
    for (const entry of result) {
      expect(entry).toMatchObject({coldPromise: true, synchronous: true, during: false, idle: true, closed: "CONTENT_IO_ABORTED"});
      expect(entry.fresh).toEqual(entry.snapshot); expect(entry.fresh).toEqual(result[0].fresh);
    }
  } finally {await server.close();}
});
