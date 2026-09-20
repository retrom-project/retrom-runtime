import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {coreFixturePath} from "./core-fixture.js";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (file: string) => (await build({entryPoints: [file], bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
const runtime = (file: string) => fileURLToPath(new URL(`../../src/${file}.ts`, import.meta.url));
test("[BR-03] BROWSER/ppsspp-fork actual sync import, warm read and Provider revocation @S12", async ({page}) => {
  const consumer = `import {loadContentReader, contentAbi, contractSha256} from './ppsspp-content.mjs';
import {discReader} from './ppsspp-disc.mjs';
let read;
self.onmessage = async ({data}) => {
  try {
    if (data.content) {
      const reader = await loadContentReader(data.source, {...data.content, abi: contentAbi, contractSha256});
      read = discReader(data.source, reader);
      self.postMessage({kind: 'content-client-ready', abi: contentAbi, contractSha256});
      const bytes = new Uint8Array(19); read(bytes, 0, 19, 262140); const first = Array.from(bytes);
      bytes.fill(0); read(bytes, 0, 19, 262140); self.postMessage({first, warm: Array.from(bytes)});
    } else {read(new Uint8Array(1), 0, 1, 262140); self.postMessage({unexpected: true});}
  } catch (error) {self.postMessage({failure: error.message});}
};`;
  const server = await startFixtureServer({contentModule: await bundle(runtime("content-io/client")), modules: {
    "worker.mjs": await bundle(runtime("content-io/worker")), "sync-client.mjs": await bundle(runtime("content-io/sync-client")),
    "ppsspp-content.mjs": await bundle(await coreFixturePath("ppsspp", "libretro/retrom/ppsspp-content.mjs")),
    "ppsspp-disc.mjs": await bundle(await coreFixturePath("ppsspp", "libretro/retrom/ppsspp-disc.mjs")), "consumer.mjs": consumer,
  }});
  const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity}) => {
      const moduleUrl = "/__test__/content.mjs";
      const {createContentSession} = await import(moduleUrl) as typeof import("../../src/content-io/client.js");
      const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
      const consumer = new Worker("/__test__/consumer.mjs", {type: "module"});
      const messages: Record<string, unknown>[] = []; consumer.onmessage = ({data}) => messages.push(data as Record<string, unknown>);
      const until = async (count: number) => {while (messages.length < count) {await new Promise(resolve => setTimeout(resolve, 10));}};
      let url: string | undefined;
      try {
        if (identity.identity.kind !== "FILE_SHA256") {throw new Error("fixture");}
        const file = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/multi-tail/game`,
          purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "REQUIRED_EXACT", },
        {mode: "RANGE", bridge: "SYNC_WORKER", result: "READER", maxFileBytes: 2147483647, workspace: "NONE", writes: "DENY", contentLengthPolicy: "REQUIRED_EXACT", });
        const channel = await session.createSyncChannel(file.id);
        // Fixture serves the compiled runtime client; production's verified Blob path is separately tested.
        url = URL.createObjectURL(new Blob([await (await fetch("/__test__/sync-client.mjs")).text()], {type: "text/javascript"}));
        consumer.postMessage({source: {sha256: identity.identity.sha256, sizeBytes: identity.sizeBytes}, content: {...channel, syncClientUrl: url}}, [channel.port]);
        await until(2); URL.revokeObjectURL(url); url = undefined;
        await session.close(); consumer.postMessage({closeCheck: true}); await until(3); return messages;
      } finally {if (url) {URL.revokeObjectURL(url);} await session.close(); consumer.terminate();}
    }, {identity});
    expect(result[0]).toMatchObject({kind: "content-client-ready", abi: "content-io-v1"});
    expect(result[1].warm).toEqual(result[1].first); expect(result[2]).toEqual({failure: "CONTENT_IO_ABORTED"});
    expect(server.requests("game")).toHaveLength(2);
  } finally {await server.close();}
});
