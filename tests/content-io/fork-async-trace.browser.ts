import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
import {coreFixturePath} from "./core-fixture.js";
const compile = async (file: string) => (await build({entryPoints: [file], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022",
  banner: {js: "Object.defineProperty(globalThis, 'indexedDB', {value: undefined});"}})).outputFiles[0].text;
for (const kind of ["play", "kirikiri"] as const) {
  test(`[IO-10] BROWSER/${kind}-trace-10000 [BR-08] BROWSER/${kind}-trace-close actual fork facade fixed-seed reads`, async ({page}, testInfo) => {
    test.setTimeout(180000);
    const fork = kind === "play" ? await coreFixturePath("play", "js/retrom/disc-device.mjs") : await coreFixturePath("kirikiri2", "platforms/web/vlfs.js");
    const server = await startFixtureServer({contentModule: await compile("tests/content-io/fork-async-trace.ts"), modules: {
      "worker.mjs": await compile("tests/content-io/trace-worker.ts"), "facade.mjs": await compile(fork)}});
    const identity = server.register({id: "trace", fixtureId: "cache-trace", behavior: "NORMAL", seed: 17,
      delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async ({kind, identity}) => {
        const url = "/__test__/content.mjs", {forkAsyncTrace} = await import(url) as typeof import("./fork-async-trace.js");
        return forkAsyncTrace(kind, {identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/cache-trace/trace`,
          purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"});
      }, {kind, identity});
      await testInfo.attach(`${kind}-trace-metrics`, {body: JSON.stringify({result, requests: server.requests("trace")}), contentType: "application/json"});
      expect(result.snapshots[0].service.networkBytes).toBe(0); expect(result.snapshots).toHaveLength(41);
      for (const snapshot of result.snapshots) {
        expect(snapshot.l1 + snapshot.service.lruBytes).toBeLessThanOrEqual(16777216);
        expect(snapshot.service.temporaryBytes).toBeLessThanOrEqual(8388608);
        expect(snapshot.service.outputBytes).toBeLessThanOrEqual(4194304);
        expect(snapshot.service.active).toBeLessThanOrEqual(4); expect(snapshot.privateBytes).toBe(0);
      }
      if (kind === "kirikiri") {expect(result.synchronousHits).toBeGreaterThan(0);}
      expect(result.l1Peak + result.closed.peaks.lruBytes).toBeLessThanOrEqual(16777216);
      expect(result.closed.peaks.temporaryBytes).toBeLessThanOrEqual(8388608);
      expect(result.closed.peaks.outputBytes).toBeLessThanOrEqual(4194304);
      expect(result.closed.peaks.active).toBeLessThanOrEqual(4);
      expect(result.closed.peaks.queued).toBeLessThanOrEqual(256);
      expect(result.closed).toMatchObject({active: 0, pending: 0, queued: 0, waiters: 0, channels: 0, files: 0, leases: 0, temporaryBytes: 0});
      const requests = server.requests("trace");
      expect(result.closed.rangeRequests).toBe(requests.length);
      expect(result.closed.networkBytes).toBe(requests.reduce((sum, request) => sum + request.sentBytes, 0));
      expect(requests.length).toBeGreaterThan(32);
      expect(requests.every(request => request.method === "GET" && request.range !== null)).toBe(true);
    } finally {await server.close();}
  });
}
