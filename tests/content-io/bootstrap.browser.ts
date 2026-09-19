import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {startFixtureServer} from "./fixture-server.mjs";
test("[PK-02] BROWSER/verified-worker [PK-03] BROWSER/verified-worker executes the verified response bytes exactly once @S05", async ({page}) => {
  const bundle = async (name: string) => (await build({entryPoints: [fileURLToPath(new URL(`../../src/content-io/${name}.ts`, import.meta.url))],
    bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
  const worker = await bundle("worker");
  const server = await startFixtureServer({contentModule: await bundle("bootstrap"), modules: {"assets/content-io/worker.mjs": worker}});
  let assetRequests = 0;
  page.on("request", (request) => {if (request.url().endsWith("assets/content-io/worker.mjs")) {assetRequests++;}});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const digest = createHash("sha256").update(worker).digest("hex"), sizeBytes = Buffer.byteLength(worker);
    const result = await page.evaluate(async ({digest, sizeBytes}) => {
      const moduleUrl = "/__test__/content.mjs";
      const {bootstrapContentSession} = await import(moduleUrl) as typeof import("../../src/content-io/bootstrap.js");
      const options = {runtimeBaseURL: `${location.origin}/__test__/`, assetIndex: {"assets/content-io/worker.mjs": {sha256: digest, sizeBytes}},
        storageOrigin: location.origin, allowedOrigins: [location.origin]};
      const session = await bootstrapContentSession(options); await session.close();
      let failure = "";
      try {await bootstrapContentSession({...options, assetIndex: {"assets/content-io/worker.mjs": {sha256: "0".repeat(64), sizeBytes}}});}
      catch (error) {failure = (error as Error).message;}
      return {failure, stats: session.stats};
    }, {digest, sizeBytes});
    expect(result.failure).toBe("CONTENT_IO_CHECKSUM_MISMATCH"); expect(assetRequests).toBe(2);
    expect(result.stats).toMatchObject({pending: 0, files: 0, channels: 0});
  } finally {await server.close();}
});
