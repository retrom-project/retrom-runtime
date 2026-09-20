import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile = async (path: string, banner = "") => (await build({entryPoints: [`src/${path}.ts`], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022", banner: {js: banner}})).outputFiles[0].text;

test("[ST-01] BROWSER/scummvm [ST-03] BROWSER/scummvm [IO-21] BROWSER/scummvm two identities reuse across Sessions and survive denied storage", async ({page}) => {
  const server = await startFixtureServer({contentModule: await compile("content-io/client"), modules: {
    "files.mjs": await compile("scummvm/files"), "worker.mjs": await compile("content-io/worker"),
    "memory.mjs": await compile("content-io/worker", "Object.defineProperty(globalThis, 'indexedDB', {value: undefined});"),
  }});
  const identities = [17, 41].map((seed, index) => server.register({id: `game${index}`, fixtureId: "multi-tail", behavior: "NORMAL", seed,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null}));
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const results = await page.evaluate(async ({sizeBytes}) => {
      const clientPath = "/__test__/content.mjs", facadePath = "/__test__/files.mjs";
      const {createContentSession} = await import(clientPath) as typeof import("../../src/content-io/client.js");
      const {ScummvmFiles} = await import(facadePath) as typeof import("../../src/scummvm/files.js");
      const records = [];
      const requests = async () => (await Promise.all([0, 1].map(async index => (await (await fetch(`/__test__/requests/game${index}`)).json() as unknown[]).length)));
      for (const worker of ["worker.mjs", "worker.mjs", "memory.mjs"]) {
        const session = await createContentSession(new Worker(`/__test__/${worker}`, {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]});
        const files = new ScummvmFiles({schemaVersion: 1, files: [0, 1].map(index => ({path: `Folder/game${index}.bin`, sizeBytes,
          url: `${location.origin}/objects/multi-tail/game${index}`}))}, "a".repeat(64), session);
        try {
          const before = await requests();
          const stats = [files.stat("/game/Folder"), files.stat("/game/Folder/game0.bin"), files.stat("/game/missing")];
          const list = files.list("/game/Folder"), afterStat = await requests();
          const cold = await Promise.all([0, 1].map(index => files.read(`/game/Folder/game${index}.bin`, 262142, 19)));
          const snapshots = cold.map(bytes => Array.from(bytes)); cold[0].fill(255);
          const again = Array.from(await files.read("/game/Folder/game0.bin", 262142, 19));
          const tail = Array.from(await files.read("/game/Folder/game0.bin", sizeBytes - 3, 3));
          await files.close(); const closed = await files.read("/game/Folder/game0.bin", 0, 1).then(() => "WRONG", error => (error as Error).message);
          records.push({before, afterStat, after: await requests(), stats, list, snapshots, again, tail, closed, backend: session.stats.backend});
        } finally {await files.close(); await session.close();}
      }
      return records;
    }, {sizeBytes: identities[0].sizeBytes});
    expect(results.map(row => row.after.map((count, index) => count - row.before[index]))).toEqual([[1, 1], [0, 0], [1, 1]]);
    expect(results.map(row => row.backend)).toEqual(["OPFS", "OPFS", "MEMORY"]);
    for (const row of results) {
      expect(row.before).toEqual(row.afterStat); expect(row.stats).toEqual([-1, identities[0].sizeBytes, -2]);
      expect(row.list).toEqual(["game0.bin", "game1.bin"]); expect(row.closed).toBe("CONTENT_IO_ABORTED");
      expect(row.again).toEqual(row.snapshots[0]); expect(row.snapshots[0]).not.toEqual(row.snapshots[1]);
      expect(row.snapshots).toEqual(results[0].snapshots); expect(row.tail).toEqual(results[0].tail);
    }
  } finally {await server.close();}
});
