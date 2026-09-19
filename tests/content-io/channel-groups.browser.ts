import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile = async (name: string) => (await build({entryPoints: [`src/content-io/${name}.ts`], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;

test("[X-07] BROWSER/channel-groups nine groups retain pending work and recycle only idle ports @S05", async ({page}) => {
  const server = await startFixtureServer({contentModule: await compile("client"), modules: {"worker.mjs": await compile("worker")}});
  const scenarios = Array.from({length: 9}, (_, index) => server.register({id: String(index), fixtureId: "multi-tail",
    behavior: "NORMAL", seed: 17, delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null,
    barrier: index === 0 ? "pending" : null}));
  await page.exposeFunction("releasePending", () => server.release("pending"));
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({scenarios}) => {
      const url = "/__test__/content.mjs";
      const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
      const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
        {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
      const readers = [], channels = [];
      try {
        for (let index = 0; index <= 1024; index++) {
          const group = Math.floor(index / 128);
          readers.push(await session.open({identity: {kind: "INDEX_ENTRY", projectDigest: "a".repeat(64), logicalPath: `files/${index}`},
            sizeBytes: scenarios[group].sizeBytes, url: `${location.origin}/objects/multi-tail/${group}`, purpose: "GAME",
            transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT", },
          {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER,
            workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", }));
        }
        const before = await Promise.all(scenarios.map(async (_, group) =>
          (await (await fetch(`/__test__/requests/${group}`)).json() as unknown[]).length));
        let pendingFinished = false;
        const first = new Uint8Array(17), pending = readers[0].readInto(0, first).then(() => {pendingFinished = true;});
        const outputs = [];
        for (let group = 1; group < 9; group++) {
          const bytes = new Uint8Array(17); await readers[group * 128].readInto(0, bytes);
          outputs.push(Array.from(bytes)); channels.push(session.stats.channels);
        }
        const retained = !pendingFinished;
        await (globalThis as unknown as {releasePending: () => Promise<void>}).releasePending(); await pending;
        // Revisit an evicted group at an uncached offset, forcing a fresh port.
        await readers[128].readInto(262144, new Uint8Array(17)); channels.push(session.stats.channels);
        await session.close();
        return {before, retained, channels, outputs, first: Array.from(first), stats: session.stats};
      } finally {await session.close();}
    }, {scenarios});
    expect(result.before).toEqual(Array(9).fill(0)); expect(result.retained).toBe(true);
    expect(Math.max(...result.channels)).toBe(8);
    for (const bytes of result.outputs) expect(bytes).toEqual(result.first);
    expect(server.requests("0")).toHaveLength(1); expect(server.requests("1")).toHaveLength(2);
    expect(result.stats).toMatchObject({pending: 0, channels: 0, files: 0});
  } finally {server.release("pending"); await server.close();}
});
