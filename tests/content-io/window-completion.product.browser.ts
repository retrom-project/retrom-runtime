import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";

const B = 262144, count = 384;
const payload = Uint8Array.from({length: 2 * B}, (_, index) => index % 251);

for (const realm of ["page", "worker"] as const) for (const transport of ["range", "whole-window"] as const) {
  test(`bounded ${transport} responses finish successfully after EOF in the ${realm}`, async ({page, context}) => {
    const module = (await build({entryPoints: ["src/content-io/http.ts"], bundle: true,
      format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
    const server = createServer((request, response) => {
      if (request.url?.startsWith("/object?")) {
        response.writeHead(transport === "range" ? 206 : 200, {"Content-Type": "application/octet-stream", "Content-Length": payload.length,
          ...(transport === "range" ? {"Content-Range": `bytes ${2 * B}-${4 * B - 1}/${4 * B}`} : {}),
          ETag: '"completion-v1"', "Cache-Control": "no-store"});
        response.end(payload);
      } else if (request.url === "/http.mjs") {
        response.writeHead(200, {"Content-Type": "text/javascript"}); response.end(module);
      } else {
        response.writeHead(200, {"Content-Type": "text/html"}); response.end("<!doctype html><title>Window completion</title>");
      }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const failed: {url: string; error: string | null}[] = [], finished: string[] = [];
    const relevant = (url: string) => url.startsWith(`${origin}/object?`);
    context.on("requestfailed", request => {
      if (relevant(request.url())) failed.push({url: request.url(), error: request.failure()?.errorText ?? null});
    });
    context.on("requestfinished", request => {if (relevant(request.url())) finished.push(request.url());});
    try {
      await page.goto(origin);
      const result = await page.evaluate(async ({realm, transport, count, B}) => {
        const run = async ({transport, count, B}: {transport: string; count: number; B: number}) => {
          const moduleURL = `${location.origin}/http.mjs`;
          const {fetchRangeInto, fetchWholeWindow} = await import(moduleURL) as typeof import("../../src/content-io/http.js");
          const destination = new Uint8Array(2 * B);
          for (let iteration = 0; iteration < count; iteration++) {
            const source = {identity: {kind: "INDEX_ENTRY", projectDigest: "a".repeat(64), logicalPath: "game.bin"},
              sizeBytes: transport === "range" ? 4 * B : 2 * B, url: `${location.origin}/object?iteration=${iteration}`, purpose: "GAME",
              transport: transport === "range" ? "RANGE_REQUIRED" : "WHOLE_ALLOWED", etagPolicy: "PIN_STRONG",
              contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
            const state = {generation: "test", pinnedEtag: null, revoked: false}, signal = new AbortController().signal;
            if (transport === "range") await fetchRangeInto(source, state, 2 * B, destination, signal);
            else {
              let offset = 0;
              for await (const bytes of fetchWholeWindow(source, state, signal)) {destination.set(bytes, offset); offset += bytes.length;}
            }
            for (let index = 0; index < destination.length; index++) {
              if (destination[index] !== index % 251) throw new Error("BYTES_MISMATCH");
            }
          }
          return {completed: count, bytesPerResponse: destination.length};
        };
        if (realm === "page") return run({transport, count, B});
        const workerURL = URL.createObjectURL(new Blob([
          `self.onmessage = async ({data}) => {try {postMessage({result: await (${run.toString()})(data)});}
          catch (error) {postMessage({error: error.message});}};`,
        ], {type: "text/javascript"}));
        const worker = new Worker(workerURL, {type: "module"});
        try {
          return await new Promise<{completed: number; bytesPerResponse: number}>((resolve, reject) => {
            worker.onerror = event => reject(new Error(event.message));
            worker.onmessage = ({data}) => data.error ? reject(new Error(data.error)) : resolve(data.result);
            worker.postMessage({transport, count, B});
          });
        } finally {worker.terminate(); URL.revokeObjectURL(workerURL);}
      }, {realm, transport, count, B});
      expect(result).toEqual({completed: count, bytesPerResponse: 2 * B});
      await expect.poll(() => finished.length + failed.length).toBe(count);
      expect(failed, "A complete, validated response must not be recorded as ERR_ABORTED").toEqual([]);
      expect(finished).toHaveLength(count);
    } finally {await new Promise<void>(resolve => server.close(() => resolve()));}
  });
}
