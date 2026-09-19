import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {startFixtureServer} from "./fixture-server.mjs";

test("[IO-05] BROWSER/transport @S03", async ({page}) => {
  const built = await build({entryPoints: [fileURLToPath(new URL("../../src/content-io/http.ts", import.meta.url))],
    bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"});
  const server = await startFixtureServer({contentModule: built.outputFiles[0].text});
  try {
    const identity = server.register({id: "large", fixtureId: "big-offset", behavior: "NORMAL", seed: 17,
      delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity}) => {
      const moduleUrl = "/__test__/content.mjs";
      const http = await import(moduleUrl) as typeof import("../../src/content-io/http.js");
      const state = {generation: "test", pinnedEtag: null, revoked: false};
      const bytes = await http.fetchRangeBlock({identity: identity.identity, sizeBytes: identity.sizeBytes,
        url: `${location.origin}/objects/big-offset/large`, purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG",
        contentLengthPolicy: "EXACT_IF_PRESENT", }, state, 16384);
      return {length: bytes.length, first: bytes[0], pinned: state.pinnedEtag};
    }, {identity});
    expect(result).toEqual({length: 262144, first: 147, pinned: '"fixture-big-offset-v1"'});
    expect(server.requests("large").map((entry) => entry.range)).toEqual(["bytes=4294967296-4295229439"]);
    expect(server.requests("large")[0].sentBytes).toBe(262144);
  } finally {await server.close();}
});

test("[IO-11] BROWSER/transport [IO-14] BROWSER/transport @S03", async ({page}) => {
  const built = await build({entryPoints: [fileURLToPath(new URL("../../src/content-io/http.ts", import.meta.url))],
    bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"});
  const server = await startFixtureServer({contentModule: built.outputFiles[0].text});
  try {
    for (const [id, behavior] of [["whole", "IGNORE_RANGE"], ["etag", "MISSING_ETAG"]]) {
      const identity = server.register({id, fixtureId: "multi-tail", behavior, seed: 17,
        delayBeforeHeadersMs: null, chunkDelayMs: 1, disconnectAfterBytes: null, barrier: null});
      await page.goto(`${server.origin}/__test__/page`);
      const message = await page.evaluate(async ({id, identity}) => {
        const moduleUrl = "/__test__/content.mjs";
        const http = await import(moduleUrl) as typeof import("../../src/content-io/http.js");
        try {
          await http.fetchRangeBlock({identity: identity.identity, sizeBytes: identity.sizeBytes,
            url: `${location.origin}/objects/multi-tail/${id}`, purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256",
            contentLengthPolicy: "EXACT_IF_PRESENT", }, {generation: "test", pinnedEtag: null, revoked: false}, 0);
          return "unexpected success";
        } catch (error) {return error instanceof Error ? error.message : "unknown";}
      }, {id, identity});
      expect(message).toBe(id === "whole" ? "CONTENT_IO_RANGE_UNSUPPORTED" : "CONTENT_IO_IDENTITY_CHANGED");
      expect(server.requests(id)).toHaveLength(1);
      expect(server.requests(id)[0].range).toBe("bytes=0-262143");
    }
  } finally {await server.close();}
});
