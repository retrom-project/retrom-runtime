import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile = async (contents: string) => (await build({stdin: {contents, resolveDir: process.cwd()},
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
for (const scenario of ["holes", "strong-prefix", "unbound-prefix", "weak-prefix", "independent"] as const) {
  const tags = scenario === "holes" ? "[ST-09] BROWSER/partial-holes" : scenario === "independent" ? "[X-11] BROWSER/independent-results" : `[ST-12] BROWSER/${scenario}`;
  test(`${tags} @S07`, async ({page}) => {
    const server = await startFixtureServer({contentModule: await compile("export {createContentSession} from './src/content-io/client.ts';"),
      modules: {"worker.mjs": await compile("import './src/content-io/worker.ts';")}});
    const identity = server.register({id: "resume", fixtureId: "multi-tail", behavior: scenario === "unbound-prefix" ? "MISSING_ETAG" : scenario === "weak-prefix" ? "WEAK_ETAG" : "NORMAL",
      seed: 17, delayBeforeHeadersMs: null, chunkDelayMs: 5, disconnectAfterBytes: null, barrier: null});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async ({identity, scenario}) => {
        const url = "/__test__/content.mjs";
        const {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
        const context = {storageOrigin: location.origin, allowedOrigins: [location.origin]};
        const options = {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}};
        const source = {identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/multi-tail/resume`, purpose: scenario === "unbound-prefix" || scenario === "weak-prefix" ? "CORE_ASSET" : "GAME",
          transport: "WHOLE_ALLOWED", etagPolicy: scenario === "unbound-prefix" || scenario === "weak-prefix" ? "NONE_FULL_SHA256" : "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
        const policy = {mode: "EAGER", bridge: "NONE", result: "BYTES", maxFileBytes: source.sizeBytes,
          workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
        const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), n => n.toString(16).padStart(2, "0")).join("");
        let first = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), context, options);
        let aborts = 0, commits = 0, stoppedAt = 0, error = "";
        try {
          if (scenario === "holes") {
            const reader = await first.open({...source, transport: "RANGE_REQUIRED"}, {...policy, mode: "RANGE", bridge: "ASYNC", result: "READER"});
            await reader.readInto(0, new Uint8Array(1)); await reader.readInto(source.sizeBytes - 1, new Uint8Array(1));
          } else if (scenario !== "independent") {
            const reader = await first.open(source, {...policy, result: "WORKSPACE_FILE", workspace: "OPFS_REQUIRED"});
            const controller = new AbortController();
            try {
              await first.materialize(reader.id, {kind: "SINK", maxBytes: source.sizeBytes, createSink: async () => ({
                write: async (offset, chunk) => {stoppedAt = offset + chunk.length; controller.abort();},
                commit: async () => {commits++;}, abort: async () => {aborts++;}})}, controller.signal);
            } catch (cause) {error = String(cause);}
          }
          if (scenario !== "independent") {
            await first.close(); first = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), context, options);
          }
          const reader = await first.open(source, policy);
          const values = await Promise.all([first.materialize(reader.id, {kind: "BYTES", maxBytes: source.sizeBytes}),
            first.materialize(reader.id, {kind: "BYTES", maxBytes: source.sizeBytes})]);
          const a = values[0], b = values[1]; if (a.kind !== "BYTES" || b.kind !== "BYTES") {throw new Error("kind");}
          const hashes = [await hash(a.bytes), await hash(b.bytes)]; a.bytes.fill(0);
          return {hashes, afterMutation: await hash(b.bytes), distinct: a.bytes.buffer !== b.bytes.buffer, aborts, commits, stoppedAt, error};
        } finally {await first.close();}
      }, {identity, scenario});
      const sha = identity.identity.kind === "FILE_SHA256" ? identity.identity.sha256 : "";
      expect(result.hashes).toEqual([sha, sha]); expect(result.afterMutation).toBe(sha); expect(result.distinct).toBe(true);
      const ranges = server.requests("resume").map(r => r.range);
      if (scenario === "holes") {expect(ranges).toEqual(["bytes=0-262143", "bytes=786432-786448", "bytes=262144-524287", "bytes=524288-786431"]);}
      if (scenario === "independent") {expect(ranges).toEqual([null]);}
      if (scenario.endsWith("prefix")) {
        expect(result).toMatchObject({aborts: 1, commits: 0, stoppedAt: 262144}); expect(result.error).toContain("ABORTED");
        if (scenario === "strong-prefix") {expect(ranges).toEqual([null, "bytes=262144-524287", "bytes=524288-786431", "bytes=786432-786448"]);}
        else {expect(ranges).toEqual([null, null]);}
      }
    } finally {await server.close();}
  });
}
