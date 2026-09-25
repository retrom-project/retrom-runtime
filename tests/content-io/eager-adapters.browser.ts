import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (path: string) => (await build({entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
for (const name of ["tic80", "fake08", "gbe", "px68k", "np2kai", "openbor", "ruffle", "webmsx", "wasm4", "nxengine"]) {
  test(`[X-26] BROWSER/${name} [ST-03] BROWSER/${name} [IO-22] BROWSER/${name} cold then independent-session OPFS reuse and MEMORY-only materialization @S16`, async ({page}) => {
    const bytes = new Uint8Array(16); bytes.set(name === "ruffle" ? [70,87,83,9,16,0,0,0] : name === "wasm4" ? [0,97,115,109,1,0,0,0] : [80,65,67,75]);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const server = await startFixtureServer({contentModule: await bundle("../../src/content-io/client.ts"), staticFiles: {game: bytes}, modules: {
      "worker.mjs": await bundle("../../src/content-io/worker.ts"), "eager.mjs": await bundle("./eager-entry.ts"),
      "memory.mjs": `import './worker.mjs'; Object.defineProperty(globalThis, 'indexedDB', {value: undefined});`,
    }});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async ({name, sha256}) => {
        const clientUrl = "/__test__/content.mjs", eagerUrl = "/__test__/eager.mjs";
        const {createContentSession} = await import(clientUrl) as typeof import("../../src/content-io/client.js");
        const eager = await import(eagerUrl) as typeof import("./eager-entry.js");
        const outputs = [], backends = [], progress: number[][] = [];
        for (const worker of ["worker.mjs", "worker.mjs", "memory.mjs"]) {
          const session = await createContentSession(new Worker(`/__test__/${worker}`, {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]});
          const source = {url: `${location.origin}/files/game`, sizeBytes: 16, sha256}, reported: number[] = [];
          const report = (v: {loadedBytes: number}) => reported.push(v.loadedBytes);
          try {
            let value: Uint8Array | Blob;
            switch (name) {
              case "tic80": case "fake08": value = await eager.verifiedFetch(source.url, 16, sha256, undefined, session); break;
              case "gbe": value = await eager.gbe(source, n => reported.push(n), undefined, session); break;
              case "px68k": value = await eager.px68k(source, n => reported.push(n), undefined, session); break;
              case "np2kai": value = await eager.loadDisk(source, report, session); break;
              case "openbor": value = await eager.fetchPak(source, report, session); break;
              case "ruffle": value = await eager.fetchSwf({swfUrl:source.url,swfSizeBytes:16,contentDigest:sha256},report,session); break;
              case "webmsx": value = await eager.fetchMedia({mediaUrl:source.url,mediaSizeBytes:16,contentDigest:sha256},report,session); break;
              case "wasm4": value = await eager.fetchCart({cartUrl:source.url,cartSizeBytes:16,contentDigest:sha256,runtimeBaseUrl:location.origin},report,{contentSession:session,assetIndex:{}}); break;
              case "nxengine": value = await eager.fetchContent({...source,path:"game.bin"},n=>reported.push(n),undefined,session,"a".repeat(64)); break;
              default: throw new Error("fixture");
            }
            outputs.push(Array.from(value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value));
            if (value instanceof Uint8Array) {value.fill(99);} backends.push(session.stats.backend); progress.push(reported);
          } finally {await session.close();}
        }
        return {outputs, backends, progress, namespaces: await caches.keys()};
      }, {name, sha256});
      expect(result.outputs).toEqual([Array.from(bytes),Array.from(bytes),Array.from(bytes)]);
      expect(result.backends).toEqual(["OPFS","OPFS","MEMORY"]);
      expect(server.fileRequests).toEqual([{name:"game",method:"GET",range:null},{name:"game",method:"GET",range:null}]);
      expect(result.namespaces.every(ns => !/retrom-(gbe|px68k|np2kai|openbor|ruffle|webmsx|nxengine)/u.test(ns))).toBe(true);
      if (!["tic80","fake08"].includes(name)) {expect(result.progress.every(values => values.filter(n=>n===16).length===1)).toBe(true);}
    } finally {await server.close();}
  });
}

test("[IO-22] BROWSER/PUAE eager Content I/O reuses one full download across independent sessions", async ({page}) => {
  const bytes = new Uint8Array(1024 * 1024 + 13);
  bytes.set(new TextEncoder().encode("MComprHD"));
  bytes.fill(47, 8);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const server = await startFixtureServer({contentModule: await bundle("../../src/content-io/client.ts"),
    staticFiles: {"game.chd": bytes}, modules: {"worker.mjs": await bundle("../../src/content-io/worker.ts"),
      "eager.mjs": await bundle("./eager-entry.ts")}});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({sha256, sizeBytes}) => {
      const clientUrl = "/__test__/content.mjs", eagerUrl = "/__test__/eager.mjs";
      const {createContentSession} = await import(clientUrl) as typeof import("../../src/content-io/client.js");
      const {mountEagerContentFile} = await import(eagerUrl) as typeof import("./eager-entry.js");
      const results = [];
      for (let run = 0; run < 2; run++) {
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]});
        const progress: number[] = [];
        try {
          const file = await mountEagerContentFile(window,
            {url: `${location.origin}/files/game.chd`, sha256, sizeBytes}, new AbortController().signal,
            () => {}, session, ready => progress.push(ready));
          results.push({filename: file.filename, first: [...file.read(0, 8)], last: [...file.read(sizeBytes - 1, 1)],
            progress, backend: session.stats.backend});
          await file.dispose();
        } finally {await session.close();}
      }
      return results;
    }, {sha256, sizeBytes: bytes.length});
    expect(result).toHaveLength(2);
    expect(result.map(run => run.backend)).toEqual(["OPFS", "OPFS"]);
    expect(result.map(run => run.filename)).toEqual(["game.chd", "game.chd"]);
    expect(result.map(run => run.first)).toEqual([[77, 67, 111, 109, 112, 114, 72, 68], [77, 67, 111, 109, 112, 114, 72, 68]]);
    expect(result.map(run => run.last)).toEqual([[47], [47]]);
    expect(result.every(run => run.progress.at(-1) === bytes.length)).toBe(true);
    expect(server.fileRequests).toEqual([{name: "game.chd", method: "GET", range: null}]);
  } finally {await server.close();}
});
