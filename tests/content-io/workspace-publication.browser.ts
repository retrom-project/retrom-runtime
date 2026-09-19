import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (path: string) => (await build({entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
for (const locks of [true, false]) {
  test(`[X-25] BROWSER/workspace-locks-${locks} concurrent generations and metadata names remain isolated`, async ({page}) => {
    const index = new TextEncoder().encode(JSON.stringify({schemaVersion: 1, files: [
      {path: "data.win", sizeBytes: 4, url: "/files/game"}, {path: "meta/complete-v1.json", sizeBytes: 3, url: "/files/legal"},
    ]}));
    const server = await startFixtureServer({contentModule: await bundle("../../src/content-io/client.ts"),
      staticFiles: {index, game: new Uint8Array([1, 2, 3, 4]), legal: new Uint8Array([5, 6, 7])}, modules: {
        "worker.mjs": await bundle("../../src/content-io/worker.ts"), "project.mjs": await bundle("../../src/butterscotch/project-store.ts"),
      }});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async locks => {
        const clientUrl = "/__test__/content.mjs", projectUrl = "/__test__/project.mjs";
        const {createContentSession} = await import(clientUrl) as typeof import("../../src/content-io/client.js");
        const {prepareButterscotchProject} = await import(projectUrl) as typeof import("../../src/butterscotch/project-store.js");
        if (!locks) {Object.defineProperty(navigator, "locks", {value: undefined});}
        const sessions = await Promise.all([0, 1, 2].map(() => createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]})));
        const projects: Awaited<ReturnType<typeof prepareButterscotchProject>>[] = [];
        const config = {contentDigest: "a".repeat(64), projectIndexUrl: "/files/index"};
        const prepare = async (n: number) => {
          const project = await prepareButterscotchProject({...config, sessionId: `instance-${n}`}, window, () => {}, {contentSession: sessions[n], assetIndex: {}});
          projects.push(project); return project;
        };
        try {
          const [first, second] = await Promise.all([prepare(0), prepare(1)]), third = await prepare(2);
          const root = await navigator.storage.getDirectory(), directory = await (await root.getDirectoryHandle("projects")).getDirectoryHandle(config.contentDigest);
          let pointer: {generation: string} | null = null;
          try {pointer = JSON.parse(await (await (await directory.getFileHandle(".content-io-current-v1.json")).getFile()).text()) as {generation: string};}
          catch (error) {if (!(error instanceof DOMException) || error.name !== "NotFoundError") {throw error;}}
          const paths = [first, second, third].map(p => p.gamePath), legal = [];
          for (const path of paths) {
            const generation = path.split("/").at(-3)!;
            const data = await (await directory.getDirectoryHandle(generation)).getDirectoryHandle("data");
            legal.push(Array.from(new Uint8Array(await (await (await (await data.getDirectoryHandle("meta")).getFileHandle("complete-v1.json")).getFile()).arrayBuffer())));
          }
          return {paths, pointer, legal, saves: projects.map(p => p.savePath)};
        } finally {for (const project of projects) {project.release();} await Promise.all(sessions.map(session => session.close()));}
      }, locks);
      expect(result.legal).toEqual([[5, 6, 7], [5, 6, 7], [5, 6, 7]]);
      expect(new Set(result.saves).size).toBe(3);
      if (locks) {
        expect(result.pointer).not.toBeNull();
        expect(result.paths[2]).toContain(`/${result.pointer!.generation}/data/`);
        expect(result.paths.slice(0, 2)).toContain(result.paths[2]);
      } else {
        expect(new Set(result.paths).size).toBe(3); expect(result.pointer).toBeNull();
      }
    } finally {await server.close();}
  });
}
test("[X-17] BROWSER/workspace-published-abort keeps a completed generation after its pointer becomes visible", async ({page}) => {
  const index = new TextEncoder().encode(JSON.stringify({schemaVersion: 1, files: [{path: "data.win", sizeBytes: 4, url: "/files/game"}]}));
  const server = await startFixtureServer({contentModule: await bundle("../../src/content-io/client.ts"),
    staticFiles: {index, game: new Uint8Array([1, 2, 3, 4])}, modules: {
      "worker.mjs": await bundle("../../src/content-io/worker.ts"), "project.mjs": await bundle("../../src/butterscotch/project-store.ts"),
    }});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async () => {
      const clientUrl = "/__test__/content.mjs", projectUrl = "/__test__/project.mjs";
      const {createContentSession} = await import(clientUrl) as typeof import("../../src/content-io/client.js");
      const {prepareButterscotchProject} = await import(projectUrl) as typeof import("../../src/butterscotch/project-store.js");
      const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]});
      const controller = new AbortController(), original = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = async function(options) {
        const writer = await original.call(this, options), close = writer.close.bind(writer);
        if (this.name === ".content-io-current-v1.json") {writer.close = async () => {await close(); controller.abort();};}
        return writer;
      };
      const config = {contentDigest: "a".repeat(64), projectIndexUrl: "/files/index", sessionId: "aborted"};
      let failure = "", restored: Awaited<ReturnType<typeof prepareButterscotchProject>> | undefined;
      try {
        try {await prepareButterscotchProject(config, window, () => {}, {contentSession: session, assetIndex: {}, signal: controller.signal});}
        catch (error) {failure = (error as Error).message;}
        FileSystemFileHandle.prototype.createWritable = original;
        const root = await navigator.storage.getDirectory(), project = await (await root.getDirectoryHandle("projects")).getDirectoryHandle(config.contentDigest);
        const pointer = JSON.parse(await (await (await project.getFileHandle(".content-io-current-v1.json")).getFile()).text()) as {generation: string};
        const generation = await project.getDirectoryHandle(pointer.generation), data = await generation.getDirectoryHandle("data");
        const bytes = Array.from(new Uint8Array(await (await (await data.getFileHandle("data.win")).getFile()).arrayBuffer()));
        restored = await prepareButterscotchProject({...config, sessionId: "survivor"}, window, () => {}, {contentSession: session, assetIndex: {}});
        return {failure, bytes, path: restored.gamePath, generation: pointer.generation};
      } finally {FileSystemFileHandle.prototype.createWritable = original; restored?.release(); await session.close();}
    });
    expect(result.failure).toMatch(/ABORTED/u); expect(result.bytes).toEqual([1, 2, 3, 4]);
    expect(result.path).toContain(`/${result.generation}/data/`);
    expect(server.fileRequests.filter(request => request.name === "game")).toHaveLength(1);
  } finally {await server.close();}
});
