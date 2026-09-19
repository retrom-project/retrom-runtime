import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (path: string) => (await build({entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
for (const engine of ["ons", "nxengine"] as const) {
  test(`[X-18] BROWSER/${engine}-file-set [HP-02] BROWSER/${engine}-progress cold and new-session warm loading keeps its original file set`, async ({page}) => {
    const names = engine === "ons" ? ["0.txt"] : ["Doukutsu.exe", "data/npc.tbl", "data/Stage/Start.pxm", "data/Stage/Start.tsc"];
    const index = new TextEncoder().encode(JSON.stringify({schemaVersion: 1, files: names.map((path, i) => ({path, sizeBytes: 4, url: `/files/game${i}`}))}));
    const staticFiles = {index, unrelated: new Uint8Array([99]), ...Object.fromEntries(names.map((_, i) => [`game${i}`, new Uint8Array([i, 1, 2, 3])]))};
    const server = await startFixtureServer({contentModule: await bundle("../../src/content-io/client.ts"), staticFiles, modules: {
      "worker.mjs": await bundle("../../src/content-io/worker.ts"),
      "project.mjs": await bundle(engine === "ons" ? "../../src/ons/project-files.ts" : "../../src/nxengine/project.ts"),
    }});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async engine => {
        const clientUrl = "/__test__/content.mjs", projectUrl = "/__test__/project.mjs";
        const {createContentSession} = await import(clientUrl) as typeof import("../../src/content-io/client.js");
        const outputs = [], progress: {loadedBytes: number; totalBytes: number | null}[][] = [], writes: number[] = [];
        for (let n = 0; n < 2; n++) {
          const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]});
          const events: {loadedBytes: number; totalBytes: number | null}[] = [];
          try {
            if (engine === "ons") {
              const {createOnsProjectFileMap} = await import(projectUrl) as typeof import("../../src/ons/project-files.js");
              const map = createOnsProjectFileMap([{path: "0.txt", sizeBytes: 4, url: "/files/game0"},
                {path: "unopened.nsa", sizeBytes: 512 * 1024 * 1024, url: "/files/unrelated"}], window, value => events.push(value),
              {contentSession: session, projectDigest: "a".repeat(64)});
              const written: number[][] = [], fs = {writeFile: (_path: string, bytes: Uint8Array) => {written.push(Array.from(bytes)); bytes.fill(99);}};
              try {
                const read = await Promise.all([map.fetchFile(fs, "/game/0.txt"), map.fetchFile(fs, "/GAME/0.TXT")]);
                if (read.some(value => value !== 1)) {throw new Error("FILE_LOAD_FAILED");}
                await map.fetchFile(fs, "/game/0.txt");
                outputs.push(written); writes.push(written.length);
              } finally {await map.close();}
            } else {
              const {loadProject} = await import(projectUrl) as typeof import("../../src/nxengine/project.js");
              const files = await loadProject("/files/index", value => events.push(value), undefined, session, "b".repeat(64));
              outputs.push(files.map(file => ({path: file.path, bytes: Array.from(file.bytes)})));
            }
            progress.push(events);
          } finally {await session.close();}
        }
        return {outputs, progress, writes};
      }, engine);
      expect(result.outputs[0]).toEqual(result.outputs[1]);
      const requests = server.fileRequests.filter(row => row.name !== "index");
      expect(requests.map(row => row.name).sort()).toEqual(names.map((_, i) => `game${i}`).sort());
      expect(requests.every(row => row.range === null)).toBe(true);
      if (engine === "ons") {
        expect(result.outputs).toEqual([[[0, 1, 2, 3]], [[0, 1, 2, 3]]]); expect(result.writes).toEqual([1, 1]);
        expect(result.progress).toEqual([[], []]);
      } else {
        expect(result.outputs[0]).toEqual(names.map((path, i) => ({path, bytes: [i, 1, 2, 3]})));
        for (const events of result.progress) {
          expect(events.filter(value => value.loadedBytes === 16)).toHaveLength(1);
          expect(events.every(value => value.totalBytes === 16)).toBe(true);
        }
      }
    } finally {await server.close();}
  });
}
