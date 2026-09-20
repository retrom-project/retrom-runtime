import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (contents: string) => (await build({stdin: {contents, resolveDir: process.cwd(), loader: "ts"},
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
for (const corrupt of [false, true]) {
  test(`[ST-06] BROWSER/staged-crash-${corrupt ? "bad-hash" : "resume"} never publishes an unchecked whole response @S06`, async ({page}) => {
    const modules = {
      "worker.mjs": await bundle('import "./src/content-io/worker.ts";'),
      "crash.mjs": await bundle(`import {ContentStoreManager} from './src/content-io/store/manager.ts';
import './src/content-io/worker.ts';
const stage = ContentStoreManager.prototype.stage;
ContentStoreManager.prototype.stage = async function(object, index, bytes, signal) {
  await stage.call(this, object, index, bytes, signal);
  if ((index + 1) * 262144 >= object.source.sizeBytes) {
    self.postMessage({hook: 'LAST_STAGED_BEFORE_FULL_HASH'}); await new Promise(() => {});
  }
};`),
    };
    const server = await startFixtureServer({contentModule: await bundle('export * from "./src/content-io/client.ts";'), modules});
    const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: corrupt ? "CORRUPT_BODY" : "NORMAL", seed: 17,
      delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async ({identity, corrupt}) => {
        const url = "/__test__/content.mjs";
        const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
        const context = {storageOrigin: location.origin, allowedOrigins: [location.origin]};
        const options = {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}};
        const source = {identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/multi-tail/game`,
          purpose: "GAME", transport: "WHOLE_ALLOWED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
        const policy = {mode: "EAGER", bridge: "NONE", result: "BYTES", maxFileBytes: identity.sizeBytes,
          workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
        const states = async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {const request = indexedDB.open("retrom-content-io-v1", 1);
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
          try {
            return await new Promise<{state: string; localSha256: string | null}[]>((resolve, reject) => {
              const request = db.transaction("generations").objectStore("generations").getAll();
              request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
          } finally {db.close();}
        };
        const worker = new Worker("/__test__/crash.mjs", {type: "module"});
        const hook = new Promise<string>(resolve => worker.onmessage = ({data}) => resolve(data.hook));
        const first = await createContentSession(worker, context, options), file = await first.open(source, policy);
        const prepare = first.materialize(file.id, {kind: "BYTES", maxBytes: identity.sizeBytes}).then(() => "unexpected", () => "failed");
        const reached = await hook;
        worker.terminate(); worker.dispatchEvent(new Event("error")); const interrupted = await prepare;
        const before = await states();
        const second = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), context, options);
        try {
          let byte = null;
          if (!corrupt) {
            const reader = await second.open({...source, transport: "RANGE_REQUIRED"}, {...policy, mode: "RANGE", bridge: "ASYNC", result: "READER"});
            const bytes = new Uint8Array(1); await reader.readInto(0, bytes); byte = bytes[0];
          }
          const complete = await second.open(source, policy);
          let digest = null, failure = null;
          try {
            const value = await second.materialize(complete.id, {kind: "BYTES", maxBytes: identity.sizeBytes});
            if (value.kind !== "BYTES") throw new Error("fixture result");
            digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(value.bytes)))).map(n => n.toString(16).padStart(2, "0")).join("");
          } catch (error) {failure = (error as Error).message;}
          return {reached, interrupted, before, after: await states(), byte, digest, failure};
        } finally {await second.close();}
      }, {identity, corrupt});
      expect(result.reached).toBe("LAST_STAGED_BEFORE_FULL_HASH"); expect(result.interrupted).toBe("failed");
      expect(result.before).toHaveLength(1); expect(result.before[0]).toMatchObject({state: "PARTIAL", localSha256: null});
      if (corrupt) {
        expect(result.failure).toBe("CONTENT_IO_CHECKSUM_MISMATCH"); expect(result.digest).toBeNull();
        expect(result.after.every(record => record.state !== "COMPLETE")).toBe(true);
        expect(server.requests("game")).toHaveLength(1);
      } else {
        expect(result.failure).toBeNull(); expect(result.byte).toBe(17);
        expect(identity.identity.kind).toBe("FILE_SHA256");
        if (identity.identity.kind === "FILE_SHA256") expect(result.digest).toBe(identity.identity.sha256);
        expect(result.after[0]).toMatchObject({state: "COMPLETE", localSha256: result.digest});
        expect(server.requests("game").map(request => request.range)).toEqual([null, "bytes=0-262143"]);
      }
    } finally {await server.close();}
  });
}
