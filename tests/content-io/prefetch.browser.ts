import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const B = 262144;
const compile = async (name: string) => (await build({entryPoints: [`src/content-io/${name}.ts`], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;

test("prefetch shares a delayed HTTP request with demand and persists it for a new Session", async ({page}) => {
  const server = await startFixtureServer({contentModule: await compile("client"), modules: {"worker.mjs": await compile("worker")}});
  const identity = server.register({id: "game", fixtureId: "cache-trace", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: "window"});
  await page.exposeFunction("waitRequests", async (count: number) => {await expect.poll(() => server.requests("game").length).toBe(count);});
  await page.exposeFunction("releaseWindow", () => server.release("window"));
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity, B}) => {
      const url = "/__test__/content.mjs";
      const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
      const hooks = globalThis as unknown as {waitRequests(count: number): Promise<void>; releaseWindow(): Promise<void>};
      const context = {storageOrigin: location.origin, allowedOrigins: [location.origin]};
      const source = {identity: identity.identity, sizeBytes: identity.sizeBytes,
        url: `${location.origin}/objects/cache-trace/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
        etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
      const policy = {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER,
        workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
      let adopted!: () => void;
      const joined = new Promise<void>(resolve => {adopted = resolve;});
      const first = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), context,
        {onDiagnostic: event => {if (event.counts.waiters === 2 && event.counts.inflight === 1) {adopted();}}});
      let sample = 0;
      try {
        const a = await first.open(source, policy), b = await first.open(source, policy);
        const start = a.readInto(0, new Uint8Array(1));
        await hooks.waitRequests(1); await hooks.releaseWindow(); await start;
        await a.readInto(B, new Uint8Array(1));
        await hooks.waitRequests(2);
        const bytes = new Uint8Array(1), demand = b.readInto(2 * B, bytes);
        await joined; await a.close(); await hooks.releaseWindow(); await demand; sample = bytes[0];
      } finally {await first.close();}
      const second = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), context);
      try {
        const reader = await second.open(source, policy), bytes = new Uint8Array(1);
        await reader.readInto(2 * B, bytes);
        return {sample, reused: bytes[0], backend: second.stats.backend};
      } finally {await second.close();}
    }, {identity, B});
    const byteAt = (n: number) => (n % 251 + 17 * (Math.floor(n / 251) % 251) + 31 * (Math.floor(n / 65536) % 251) + 17) % 256;
    expect(result).toEqual({sample: byteAt(2 * B), reused: byteAt(2 * B), backend: "OPFS"});
    expect(server.requests("game").map(request => request.range)).toEqual([`bytes=0-${2 * B - 1}`, `bytes=${2 * B}-${4 * B - 1}`]);
    expect(server.requests("game").every(request => request.complete && !request.disconnected)).toBe(true);
  } finally {server.release("window"); await server.close();}
});

test("first [300,900) KiB read produces exactly two required HTTP windows plus one adjacent prefetch", async ({page}) => {
  const server = await startFixtureServer({contentModule: await compile("client"), modules: {"worker.mjs": await compile("worker")}});
  const identity = server.register({id: "game", fixtureId: "cache-trace", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity}) => {
      const url = "/__test__/content.mjs";
      const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
      let finished!: () => void;
      const idle = new Promise<void>(resolve => {finished = resolve;});
      const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
        {storageOrigin: location.origin, allowedOrigins: [location.origin]},
        {onDiagnostic: event => {if (event.counts.rangeRequests === 3 && event.counts.inflight === 0) {finished();}}});
      try {
        const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes,
          url: `${location.origin}/objects/cache-trace/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
          etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"},
        {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER,
          workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"});
        const bytes = new Uint8Array(600 * 1024);
        const length = await reader.readInto(300 * 1024, bytes); await idle;
        const correct = bytes.every((byte, index) => {
          const n = 300 * 1024 + index;
          return byte === (n % 251 + 17 * (Math.floor(n / 251) % 251) + 31 * (Math.floor(n / 65536) % 251) + 17) % 256;
        });
        return {length, correct};
      } finally {await session.close();}
    }, {identity});
    expect(result).toEqual({length: 600 * 1024, correct: true});
    expect(server.requests("game").map(request => request.range)).toEqual([
      "bytes=0-524287", "bytes=524288-1048575", "bytes=1048576-1572863",
    ]);
    expect(server.requests("game").every(request => request.complete)).toBe(true);
  } finally {await server.close();}
});
