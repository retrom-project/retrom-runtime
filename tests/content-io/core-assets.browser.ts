import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (path: string) => (await build({entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
  bundle: true, format: "esm", platform: "browser", write: false})).outputFiles[0].text;

test("verified core modules execute their delivered bytes once and reuse storage across independent sessions", async ({page}) => {
  const files = {"entry.mjs": new TextEncoder().encode("export const verified = 42;"), "core.wasm": new Uint8Array([0, 97, 115, 109])};
  const assetIndex = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [`assets/test/${name}`,
    {sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length}]));
  const server = await startFixtureServer({contentModule: await bundle("./target-session.ts"), staticFiles: files,
    modules: {"worker.mjs": await bundle("../../src/content-io/worker.ts"), "loader.mjs": await bundle("../../src/provider/core-module.ts")}});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async assetIndex => {
      const clientURL = "/__test__/content.mjs", loaderURL = "/__test__/loader.mjs";
      const {createContentSession, targetContentFixture} = await import(clientURL) as typeof import("./target-session.js");
      const {loadCoreModule} = await import(loaderURL) as typeof import("../../src/provider/core-module.js");
      const outputs = [];
      for (let run = 0; run < 2; run++) {
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]});
        try {
          const loaded = await loadCoreModule({content: {contentSession: targetContentFixture(session, "play-ps2"), assetIndex},
            runtimeBaseURL: `${location.origin}/files/`, assetDirectory: "assets/test/", files: ["entry.mjs", "core.wasm"],
            entry: "entry.mjs", registration: "unused", maximum: 1024, window});
          outputs.push({module: (loaded.module as {verified: number}).verified, urls: Object.values(loaded.assets).every(url => url.startsWith("blob:"))});
          loaded.close(); loaded.close();
          if (Object.keys(loaded.assets).length) {throw new Error("CORE_URL_LEAK");}
        } finally {await session.close();}
      }
      return outputs;
    }, assetIndex);
    expect(result).toEqual([{module: 42, urls: true}, {module: 42, urls: true}]);
    expect(server.fileRequests).toEqual(["entry.mjs", "core.wasm"].map(name => ({name, method: "GET", range: null})));
  } finally {await server.close();}
});
