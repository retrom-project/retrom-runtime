import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile = async (path: string) => (await build({entryPoints: [`src/${path}.ts`], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;

test("[X-07] BROWSER/scummvm-channel-groups a large lazy file tree keeps pending reads while recycling idle channels", async ({page}) => {
  const server = await startFixtureServer({contentModule: await compile("content-io/client"), modules: {
    "files.mjs": await compile("scummvm/files"), "worker.mjs": await compile("content-io/worker"),
  }});
  const scenarios = Array.from({length: 9}, (_, index) => server.register({id: String(index), fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: index === 0 ? "pending" : null}));
  await page.exposeFunction("releasePending", () => server.release("pending"));
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({sizeBytes}) => {
      const clientPath = "/__test__/content.mjs", filesPath = "/__test__/files.mjs";
      const {createContentSession} = await import(clientPath) as typeof import("../../src/content-io/client.js");
      const {ScummvmFiles} = await import(filesPath) as typeof import("../../src/scummvm/files.js");
      const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
        {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
      const files = new ScummvmFiles({schemaVersion: 1, files: Array.from({length: 1025}, (_, index) => ({path: `file${index}.bin`, sizeBytes,
        url: `${location.origin}/objects/multi-tail/${Math.floor(index / 128)}`}))}, "a".repeat(64), session);
      try {
        const names = files.list("/game"), sizes = names.map(name => files.stat(`/game/${name}`));
        const before = session.stats, channels = [], values = [];
        let firstDone = false; const first = files.read("/game/file0.bin", 0, 1).then(bytes => {firstDone = true; return bytes[0];});
        // Wait for actual dispatch, so later reads compete with a genuinely pending channel.
        while (!(await (await fetch("/__test__/requests/0")).json() as unknown[]).length) {await new Promise(resolve => setTimeout(resolve, 5));}
        for (let group = 1; group < 9; group++) {values.push((await files.read(`/game/file${group * 128}.bin`, 0, 1))[0]); channels.push(session.stats.channels);}
        const retained = !firstDone;
        await (globalThis as unknown as {releasePending: () => Promise<void>}).releasePending(); values.push(await first);
        await files.read("/game/file128.bin", 262144, 1); channels.push(session.stats.channels);
        await files.close();
        return {before, names: names.length, sizesMatch: sizes.every(size => size === sizeBytes), retained, values, channels, files: session.stats.files};
      } finally {await files.close(); await session.close();}
    }, {sizeBytes: scenarios[0].sizeBytes});
    expect(result.before).toMatchObject({files: 0, channels: 0}); expect(result.names).toBe(1025); expect(result.sizesMatch).toBe(true);
    expect(result.retained).toBe(true); expect(result.values).toEqual(Array(9).fill(17)); expect(Math.max(...result.channels)).toBe(8);
    expect(result.files).toBe(0); expect(server.requests("0")).toHaveLength(1); expect(server.requests("1")).toHaveLength(2);
    for (let index = 2; index < 9; index++) {expect(server.requests(String(index))).toHaveLength(1);}
  } finally {server.release("pending"); await server.close();}
});
