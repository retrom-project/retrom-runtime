import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";

const B = 262144;
for (const scenario of ["overflow", "cancel"] as const) {
  test(`bounded completion preserves ${scenario} and stops the actual HTTP body`, async ({page}) => {
    const module = (await build({entryPoints: ["src/content-io/http.ts"], bundle: true,
      format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
    const total = 128 * 1024 * 1024;
    let sentBytes = 0, requests = 0, closed = false;
    const server = createServer((request, response) => {
      if (request.url === "/http.mjs") {
        response.writeHead(200, {"Content-Type": "text/javascript"}); response.end(module); return;
      }
      if (request.url !== "/game") {
        response.writeHead(200, {"Content-Type": "text/html"}); response.end("<!doctype html>"); return;
      }
      requests++;
      response.on("close", () => {closed = true;});
      response.writeHead(206, {"Content-Type": "application/octet-stream", "Content-Range": `bytes 0-${2 * B - 1}/${8 * B}`,
        ETag: '"limits-v1"', ...(scenario === "cancel" ? {"Content-Length": 2 * B} : {})});
      if (scenario === "cancel") {response.write(new Uint8Array(B)); sentBytes += B; return;}
      const chunk = new Uint8Array(65536);
      const send = () => {
        while (!response.destroyed && sentBytes < total) {
          sentBytes += chunk.length;
          if (!response.write(chunk)) {response.once("drain", send); return;}
        }
        if (!response.destroyed) response.end();
      };
      send();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      await page.goto(origin);
      const error = await page.evaluate(async ({scenario, B}) => {
        const url = `${location.origin}/http.mjs`;
        const {fetchRangeInto} = await import(url) as typeof import("../../src/content-io/http.js");
        const controller = new AbortController();
        try {
          await fetchRangeInto({identity: {kind: "INDEX_ENTRY", projectDigest: "a".repeat(64), logicalPath: "game.bin"},
            sizeBytes: 8 * B, url: `${location.origin}/game`, purpose: "GAME", transport: "RANGE_REQUIRED",
            etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT"},
          {generation: "test", pinnedEtag: null, revoked: false}, 0, new Uint8Array(2 * B), controller.signal,
          {consumed: () => {if (scenario === "cancel") controller.abort();}});
          return "unexpected success";
        } catch (cause) {return (cause as Error).message;}
      }, {scenario, B});
      expect(error).toBe(scenario === "cancel" ? "CONTENT_IO_ABORTED" : "CONTENT_IO_LENGTH_MISMATCH");
      await expect.poll(() => closed).toBe(true);
      expect(requests).toBe(1);
      // Accepted socket writes include OS/network-service buffers, so they are
      // not the JS temporary-memory gauge. Detect eager draining of the entire
      // oversized response; the credit tests assert the separate 16 MiB budget.
      expect(sentBytes).toBeLessThan(total);
    } finally {await new Promise<void>(resolve => server.close(() => resolve()));}
  });
}
