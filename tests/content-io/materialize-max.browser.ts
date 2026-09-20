import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile = async (contents: string) => (await build({stdin: {contents, resolveDir: process.cwd()},
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
for (const backend of ["OPFS", "CACHE_BLOCKS"] as const) {
  test(`[ST-15] BROWSER/max-512MiB-${backend} full output and cached replay @S07`, async ({page}) => {
    test.setTimeout(180000);
    const deny = backend === "CACHE_BLOCKS" ? "navigator.storage.getDirectory = async () => {throw new DOMException('denied', 'NotAllowedError');};" : "";
    const server = await startFixtureServer({contentModule: await compile("export {createContentSession} from './src/content-io/client.ts';"),
      modules: {"worker.mjs": await compile(`import './src/content-io/worker.ts'; ${deny}`)}});
    const identity = server.register({id: "max", fixtureId: "max-eager", behavior: "NORMAL", seed: 17,
      delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async ({identity}) => {
        const url = "/__test__/content.mjs", {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
        const hashes = [], backends = [], receipts = [];
        for (let i = 0; i < 2; i++) {
          const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]});
          try {
            const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/max-eager/max`,
              purpose: "GAME", transport: "WHOLE_ALLOWED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"},
            {mode: "EAGER", bridge: "NONE", result: "BYTES", maxFileBytes: 536870912, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"});
            const value = await session.materialize(reader.id, {kind: "BYTES", maxBytes: 536870912});
            if (value.kind !== "BYTES" || !(value.bytes.buffer instanceof ArrayBuffer) || value.bytes.length !== 536870912) {throw new Error("size or kind");}
            hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value.bytes.buffer)), n => n.toString(16).padStart(2, "0")).join(""));
            backends.push(session.stats.backend); receipts.push(value.receipt);
          } finally {await session.close();}
        }
        return {hashes, backends, receipts};
      }, {identity});
      const sha = identity.identity.kind === "FILE_SHA256" ? identity.identity.sha256 : "";
      expect(result.hashes).toEqual([sha, sha]); expect(result.backends).toEqual([backend, backend]);
      expect(result.receipts[0].storageGeneration).toBe(result.receipts[1].storageGeneration);
      expect(server.requests("max").map(r => r.range)).toEqual([null]);
    } finally {await server.close();}
  });
}
