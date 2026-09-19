import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {startFixtureServer} from "./fixture-server.mjs";
async function fixture() {
  const bundle = async (name: string) => (await build({entryPoints: [fileURLToPath(new URL(`../../src/content-io/${name}.ts`, import.meta.url))],
    bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
  return startFixtureServer({contentModule: await bundle("client"), modules: {"worker.mjs": await bundle("worker")}});
}
test("[BR-10] BROWSER/session [PK-02] BROWSER/session [PK-03] BROWSER/session @S05", async ({page}) => {
  page.on("console", (message) => console.log("browser:", message.text()));
  page.on("pageerror", (error) => console.log("pageerror:", error.message));
  const server = await fixture();
  const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity}) => {
      const moduleUrl = "/__test__/content.mjs";
      const {createContentSession} = await import(moduleUrl) as typeof import("../../src/content-io/client.js");
      const worker = new Worker("/__test__/worker.mjs", {type: "module"});
      worker.addEventListener("error", (event) => console.error("worker:", event.message, event.filename, event.lineno));
      const session = await createContentSession(worker, {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
      try {
        const source = {identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/multi-tail/game`,
          purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
        const policy = {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER, workspace: "NONE", writes: "DENY",
          contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
        const reader = await session.open(source, policy), other = await session.open(source, policy);
        const before = await (await fetch("/__test__/requests/game")).json() as unknown[];
        const frame = document.createElement("iframe"); document.body.append(frame);
        const iframeWindow = frame.contentWindow as Window & typeof globalThis;
        const output = new iframeWindow.Uint8Array(19);
        await reader.readInto(262140, output); const snapshot = Array.from(output);
        structuredClone(output, {transfer: [output.buffer]});
        const bytes = new Uint8Array(19); const cached = other.tryReadInto(262140, bytes);
        await reader.close(); let closed = "";
        try {reader.tryReadInto(262140, bytes);} catch (error) {closed = (error as Error).message;}
        await other.readInto(262140, bytes); await session.close(); await session.close();
        return {before: before.length, snapshot, cached, copied: Array.from(bytes), closed, stats: session.stats};
      } finally {await session.close();}
    }, {identity});
    expect(result.before).toBe(0); expect(result.cached).toBe(19); expect(result.copied).toEqual(result.snapshot);
    expect(result.snapshot.some((n) => n !== 0)).toBe(true); expect(result.closed).toBe("CONTENT_IO_ABORTED");
    expect(result.stats).toMatchObject({pending: 0, active: 0, queued: 0, lruBytes: 0, channels: 0, files: 0});
    expect(server.requests("game").map((request) => request.range)).toEqual(["bytes=0-262143", "bytes=262144-524287"]);
  } finally {await server.close();}
});
test("[BR-12] BROWSER/session refuses wrong source origin @S05", async ({page}) => {
  page.on("console", (message) => console.log("browser:", message.text()));
  page.on("pageerror", (error) => console.log("pageerror:", error.message));
  const server = await fixture();
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async () => {
      const moduleUrl = "/__test__/content.mjs";
      const {createContentSession} = await import(moduleUrl) as typeof import("../../src/content-io/client.js");
      const worker = new Worker("/__test__/worker.mjs", {type: "module"});
      worker.addEventListener("error", (event) => console.error("worker:", event.message, event.filename, event.lineno));
      const session = await createContentSession(worker, {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
      try {
        await session.open({identity: {kind: "FILE_SHA256", sha256: "a".repeat(64)}, sizeBytes: 1, url: "https://unapproved.test/game",
          purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", },
        {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: 99, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", });
        return "unexpected success";
      } catch (error) {return (error as Error).message;} finally {await session.close();}
    });
    expect(result).toBe("CONTENT_IO_SOURCE_INVALID");
  } finally {await server.close();}
});
