import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (path: string) => (await build({entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
for (const damage of ["receipt", "incomplete", "same-size"]) {
  test(`[X-17] BROWSER/workspace-${damage} [ST-05] BROWSER/workspace-${damage} [ST-16] BROWSER/workspace-${damage} rejects damaged generations and preserves native saves`, async ({page}) => {
    const index = new TextEncoder().encode(JSON.stringify({schemaVersion: 1, files: [{path: "data.win", sizeBytes: 4, url: "/files/game"}]}));
    const server = await startFixtureServer({contentModule: await bundle("../../src/content-io/client.ts"),
      staticFiles: {index, game: new Uint8Array([1, 2, 3, 4])}, modules: {
        "worker.mjs": await bundle("../../src/content-io/worker.ts"), "project.mjs": await bundle("../../src/butterscotch/project-store.ts"),
      }});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async damage => {
        const clientUrl = "/__test__/content.mjs", projectUrl = "/__test__/project.mjs";
        const {createContentSession} = await import(clientUrl) as typeof import("../../src/content-io/client.js");
        const {prepareButterscotchProject} = await import(projectUrl) as typeof import("../../src/butterscotch/project-store.js");
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]});
        const config = {contentDigest: "a".repeat(64), projectIndexUrl: "/files/index"}, projects: Awaited<ReturnType<typeof prepareButterscotchProject>>[] = [];
        const prepare = async (id: string) => {
          const project = await prepareButterscotchProject({...config, sessionId: id}, window, () => {}, {contentSession: session, assetIndex: {}});
          projects.push(project); return project;
        };
        const write = async (handle: FileSystemFileHandle, value: string | Uint8Array<ArrayBuffer>) => {
          const writer = await handle.createWritable(); await writer.write(value); await writer.close();
        };
        try {
          const first = await prepare("one"), root = await navigator.storage.getDirectory();
          const parent = await (await root.getDirectoryHandle("projects")).getDirectoryHandle(config.contentDigest);
          const old = await parent.getDirectoryHandle(first.gamePath.split("/").at(-3)!), meta = await old.getDirectoryHandle("meta");
          const saves = await root.getDirectoryHandle("saves"), saveOne = await saves.getDirectoryHandle("one");
          await write(await saveOne.getFileHandle("native.sav", {create: true}), new Uint8Array([8, 9]));
          if (damage === "incomplete") {await meta.removeEntry("complete-v1.json");}
          else if (damage === "receipt") {
            const handle = await meta.getFileHandle("complete-v1.json"), marker = JSON.parse(await (await handle.getFile()).text()) as {projectDigest: string};
            marker.projectDigest = "b".repeat(64); await write(handle, JSON.stringify(marker));
          } else {await write(await (await old.getDirectoryHandle("data")).getFileHandle("data.win"), new Uint8Array([9, 9, 9, 9]));}
          const second = await prepare("two"), generation = await parent.getDirectoryHandle(second.gamePath.split("/").at(-3)!);
          const bytes = Array.from(new Uint8Array(await (await (await (await generation.getDirectoryHandle("data")).getFileHandle("data.win")).getFile()).arrayBuffer()));
          let secondMissing = false;
          try {await (await saves.getDirectoryHandle("two")).getFileHandle("native.sav");}
          catch (error) {if (!(error instanceof DOMException) || error.name !== "NotFoundError") {throw error;} secondMissing = true;}
          const saved = Array.from(new Uint8Array(await (await (await saveOne.getFileHandle("native.sav")).getFile()).arrayBuffer()));
          await parent.getDirectoryHandle(first.gamePath.split("/").at(-3)!);
          return {first: first.gamePath, second: second.gamePath, bytes, saved, secondMissing};
        } finally {for (const project of projects) {project.release();} await session.close();}
      }, damage);
      expect(result.first).not.toBe(result.second); expect(result.bytes).toEqual([1, 2, 3, 4]);
      expect(result.saved).toEqual([8, 9]); expect(result.secondMissing).toBe(true);
      expect(server.fileRequests.filter(request => request.name === "game")).toHaveLength(1);
    } finally {await server.close();}
  });
}
