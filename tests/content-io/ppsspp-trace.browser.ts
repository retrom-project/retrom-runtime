import type {ContentDiagnostic} from "../../src/content-io/session-diagnostics.js";
import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
import {coreFixturePath} from "./core-fixture.js";
import {abi, contractSha256} from "../../src/content-io/identity.js";
import type {ContentSessionService} from "../../src/content-io/service.js";
const compile = async (file: string) => (await build({entryPoints: [file], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022",
  banner: {js: "Object.defineProperty(globalThis, 'indexedDB', {value: undefined});"}})).outputFiles[0].text;
test("[IO-10] BROWSER/ppsspp-trace-10000 [BR-08] BROWSER/ppsspp-trace-close actual fork disc bridge and sync Worker", async ({page}, testInfo) => {
  test.setTimeout(180000);
  const server = await startFixtureServer({contentModule: await compile("src/content-io/client.ts"), modules: {
    "worker.mjs": await compile("tests/content-io/trace-worker.ts"), "consumer.mjs": await compile("tests/content-io/ppsspp-trace-worker.ts"),
    "sync-client.mjs": await compile("src/content-io/sync-client.ts"),
    "ppsspp-content.mjs": await compile(await coreFixturePath("ppsspp", "libretro/retrom/ppsspp-content.mjs")),
    "ppsspp-disc.mjs": await compile(await coreFixturePath("ppsspp", "libretro/retrom/ppsspp-disc.mjs"))}});
  const identity = server.register({id: "trace", fixtureId: "cache-trace", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity, abi, contractSha256}) => {
      const url = "/__test__/content.mjs", {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
      const worker = new Worker("/__test__/worker.mjs", {type: "module"}), consumer = new Worker("/__test__/consumer.mjs", {type: "module"});
      const diagnostics: ContentDiagnostic[] = [];
      const session = await createContentSession(worker, {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {onDiagnostic: value => diagnostics.push(value)});
      const stats = () => new Promise<ContentSessionService["stats"]>((resolve, reject) => {
        const id = crypto.randomUUID(), timer = setTimeout(() => {worker.removeEventListener("message", listener); reject(new Error("TRACE_STATS_TIMEOUT"));}, 5000);
        const listener = ({data}: MessageEvent) => {if (data.id === id) {clearTimeout(timer); worker.removeEventListener("message", listener); resolve(data.stats);}};
        worker.addEventListener("message", listener); worker.postMessage({type: "TEST_STATS", id});
      });
      let blob: string | undefined;
      try {
        if (identity.identity.kind !== "FILE_SHA256") {throw new Error("TRACE_IDENTITY");}
        const sha256 = identity.identity.sha256;
        const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/cache-trace/trace`,
          purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "REQUIRED_EXACT"},
        {mode: "RANGE", bridge: "SYNC_WORKER", result: "READER", maxFileBytes: 2147483647, workspace: "NONE", writes: "DENY", contentLengthPolicy: "REQUIRED_EXACT"});
        const channel = await session.createSyncChannel(reader.id);
        blob = URL.createObjectURL(new Blob([await (await fetch("/__test__/sync-client.mjs")).text()], {type: "text/javascript"}));
        const snapshots: {read: number; l1: number; service: ContentSessionService["stats"]}[] = [];
        await new Promise<void>((resolve, reject) => {
          consumer.onmessage = ({data}) => {
            if (data.kind === "error") {reject(new Error(data.message));}
            if (data.kind === "done") {resolve();}
            if (data.kind === "snapshot") {void stats().then(service => {
              snapshots.push({read: data.read, l1: data.l1, service}); consumer.postMessage({kind: "continue"});
            }, reject);}
          };
          consumer.onerror = () => reject(new Error("TRACE_CONSUMER_FAILED"));
          consumer.postMessage({source: {sha256, sizeBytes: identity.sizeBytes}, content: {...channel, abi, contractSha256, syncClientUrl: blob}}, [channel.port]);
        });
        await reader.close();
        const consumerClosed = await new Promise<{failure: string; l1: number; l1Peak: number}>((resolve, reject) => {
          consumer.onmessage = ({data}) => data.kind === "closed" ? resolve(data) : reject(new Error("TRACE_CLOSE"));
          consumer.postMessage({kind: "close"});
        });
        let closed = await stats();
        for (let retry = 0; retry < 100 && (closed.pending || closed.temporaryBytes); retry++) {await new Promise(resolve => setTimeout(resolve, 10)); closed = await stats();}
        return {snapshots, consumerClosed, closed, diagnostics};
      } finally {if (blob) {URL.revokeObjectURL(blob);} await session.close(); consumer.terminate();}
    }, {identity, abi, contractSha256});
    await testInfo.attach("ppsspp-trace-metrics", {body: JSON.stringify({result, requests: server.requests("trace")}), contentType: "application/json"});
    expect(result.snapshots).toHaveLength(40);
    for (const snapshot of result.snapshots) {
      expect(snapshot.l1).toBeGreaterThan(0); expect(snapshot.l1).toBeLessThanOrEqual(2097152);
      expect(snapshot.l1 + snapshot.service.lruBytes).toBeLessThanOrEqual(16777216);
      expect(snapshot.service.temporaryBytes).toBeLessThanOrEqual(8388608);
      expect(snapshot.service.outputBytes).toBeLessThanOrEqual(4194304); expect(snapshot.service.active).toBeLessThanOrEqual(4);
    }
    expect(result.consumerClosed).toMatchObject({failure: "CONTENT_IO_ABORTED", l1: 0});
    expect(result.consumerClosed.l1Peak + result.closed.peaks.lruBytes).toBeLessThanOrEqual(16777216);
    expect(result.closed.peaks.temporaryBytes).toBeLessThanOrEqual(8388608);
    expect(result.closed.peaks.outputBytes).toBeLessThanOrEqual(4194304);
    expect(result.closed.peaks.active).toBeLessThanOrEqual(4);
    expect(result.closed.peaks.queued).toBeLessThanOrEqual(256);
    expect(result.closed).toMatchObject({active: 0, pending: 0, queued: 0, waiters: 0, channels: 0, files: 0, leases: 0, temporaryBytes: 0});
    const final = result.diagnostics.at(-1);
    expect(final).toMatchObject({operation: "CLOSE", codeNumber: 0, counts: {cacheBytesL1: 0, cacheBytesL2: 0, syncBufferBytes: 0,
      temporaryBytes: 0, outputCreditBytes: 0, inflight: 0, queued: 0, waiters: 0, channels: 0, leases: 0,
      peakSyncBufferBytes: 262208, peakCacheBytesL1: 2097152, peakChannels: 1}});
    expect(final?.counts.memoryHitBytes).toBeGreaterThan(0);
    const requests = server.requests("trace"); expect(requests.length).toBeGreaterThan(32);
    expect(result.closed.rangeRequests).toBe(requests.length);
    expect(result.closed.networkBytes).toBe(requests.reduce((sum, request) => sum + request.sentBytes, 0));
  } finally {await server.close();}
});
