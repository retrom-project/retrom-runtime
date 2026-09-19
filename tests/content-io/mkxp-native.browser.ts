import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {nativeFixture} from "./native-fixture.js";
import {dirname, join} from "node:path";
import type {ContentSessionService} from "../../src/content-io/service.js";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (file: string) => (await build({entryPoints: [file], bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
test("[BR-05] CORE/mkxp [IO-10] CORE/mkxp-trace-10000 real WasmFS pthread proxy uses public Worker above 4GiB, metadata stat, EOF, readonly, timeout and close @S14", async ({page}, testInfo) => {
  test.setTimeout(180000);
  const env = process.env.RETROM_CONTENT_IO_ENV;
  if (!env) {throw new Error("CONTENT_IO_ENV_REQUIRED");}
  const root = process.env.RETROM_CONTENT_IO_NATIVE_FIXTURE ?? join(dirname(env), "S14");
  const fixture = await nativeFixture(root);
  await testInfo.attach("mkxp-native-build-receipt", {body: JSON.stringify(fixture.descriptor), contentType: "application/json"});
  const server = await startFixtureServer({contentModule: await bundle("src/content-io/client.ts"), modules: {
    "worker.mjs": "Object.defineProperty(globalThis, 'indexedDB', {value: undefined});" + await bundle("tests/content-io/trace-worker.ts"), "content-native.js": fixture.js,
  }, staticFiles: {"content-native.wasm": fixture.wasm}});
  const identity = server.register({id: "game", fixtureId: "big-offset", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  const rtpIdentity = server.register({id: "rtp", fixtureId: "big-offset", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity, rtpIdentity}) => {
      const url = "/__test__/content.mjs";
      const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
      const worker = new Worker("/__test__/worker.mjs", {type: "module"});
      const stats = () => new Promise<ContentSessionService["stats"]>((resolve, reject) => {
        const id = crypto.randomUUID(), timer = setTimeout(() => {worker.removeEventListener("message", listener); reject(new Error("TRACE_STATS_TIMEOUT"));}, 5000);
        const listener = ({data}: MessageEvent) => {if (data.id === id) {clearTimeout(timer); worker.removeEventListener("message", listener); resolve(data.stats);}};
        worker.addEventListener("message", listener); worker.postMessage({type: "TEST_STATS", id});
      });
      const session = await createContentSession(worker, {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
      const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/big-offset/game`,
        purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT", },
      {mode: "RANGE", bridge: "WASMFS", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER, workspace: "NONE", writes: "SESSION_OVERLAY", contentLengthPolicy: "EXACT_IF_PRESENT", });
      const rtp = await session.open({identity: rtpIdentity.identity, sizeBytes: rtpIdentity.sizeBytes, url: `${location.origin}/objects/big-offset/rtp`,
        purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT"},
      {mode: "RANGE", bridge: "WASMFS", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"});
      await new Promise<void>((resolve, reject) => {const script = document.createElement("script"); script.src = "/__test__/content-native.js"; script.onload = () => resolve(); script.onerror = () => reject(new Error("fixture script")); document.head.append(script);});
      type Native = {retromContentClose?(): void; PThread: {terminateAllThreads(): void}};
      const realm = window as unknown as {ContentNativeFixture(options: Record<string, unknown>): Promise<Native>};
      const log: string[] = [], calls: {id: string; offset: number; size: number; ui: boolean}[] = [], failures: number[] = [];
      const snapshots: Promise<{l1: number; service: ContentSessionService["stats"]}>[] = [];
      let callsAtStat = -1;
      let resolveDone!: () => void, rejectDone!: (error: Error) => void, native: Native | undefined;
      const done = new Promise<void>((resolve,reject) => {resolveDone=resolve;rejectDone=reject;});
      try {
        native = await realm.ContentNativeFixture({locateFile: (path: string) => path.endsWith(".wasm") ? "/files/content-native.wasm" : `/__test__/${path}`,
          print: (value: string) => {
            log.push(value);
            if (value === "CONTENT_STAT_OK") {callsAtStat = calls.length;}
            if (value.startsWith("CONTENT_TRACE:")) {const l1 = session.stats.lruBytes; snapshots.push(stats().then(service => ({l1, service})));}
            if (value === "CONTENT_FIXTURE_OK") {resolveDone();}
          },
          printErr: (value: string) => {log.push(value);}, onAbort: (reason: string) => rejectDone(new Error(reason)),
          retromContentBridge: {abi: "content-io-v1", contractSha256: "9601f63ba9d1bad095b42b32a3d6167166535be246a87f0efac7c5b125ed27bf",
            reportFailure: (code: number) => failures.push(code),
            readIntoById: async (id: string, offset: number, bytes: Uint8Array, signal: AbortSignal) => {
              calls.push({id,offset,size:bytes.length,ui:typeof document !== "undefined"});
              if(offset===128) {await new Promise(resolve=>setTimeout(resolve,100));bytes.fill(7);return bytes.length;}
              if(offset===256) {setTimeout(()=>native?.retromContentClose?.(),5);await new Promise<void>((_,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}));}
              const selected = id === "11111111-1111-4111-8111-111111111111" ? reader :
                id === "22222222-2222-4222-8222-222222222222" ? rtp : null;
              if (!selected) {throw new Error("UNKNOWN_FILE_ID");}
              return selected.readInto(offset,bytes,signal);
            }},
        });
        await done;
        await reader.close(); await rtp.close();
        let closed = await stats();
        for (let retry = 0; retry < 100 && (closed.pending || closed.temporaryBytes); retry++) {await new Promise(resolve => setTimeout(resolve, 10)); closed = await stats();}
        return {log, calls, failures, callsAtStat, snapshots: await Promise.all(snapshots), closed, l1Peak: session.blocks.cache.peakByteLength};
      } finally {native?.retromContentClose?.(); native?.PThread.terminateAllThreads(); await session.close();}
    }, {identity, rtpIdentity});
    await testInfo.attach("mkxp-native-trace", {body: JSON.stringify({result, requests: [...server.requests("game"), ...server.requests("rtp")]}), contentType: "application/json"});
    expect(result.log).toContain("CONTENT_TRACE_OK"); expect(result.callsAtStat).toBe(0);
    expect(result.snapshots).toHaveLength(40); expect(result.calls.length).toBeGreaterThan(10000);
    for (const snapshot of result.snapshots) {
      expect(snapshot.l1 + snapshot.service.lruBytes).toBeLessThanOrEqual(16777216);
      expect(snapshot.service.temporaryBytes).toBeLessThanOrEqual(8388608);
      expect(snapshot.service.outputBytes).toBeLessThanOrEqual(4194304);
      expect(snapshot.service.active).toBeLessThanOrEqual(4);
    }
    expect(result.l1Peak + result.closed.peaks.lruBytes).toBeLessThanOrEqual(16777216);
    expect(result.closed.peaks.temporaryBytes).toBeLessThanOrEqual(8388608);
    expect(result.closed.peaks.outputBytes).toBeLessThanOrEqual(4194304);
    expect(result.closed.peaks.active).toBeLessThanOrEqual(4);
    expect(result.closed.peaks.queued).toBeLessThanOrEqual(256);
    expect(result.closed).toMatchObject({active: 0, pending: 0, queued: 0, waiters: 0, channels: 0, files: 0, leases: 0, temporaryBytes: 0});
    const requests = [...server.requests("game"), ...server.requests("rtp")];
    expect(result.closed.rangeRequests).toBe(requests.length);
    expect(result.closed.networkBytes).toBe(requests.reduce((sum, request) => sum + request.sentBytes, 0));
    expect(result.log).toContain("CONTENT_STAT_OK"); expect(result.log).toContain("CONTENT_FIXTURE_OK");
    expect(result.calls.every(call=>call.ui && call.size<=262144)).toBe(true);
    expect(result.calls.some(call=>call.offset>4294967296)).toBe(true);
    expect(new Set(result.calls.map(call=>call.id)).size).toBe(2);
    expect(result.failures).toEqual([9,11,11]); expect(errors).toEqual([]);
    expect(server.requests("game").every(request=>request.method==="GET" && request.range)).toBe(true);
  } finally {await server.close();}
});
