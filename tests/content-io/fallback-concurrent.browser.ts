import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile = async (contents: string) => (await build({stdin: {contents, resolveDir: process.cwd()},
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;

test("[X-24] BROWSER/fallback-inflight cache generation changes do not revoke concurrent network reads @S06", async ({page}) => {
  const worker = await compile(`import {OPFSStore} from './src/content-io/store/opfs.ts';
import './src/content-io/worker.ts';
const write = OPFSStore.prototype.write;
OPFSStore.prototype.write = function(receipt, bytes) {
  if (receipt.index === 1) throw new DOMException('quota', 'QuotaExceededError');
  return write.call(this, receipt, bytes);
};`);
  const server = await startFixtureServer({contentModule: await compile("export {createContentSession} from './src/content-io/client.ts';"),
    modules: {"worker.mjs": worker}});
  const scenario = {id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null};
  const identity = server.register(scenario);
  server.register({...scenario, id: "blocked", barrier: "pending"});
  await page.exposeFunction("waitBlocked", async () => {await expect.poll(() => server.requests("blocked").length).toBe(1);});
  await page.exposeFunction("releaseBlocked", () => server.release("pending"));
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async identity => {
      const url = "/__test__/content.mjs";
      const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
      const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
        {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
      const hooks = globalThis as unknown as {waitBlocked(): Promise<void>; releaseBlocked(): Promise<void>};
      try {
        const source = {identity: identity.identity, sizeBytes: identity.sizeBytes,
          url: `${location.origin}/objects/multi-tail/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
          etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
        const policy = {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER,
          workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
        const first = await session.open(source, policy);
        await first.readInto(0, new Uint8Array(1));
        const second = await session.open({...source, url: `${location.origin}/objects/multi-tail/blocked`}, policy);
        const output = new Uint8Array(1), pending = second.readInto(2 * 262144, output).then(() => "OK", error => (error as Error).message);
        await hooks.waitBlocked();
        await first.readInto(262144, new Uint8Array(1));
        await hooks.releaseBlocked();
        return {result: await pending, byte: output[0], backend: session.stats.backend};
      } finally {await session.close();}
    }, identity);
    expect(result.result).toBe("OK"); expect(result.backend).toBe("CACHE_BLOCKS");
    expect(server.requests("blocked")).toHaveLength(1);
  } finally {server.release("pending"); await server.close();}
});
