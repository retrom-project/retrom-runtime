import {test, expect} from "@playwright/test";
import {createHash} from "node:crypto";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const M = 1024 * 1024;
const compile = async (name: string, banner = "") => (await build({entryPoints: [`src/content-io/${name}.ts`],
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022", banner: {js: banner}})).outputFiles[0].text;
const memoryOnly = "Object.defineProperty(globalThis, 'indexedDB', {value: undefined});";

test("defaults fetch files through 5 MiB whole and prefetch 2 MiB only after actual reading passes halfway", async ({page}) => {
  const staticFiles = Object.fromEntries([5 * M - 1, 5 * M, 5 * M + 1].map(size => [String(size), new Uint8Array(size).fill(7)]));
  const files = Object.entries(staticFiles).map(([name, bytes]) => ({name, sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")}));
  const server = await startFixtureServer({staticFiles, contentModule: await compile("client"),
    modules: {"worker.mjs": await compile("worker", memoryOnly)}});
  const identity = server.register({id: "game", fixtureId: "cache-trace", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  await page.exposeFunction("checkWindows", async (count: number) => {
    await expect.poll(() => server.requests("game").filter(request => request.complete).length).toBe(count);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(server.requests("game")).toHaveLength(count);
  });
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({files, identity, M}) => {
      const url = "/__test__/content.mjs";
      const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
      const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
        {storageOrigin: location.origin, allowedOrigins: [location.origin]});
      const policy = {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER,
        workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
      const hooks = globalThis as unknown as {checkWindows(count: number): Promise<void>};
      try {
        const samples = [];
        for (const file of files) {
          const reader = await session.open({identity: {kind: "FILE_SHA256", sha256: file.sha256}, sizeBytes: file.sizeBytes,
            url: `${location.origin}/files/${file.name}`, purpose: "GAME", transport: "RANGE_REQUIRED",
            etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"}, policy);
          const bytes = new Uint8Array(1); await reader.readInto(file.sizeBytes - 1, bytes); samples.push(bytes[0]);
          await reader.close();
        }
        const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes,
          url: `${location.origin}/objects/cache-trace/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
          etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"}, policy);
        const bytes = new Uint8Array(1);
        await reader.readInto(M - 1, bytes); await hooks.checkWindows(1);
        await reader.readInto(M, bytes); await hooks.checkWindows(2);
        await reader.readInto(M + 1, bytes); await hooks.checkWindows(2);
        await reader.readInto(3 * M, bytes); await hooks.checkWindows(3);
        return samples;
      } finally {await session.close();}
    }, {files, identity, M});
    expect(result).toEqual([7, 7, 7]);
    expect(server.fileRequests.map(request => request.range)).toEqual([null, null, `bytes=${4 * M}-${5 * M}`]);
    expect(server.requests("game").map(request => request.range)).toEqual([
      `bytes=0-${2 * M - 1}`, `bytes=${2 * M}-${4 * M - 1}`, `bytes=${4 * M}-${6 * M - 1}`,
    ]);
  } finally {await server.close();}
});

for (const {bridge, fixtureId, whole} of [
  {bridge: "ASYNC", fixtureId: "big-offset", whole: false},
  {bridge: "SYNC_WORKER", fixtureId: "big-offset", whole: false},
  {bridge: "ASYNC", fixtureId: "above-small", whole: true},
] as const) {
  test(`one default ${whole ? "whole-small-file" : "2 MiB"} ${bridge} download completes at 64 KiB/s without a timeout or retry`, async ({page}) => {
    test.setTimeout(90_000);
    const simulator = `import {createSyncContentReader} from './sync-client.mjs';
self.onmessage = ({data}) => {
  try {const reader = createSyncContentReader(data), bytes = new Uint8Array(32);
    const length = reader.readInto(0, bytes); reader.close(); self.postMessage({length, bytes: Array.from(bytes)});
  } catch(error) {self.postMessage({failure: error.message});}
};`;
    const server = await startFixtureServer({contentModule: await compile("client"), modules: {
      "worker.mjs": await compile("worker", memoryOnly), "sync-client.mjs": await compile("sync-client"), "simulator.mjs": simulator,
    }});
    const identity = server.register({id: "game", fixtureId, behavior: "NORMAL", seed: 17,
      delayBeforeHeadersMs: null, chunkDelayMs: 250, disconnectAfterBytes: null, barrier: null});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async ({identity, bridge, fixtureId}) => {
        const url = "/__test__/content.mjs";
        const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
        const network: unknown[] = [];
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {onNetwork: value => network.push(value)});
        let simulator: Worker | undefined;
        try {
          const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes,
            url: `${location.origin}/objects/${fixtureId}/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
            etagPolicy: identity.identity.kind === "FILE_SHA256" ? "EXPECTED_SHA256" : "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT"},
          {mode: "RANGE", bridge, result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER,
            workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"});
          const start = performance.now();
          let result: {length?: number; bytes?: number[]; failure?: string};
          if (bridge === "ASYNC") {
            const bytes = new Uint8Array(32), length = await reader.readInto(0, bytes); result = {length, bytes: [...bytes]};
          } else {
            const options = await session.createSyncChannel(reader.id);
            simulator = new Worker("/__test__/simulator.mjs", {type: "module"});
            result = await new Promise(resolve => {simulator!.onmessage = ({data}) => resolve(data); simulator!.postMessage(options, [options.port]);});
          }
          return {...result, elapsed: performance.now() - start, network};
        } finally {simulator?.terminate(); await session.close();}
      }, {identity, bridge, fixtureId});
      expect(result.failure).toBeUndefined(); expect(result.length).toBe(32);
      expect(result.bytes).toEqual(Array.from({length: 32}, (_, n) => (n + 17) % 256));
      expect(result.elapsed).toBeGreaterThan(whole ? 15_000 : 30_000); expect(result.network).toEqual([]);
      expect(server.requests("game")).toHaveLength(1);
      expect(server.requests("game")[0]).toMatchObject({range: whole ? null : `bytes=0-${2 * M - 1}`,
        sentBytes: whole ? identity.sizeBytes : 2 * M, disconnected: false});
    } finally {await server.close();}
  });
}
