import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {createHash} from "node:crypto";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (contents: string) => (await build({stdin: {contents, resolveDir: process.cwd(), loader: "ts"},
  bundle: true, format: "esm", platform: "browser", write: false})).outputFiles[0].text;

test("[X-17] BROWSER/completed-workspace-cache reuses its first verification without reading file contents again", async ({page}) => {
  const bytes = Uint8Array.of(1, 2, 3, 4), sha256 = createHash("sha256").update(bytes).digest("hex");
  const server = await startFixtureServer({contentModule: await bundle(`export * from './src/content-io/client.ts';
    export {prepareWorkspaceProject} from './src/content-io/sinks/workspace.ts';`), staticFiles: {game: bytes},
    modules: {"worker.mjs": await bundle("import './src/content-io/worker.ts';")}});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async sha256 => {
      const url = "/__test__/content.mjs", {createContentSession, prepareWorkspaceProject} = await import(url);
      const root = await navigator.storage.getDirectory(), session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
        {storageOrigin: location.origin, allowedOrigins: [location.origin]});
      const source = {identity: {kind: "FILE_SHA256", sha256}, sizeBytes: 4, url: `${location.origin}/files/game`, purpose: "GAME",
        transport: "WHOLE_ALLOWED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"};
      const policy = {mode: "EAGER", bridge: "NONE", result: "WORKSPACE_FILE", maxFileBytes: 4, workspace: "OPFS_REQUIRED", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"};
      const make = () => prepareWorkspaceProject(root, "a".repeat(64), [{path: "game.bin", source}], session, policy, location.origin, 4096);
      const first = await make();
      let second;
      try {
        let directory = root;
        for (const part of first.dataPath.split("/")) {directory = await directory.getDirectoryHandle(part);}
        const handle = await directory.getFileHandle("game.bin"), writer = await handle.createWritable();
        await writer.write(Uint8Array.of(9, 2, 3, 4)); await writer.close();
        const arrayBuffer = Blob.prototype.arrayBuffer;
        Blob.prototype.arrayBuffer = async function () {throw new Error("completed workspace scanned client bytes");};
        try {second = await make();} finally {Blob.prototype.arrayBuffer = arrayBuffer;}
        return {first: first.generation, second: second.generation, bytes: [...new Uint8Array(await (await handle.getFile()).arrayBuffer())]};
      } finally {first.release(); second?.release(); await session.close();}
    }, sha256);
    expect(result.second).toBe(result.first); expect(result.bytes).toEqual([9, 2, 3, 4]);
    expect(server.fileRequests.map(request => request.name)).toEqual(["game"]);
  } finally {await server.close();}
});
