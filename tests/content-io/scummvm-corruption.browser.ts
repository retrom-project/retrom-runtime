import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile = async (path: string) => (await build({entryPoints: [`${path}.ts`], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;

test("[IO-18] BROWSER/scummvm-corrupt-block verifies local bytes and replaces only the damaged block", async ({page}) => {
  const server = await startFixtureServer({contentModule: await compile("tests/content-io/scummvm-metrics-entry"), modules: {
    "files.mjs": await compile("src/scummvm/files"), "worker.mjs": await compile("tests/content-io/trace-worker"),
  }});
  const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({sizeBytes}) => {
      const clientPath = "/__test__/content.mjs", filesPath = "/__test__/files.mjs";
      const {createContentSession, workerStats} = await import(clientPath) as typeof import("./scummvm-metrics-entry.js");
      const {ScummvmFiles} = await import(filesPath) as typeof import("../../src/scummvm/files.js");
      const read = async () => {
        const worker = new Worker("/__test__/worker.mjs", {type: "module"});
        const session = await createContentSession(worker, {storageOrigin: location.origin, allowedOrigins: [location.origin]});
        const files = new ScummvmFiles({schemaVersion: 1, files: [{path: "game.bin", sizeBytes, url: `${location.origin}/objects/multi-tail/game`}]}, "a".repeat(64), session);
        try {
          const bytes = new Uint8Array(sizeBytes);
          for (let offset = 0; offset < sizeBytes; offset += 262144) {bytes.set(await files.read("/game/game.bin", offset, Math.min(262144, sizeBytes - offset)), offset);}
          return {sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join(""), backend: session.stats.backend, metrics: await workerStats(worker)};
        } finally {await files.close(); await session.close();}
      };
      const first = await read();
      const db = await new Promise<IDBDatabase>((resolve, reject) => {const request = indexedDB.open("retrom-content-io-v1", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
      let receipt: {objectKey: string; generation: string};
      try {
        const receipts = await new Promise<{objectKey: string; generation: string; index: number}[]>((resolve, reject) => {
          const request = db.transaction("blocks").objectStore("blocks").getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        const found = receipts.find(row => row.index === 0); if (!found || receipts.length !== 4) {throw new Error("SCUMMVM_TEST_RECEIPTS_MISSING");} receipt = found;
      } finally {db.close();}
      let directory = await navigator.storage.getDirectory();
      for (const name of ["retrom-content-io-v1", "objects", receipt.objectKey]) {directory = await directory.getDirectoryHandle(name);}
      const handle = await directory.getFileHandle(`${receipt.generation}.data`), sizeBefore = (await handle.getFile()).size;
      const writer = await handle.createWritable({keepExistingData: true});
      await writer.write({type: "write", position: 17, data: new Uint8Array([199])}); await writer.close();
      return {first, next: await read(), sizeBefore, sizeAfter: (await handle.getFile()).size};
    }, {sizeBytes: identity.sizeBytes});
    if (identity.identity.kind !== "FILE_SHA256") {throw new Error("FIXTURE_IDENTITY");}
    expect(result.first).toMatchObject({sha256: identity.identity.sha256, backend: "OPFS"});
    expect(result.next).toMatchObject({sha256: result.first.sha256, backend: "OPFS"});
    expect(result.first.metrics.corruptBlocks).toBe(0); expect(result.next.metrics.corruptBlocks).toBe(1);
    expect(result.next.metrics.cacheDegrades).toBe(0);
    expect(result.sizeAfter).toBe(result.sizeBefore);
    expect(server.requests("game").map(row => row.range)).toEqual([null, "bytes=0-262143"]);
  } finally {await server.close();}
});
