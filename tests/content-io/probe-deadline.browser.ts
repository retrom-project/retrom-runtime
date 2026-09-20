import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile = async (contents: string) => (await build({stdin: {contents, resolveDir: process.cwd()},
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;

test("[X-22] BROWSER/probe-deadline READY precedes optional storage and first access freezes MEMORY @S05 @S06", async ({page}) => {
  const worker = await compile(`import {OPFSStore} from './src/content-io/store/opfs.ts';
import './src/content-io/worker.ts';
const open = OPFSStore.open;
OPFSStore.open = async () => {await new Promise(resolve => setTimeout(resolve, 2100));return open();};`);
  const server = await startFixtureServer({contentModule: await compile("export {createContentSession} from './src/content-io/client.ts';"),
    modules: {"worker.mjs": worker}});
  const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity}) => {
      const url = "/__test__/content.mjs";
      const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
      const start = performance.now();
      const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
        {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
      const readyMs = performance.now() - start;
      try {
        const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes,
          url: `${location.origin}/objects/multi-tail/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
          etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", },
        {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER,
          workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", });
        const beforeRead = performance.now(), first = new Uint8Array(17);
        await reader.readInto(0, first); const readMs = performance.now() - beforeRead;
        await new Promise(resolve => setTimeout(resolve, 2200));
        const later = new Uint8Array(17); await reader.readInto(262144, later);
        const backend = session.stats.backend; await session.close();
        const locks = await navigator.locks.query();
        return {readyMs, readMs, backend, locks, stats: session.stats, first: Array.from(first), later: Array.from(later)};
      } finally {await session.close();}
    }, {identity});
    expect(result.readyMs).toBeLessThan(500); expect(result.readMs).toBeGreaterThanOrEqual(450);
    expect(result.readMs).toBeLessThan(1500); expect(result.backend).toBe("MEMORY");
    expect(result.first.some(byte => byte !== 0)).toBe(true); expect(result.later.some(byte => byte !== 0)).toBe(true);
    expect(result.stats).toMatchObject({pending: 0, channels: 0, files: 0});
    expect(result.locks.held).toEqual([]); expect(result.locks.pending).toEqual([]);
    expect(server.requests("game")).toHaveLength(2);
  } finally {await server.close();}
});
