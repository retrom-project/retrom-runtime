import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {fixtureBytes, byteAt} from "./fixture-bytes.mjs";
import {startFixtureServer} from "./fixture-server.mjs";

const block = 262144;
const sizeBytes = block * 3 + 17;
const digest = "a".repeat(64);
const indexPath = `/runtime/content/game/${digest}/index.json`;
const gamePath = `/runtime/content/game/${digest}/game.zip`;
const bundle = async (path: string) => (await build({
  entryPoints: [fileURLToPath(new URL(`../../src/${path}.ts`, import.meta.url))],
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022",
})).outputFiles[0].text;

test("DOS virtual ZIP uses bounded Range requests and reuses blocks in a second runtime instance", async ({page, context}) => {
  const server = await startFixtureServer({contentModule: await bundle("content-io/client"), modules: {
    "dosbox.mjs": await bundle("providers/emulatorjs/dosbox-range"),
    "worker.mjs": await bundle("content-io/worker"),
  }});
  const requests: Array<{range: string | null; bytes: number}> = [];
  try {
    await context.route(`**${indexPath}`, route => route.fulfill({status: 200, contentType: "application/json",
      headers: {"Cross-Origin-Resource-Policy": "same-origin"},
      body: JSON.stringify({schemaVersion: 1, files: [{path: "game.zip", url: gamePath, sizeBytes}]})}));
    await context.route(`**${gamePath}`, async route => {
      const range = route.request().headers().range ?? null;
      const match = /^bytes=(\d+)-(\d+)$/u.exec(range ?? "");
      if (!match) {requests.push({range, bytes: 0}); await route.fulfill({status: 400}); return;}
      const start = Number(match[1]), end = Number(match[2]), length = end - start + 1;
      if (start < 0 || end >= sizeBytes || length > block || length < 1) {
        requests.push({range, bytes: 0}); await route.fulfill({status: 416}); return;
      }
      requests.push({range, bytes: length});
      await route.fulfill({status: 206, body: Buffer.from(fixtureBytes(start, length)), headers: {
        "Content-Type": "application/octet-stream", "Content-Range": `bytes ${start}-${end}/${sizeBytes}`,
        "Content-Length": String(length), ETag: '"projected-zip-v1"',
        "Cross-Origin-Resource-Policy": "same-origin",
      }});
    });
    await page.exposeFunction("dosRequestCount", () => requests.length);
    await page.goto(`${server.origin}/__test__/page`);
    const results = await page.evaluate(async ({indexPath, digest, block}) => {
      const modulePaths = {content: "/__test__/content.mjs", dosbox: "/__test__/dosbox.mjs"};
      const {createContentSession} = await import(modulePaths.content) as typeof import("../../src/content-io/client.js");
      const {prepareDOSBundle} = await import(modulePaths.dosbox) as typeof import("../../src/providers/emulatorjs/dosbox-range.js");
      const outputs = [];
      for (let instance = 0; instance < 2; instance++) {
        const count = () => (window as unknown as {dosRequestCount: () => Promise<number>}).dosRequestCount();
        const before = await count();
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]},
          {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: block}});
        let bytes: number[] = [], backend = "", filename = "";
        try {
          const {range} = await prepareDOSBundle({indexUrl: indexPath, contentDigest: digest}, session,
            new AbortController().signal, () => {});
          try {filename = range.filename; bytes = Array.from(await range.read(block + 11, 4)); backend = session.stats.backend;}
          finally {await range.dispose();}
        } finally {await session.close();}
        outputs.push({filename, bytes, backend, before, after: await count()});
      }
      return outputs;
    }, {indexPath, digest, block});
    for (const result of results) {expect(result).toMatchObject({filename: "game.zip",
      bytes: [0, 1, 2, 3].map(index => byteAt(block + 11 + index)), backend: "OPFS"});}
    expect(results[0].after).toBeGreaterThan(results[0].before);
    expect(results[1].after).toBe(results[1].before);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(request => request.range?.startsWith("bytes=") &&
      request.bytes > 0 && request.bytes <= block)).toBe(true);
  } finally {await server.close();}
});
