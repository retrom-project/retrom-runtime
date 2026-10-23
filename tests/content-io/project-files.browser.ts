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
    const archive = Uint8Array.from({length: 4 * 1024 * 1024}, (_, i) => (i * 31 + 7) & 255);
    const staticFiles = {index, unrelated: new Uint8Array([99]), archive, ...Object.fromEntries(names.map((_, i) => [`game${i}`, new Uint8Array([i, 1, 2, 3])]))};
    const server = await startFixtureServer({contentModule: await bundle("./target-session.ts"), staticFiles, modules: {
      "worker.mjs": await bundle("../../src/content-io/worker.ts"),
      "project.mjs": await bundle(engine === "ons" ? "../../src/ons/project-files.ts" : "../../src/nxengine/project.ts"),
    }});
    try {
      await page.exposeFunction("fileRequestCount", () => server.fileRequests.length);
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async engine => {
        const clientUrl = "/__test__/content.mjs", projectUrl = "/__test__/project.mjs";
        const {createContentSession, targetContentFixture} = await import(clientUrl) as typeof import("./target-session.js");
        const outputs = [], progress: {loadedBytes: number; totalBytes: number | null}[][] = [], requestsBySession: number[] = [];
        for (let n = 0; n < 2; n++) {
          const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]});
          const events: {loadedBytes: number; totalBytes: number | null}[] = [];
          try {
            if (engine === "ons") {
              const {createOnsProjectFileMap} = await import(projectUrl) as typeof import("../../src/ons/project-files.js");
              const map = createOnsProjectFileMap([{path: "0.txt", sizeBytes: 4, url: "/files/game0"},
                {path: "arc.nsa", sizeBytes: 4 * 1024 * 1024, url: "/files/archive"},
                {path: "unopened.nsa", sizeBytes: 512 * 1024 * 1024, url: "/files/unrelated"}], window, value => events.push(value),
              {contentSession: targetContentFixture(session, "onscripter-yuri"), projectDigest: "a".repeat(64)});
              const counter = window as unknown as {fileRequestCount(): Promise<number>};
              const before = await counter.fileRequestCount();
              try {
                const [script, upper] = await Promise.all([map.bridge.open("/game/0.txt"), map.bridge.open("/GAME/0.TXT")]);
                const arc = await map.bridge.open("/game/arc.nsa");
                if (script <= 0 || upper <= 0 || arc <= 0) {throw new Error("FILE_OPEN_FAILED");}
                const text = await map.bridge.read(script, 0, 4), again = await map.bridge.read(upper, 0, 4);
                const tail = await map.bridge.read(arc, 3 * 1024 * 1024, 65536);
                if (!text || !again || !tail) {throw new Error("FILE_READ_FAILED");}
                outputs.push([Array.from(text), Array.from(again), Array.from(tail.subarray(0, 8)), tail.length]);
                for (const handle of [script, upper, arc]) {map.bridge.close(handle);}
              } finally {await map.close();}
              requestsBySession.push(await counter.fileRequestCount() - before);
            } else {
              const {loadProject} = await import(projectUrl) as typeof import("../../src/nxengine/project.js");
              const files = await loadProject("/files/index", value => events.push(value), undefined, targetContentFixture(session, "nxengine"), "b".repeat(64));
              outputs.push(files.map(file => ({path: file.path, bytes: Array.from(file.bytes)})));
            }
            progress.push(events);
          } finally {await session.close();}
        }
        return {outputs, progress, requestsBySession};
      }, engine);
      expect(result.outputs[0]).toEqual(result.outputs[1]);
      const requests = server.fileRequests.filter(row => row.name !== "index");
      if (engine === "ons") {
        const expectedTail = Array.from(archive.subarray(3 * 1024 * 1024, 3 * 1024 * 1024 + 8));
        expect(result.outputs).toEqual([[[0, 1, 2, 3], [0, 1, 2, 3], expectedTail, 65536], [[0, 1, 2, 3], [0, 1, 2, 3], expectedTail, 65536]]);
        expect(result.progress).toEqual([[], []]);
        // The archive is read by range only, and the second runtime instance reuses the cached blocks.
        expect(requests.map(row => row.name).sort()).toEqual(["archive", "game0"].concat(requests.filter(row => row.name === "archive").slice(1).map(() => "archive")).sort());
        const archiveRanges = requests.filter(row => row.name === "archive").map(row => /^bytes=(\d+)-(\d+)$/u.exec(row.range ?? ""));
        expect(archiveRanges.every(Boolean)).toBe(true);
        expect(archiveRanges.reduce((sum, match) => sum + Number(match![2]) - Number(match![1]) + 1, 0)).toBeLessThanOrEqual(1024 * 1024);
        expect(result.requestsBySession[1]).toBe(0);
        expect(requests.some(row => row.name === "unrelated")).toBe(false);
      } else {
        expect(requests.map(row => row.name).sort()).toEqual(names.map((_, i) => `game${i}`).sort());
        expect(requests.every(row => row.range === null)).toBe(true);
        expect(result.outputs[0]).toEqual(names.map((path, i) => ({path, bytes: [i, 1, 2, 3]})));
        for (const events of result.progress) {
          expect(events.filter(value => value.loadedBytes === 16)).toHaveLength(1);
          expect(events.every(value => value.totalBytes === 16)).toBe(true);
        }
      }
    } finally {await server.close();}
  });
}
