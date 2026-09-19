import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
import type {ContentDiagnostic} from "../../src/content-io/session-diagnostics.js";
const compile = async (file: string) => (await build({entryPoints: [file], bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;

test("[X-29] BROWSER/session-diagnostics reports logical persistent/memory hits across real Worker Sessions", async ({page}, info) => {
  const server = await startFixtureServer({contentModule: await compile("src/content-io/client.ts"), modules: {"worker.mjs": await compile("src/content-io/worker.ts")}});
  const identity = server.register({id: "metrics", fixtureId: "above-small", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async identity => {
      const url = "/__test__/content.mjs", {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
      const result: ContentDiagnostic[][] = [];
      for (let run = 0; run < 2; run++) {
        const diagnostics: ContentDiagnostic[] = []; result.push(diagnostics);
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {onDiagnostic: value => diagnostics.push(value)});
        try {
          const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes,
            url: `${location.origin}/objects/above-small/metrics`, purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "REQUIRED_EXACT"},
          {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: identity.sizeBytes, workspace: "NONE", writes: "DENY", contentLengthPolicy: "REQUIRED_EXACT"});
          await reader.readInto(7, new Uint8Array(13)); await reader.readInto(11, new Uint8Array(19));
          if (reader.tryReadInto(15, new Uint8Array(23)) !== 23) {throw new Error("METRICS_L1_MISS");}
          await reader.readInto(262144 + 7, new Uint8Array(11)); await reader.close();
        } finally {await session.close();}
      }
      return result;
    }, identity);
    await info.attach("session-diagnostics", {body: JSON.stringify({result, requests: server.requests("metrics")}), contentType: "application/json"});
    expect(result[0].at(-1)).toMatchObject({operation: "CLOSE", codeNumber: 0, counts: {networkBytes: 524288, rangeRequests: 1, memoryHitBytes: 53, persistentHitBytes: 0}});
    expect(result[1].at(-1)).toMatchObject({operation: "CLOSE", codeNumber: 0, counts: {networkBytes: 0, rangeRequests: 0, memoryHitBytes: 42, persistentHitBytes: 24}});
    for (const run of result) {
      expect(run.at(-1)?.counts).toMatchObject({cacheBytesL1: 0, cacheBytesL2: 0, temporaryBytes: 0, outputCreditBytes: 0, syncBufferBytes: 0,
        inflight: 0, queued: 0, waiters: 0, channels: 0, leases: 0, peakCacheBytesL1: 524288, peakCacheBytesL2: 524288});
    }
    expect(server.requests("metrics")).toHaveLength(1);
  } finally {await server.close();}
});
