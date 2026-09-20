import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile = async (contents: string) => (await build({stdin: {contents, resolveDir: process.cwd()},
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
for (const failure of ["notify", "deadline", "close", "identity", "range-200", "checksum"] as const) {
  test(`[BR-03] BROWSER/sync-${failure} [BR-09] BROWSER/sync-${failure} [X-21] BROWSER/sync-${failure} @S08`, async ({page}) => {
    const client = await compile("export {createContentSession} from './src/content-io/client.ts'; export {ContentIOError} from './src/content-io/errors.ts';");
    const worker = await compile(`import './src/content-io/worker.ts'; const fetcher = globalThis.fetch;
      globalThis.fetch = (...args) => {const pending = fetcher(...args); self.postMessage({testFetchStarted: true}); return pending;};`);
    const consumer = `import {createSyncContentReader} from './sync.mjs';
      self.onmessage = ({data}) => {
        const reader = createSyncContentReader(data), bytes = new Uint8Array(32).fill(238), errors = [];
        for (const operation of [()=>reader.readInto(0, bytes, 800), ()=>reader.readInto(0, new Uint8Array()), ()=>reader.tryReadInto(0,new Uint8Array(1))]) {
          try {operation(); errors.push('success');} catch(error) {errors.push(error.message);}
        }
        reader.close(); reader.close(); self.postMessage({errors, bytes: Array.from(bytes)});
      };`;
    const server = await startFixtureServer({contentModule: client, modules: {"worker.mjs": worker,
      "sync.mjs": await compile("export {createSyncContentReader} from './src/content-io/sync-client.ts';"), "consumer.mjs": consumer}});
    const delayed = ["notify", "deadline", "close"].includes(failure);
    const identity = server.register({id: "sync-fault", fixtureId: "multi-tail", behavior: failure === "checksum" ? "CORRUPT_BODY" : failure === "identity" ? "STATUS_412" : failure === "range-200" ? "IGNORE_RANGE" : "NORMAL",
      seed: 17, delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: delayed ? "held" : null});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async ({identity, failure}) => {
        const url = "/__test__/content.mjs";
        const {createContentSession, ContentIOError} = await import(url) as typeof import("../../src/content-io/client.js") & typeof import("../../src/content-io/errors.js");
        const service = new Worker("/__test__/worker.mjs", {type: "module"});
        const session = await createContentSession(service, {storageOrigin: location.origin, allowedOrigins: [location.origin]},
          {fetchPolicy: {smallFileThresholdBytes: failure === "checksum" ? 1048576 : 0, networkWindowBytes: 262144}});
        const consumer = new Worker("/__test__/consumer.mjs", {type: "module"});
        const finished = new Promise<{errors: string[]; bytes: number[]}>((resolve, reject) => {consumer.onmessage = ({data}) => resolve(data); consumer.onerror = event => reject(new Error(event.message));});
        let closing: Promise<void> | undefined;
        service.addEventListener("message", ({data}) => {
          if (!data.testFetchStarted) {return;}
          if (failure === "deadline") {service.terminate();}
          if (failure === "notify") {session.fail(new ContentIOError("INTERNAL"));}
          if (failure === "close") {closing = session.close();}
        });
        try {
          const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes,
            url: `${location.origin}/objects/multi-tail/sync-fault`, purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"},
          {mode: "RANGE", bridge: "SYNC_WORKER", result: "READER", maxFileBytes: identity.sizeBytes, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"});
          const options = await session.createSyncChannel(reader.id);
          consumer.postMessage(options, [options.port]); const value = await finished;
          await closing; session.fail(new ContentIOError("ABORTED")); await session.close(); await session.close();
          return {value, stats: session.stats};
        } finally {session.fail(new ContentIOError("ABORTED")); consumer.terminate(); await session.close();}
      }, {identity, failure});
      const code = {notify: "INTERNAL", deadline: "TIMEOUT", close: "ABORTED", identity: "IDENTITY_CHANGED", "range-200": "RANGE_UNSUPPORTED", checksum: "CHECKSUM_MISMATCH"}[failure];
      expect(result.value.errors).toEqual(Array(3).fill(`CONTENT_IO_${code}`));
      expect(result.value.bytes).toEqual(Array(32).fill(238));
      expect(result.stats).toMatchObject({pending: 0, active: 0, queued: 0, channels: 0, files: 0, lruBytes: 0});
    } finally {server.release("held"); await server.close();}
  });
}
