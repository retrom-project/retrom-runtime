import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (contents: string) => (await build({stdin: {contents, resolveDir: process.cwd(), loader: "ts"},
  bundle: true, format: "esm", platform: "browser", write: false})).outputFiles[0].text;
test("[X-10] BROWSER/published-corruption notifies once and preserves leased bytes while a new generation is prepared @S06", async ({page}) => {
  const broken = await bundle(`import {OPFSStore} from './src/content-io/store/opfs.ts'; import './src/content-io/worker.ts';
const read = OPFSStore.prototype.read;
OPFSStore.prototype.read = async function(receipt, complete) {
  const bytes = await read.call(this, receipt, complete);
  if (complete && receipt.index === 0) {bytes[0] ^= 1;} return bytes;
};`);
  const server = await startFixtureServer({contentModule: await bundle('export * from "./src/content-io/client.ts";'), modules: {
    "worker.mjs": await bundle('import "./src/content-io/worker.ts";'), "broken.mjs": broken,
  }});
  const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity}) => {
      const url = "/__test__/content.mjs";
      const {ContentSessionClient, createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
      const context = {storageOrigin: location.origin, allowedOrigins: [location.origin]}, notifications: string[] = [];
      const options = {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}};
      const source = {identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/multi-tail/game`, purpose: "GAME",
        transport: "WHOLE_ALLOWED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
      const policy = {mode: "EAGER", bridge: "NONE", result: "BLOB", maxFileBytes: identity.sizeBytes, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
      const first = new ContentSessionClient(new Worker("/__test__/broken.mjs", {type: "module"}), context, error => notifications.push(error.code), options);
      await first.ready;
      const second = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), context, options);
      const digest = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), n => n.toString(16).padStart(2, "0")).join("");
      try {
        const file = await first.open(source, policy), leased = await first.materialize(file.id, {kind: "BLOB", maxBytes: identity.sizeBytes});
        if (leased.kind !== "BLOB") throw new Error("fixture kind");
        await file.close();
        const reader = await first.open({...source, transport: "RANGE_REQUIRED"}, {...policy, mode: "RANGE", bridge: "ASYNC", result: "READER"});
        const failures = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          try {await reader.readInto(0, new Uint8Array(1)); failures.push("unexpected");}
          catch (error) {failures.push((error as Error).message);}
        }
        const nextFile = await second.open(source, policy), next = await second.materialize(nextFile.id, {kind: "BLOB", maxBytes: identity.sizeBytes});
        if (next.kind !== "BLOB") throw new Error("fixture kind");
        const hashes = [await digest(leased.blob), await digest(next.blob)];
        const generations = [leased.receipt.storageGeneration, next.receipt.storageGeneration];
        await leased.release(); await next.release();
        return {failures, notifications, hashes, generations};
      } finally {await first.close(); await second.close();}
    }, {identity});
    expect(result.failures).toEqual(["CONTENT_IO_IDENTITY_CHANGED", "CONTENT_IO_IDENTITY_CHANGED"]);
    expect(result.notifications).toEqual(["CONTENT_IO_IDENTITY_CHANGED"]);
    expect(result.generations[0]).not.toBe(result.generations[1]);
    if (identity.identity.kind !== "FILE_SHA256") throw new Error("fixture identity");
    expect(result.hashes).toEqual([identity.identity.sha256, identity.identity.sha256]);
    expect(server.requests("game").map(request => request.range)).toEqual([null, null]);
  } finally {await server.close();}
});
