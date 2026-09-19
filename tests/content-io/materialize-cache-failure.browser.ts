import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile = async (contents: string) => (await build({stdin: {contents, resolveDir: process.cwd()},
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
for (const backend of ["cache-put", "idb-commit"] as const) {
  for (const kind of ["BYTES", "SINK"] as const) {
    test(`[ST-13] BROWSER/${backend}-${kind} [X-13] BROWSER/${backend}-${kind} @S07`, async ({page}) => {
      const injection = backend === "cache-put" ? `
        navigator.storage.getDirectory = async () => {throw new DOMException('denied', 'NotAllowedError');};
        const original = Cache.prototype.put; let failed = false;
        Cache.prototype.put = async function(...args) {
          if (!failed) {failed = true; throw new DOMException('quota', 'QuotaExceededError');}
          return original.apply(this, args);
        };` : `
        const original = ContentMetadata.prototype.update; let failed = false;
        ContentMetadata.prototype.update = async function(...args) {
          if (!failed && args[4] && 'index' in args[4]) {failed = true; throw new Error('injected commit failure');}
          return original.apply(this, args);
        };`;
      const server = await startFixtureServer({contentModule: await compile("export {createContentSession} from './src/content-io/client.ts'; export {ContentMetadata} from './src/content-io/store/metadata.ts';"),
        modules: {"worker.mjs": await compile(`import {ContentMetadata} from './src/content-io/store/metadata.ts'; import './src/content-io/worker.ts'; ${injection}`)}});
      const identity = server.register({id: "cache-failure", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
        delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
      try {
        await page.goto(`${server.origin}/__test__/page`);
        const result = await page.evaluate(async ({identity, kind}) => {
          const url = "/__test__/content.mjs";
          const {createContentSession, ContentMetadata} = await import(url) as typeof import("../../src/content-io/client.js") & typeof import("../../src/content-io/store/metadata.js");
          const worker = new Worker("/__test__/worker.mjs", {type: "module"});
          const session = await createContentSession(worker, {storageOrigin: location.origin, allowedOrigins: [location.origin]});
          const metadata = await ContentMetadata.open();
          try {
            const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes,
              url: `${location.origin}/objects/multi-tail/cache-failure`, purpose: "GAME", transport: "WHOLE_ALLOWED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"},
            {mode: "EAGER", bridge: "NONE", result: kind === "SINK" ? "WORKSPACE_FILE" : "BYTES", maxFileBytes: identity.sizeBytes,
              workspace: kind === "SINK" ? "OPFS_REQUIRED" : "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"});
            let written = 0, commits = 0, aborts = 0; const output = new Uint8Array(identity.sizeBytes);
            const value = await session.materialize(reader.id, kind === "BYTES" ? {kind, maxBytes: identity.sizeBytes} : {
              kind, maxBytes: identity.sizeBytes, createSink: async () => ({
                write: async (offset, bytes) => {if (offset !== written) {throw new Error("order");} output.set(bytes, offset); written += bytes.length;},
                commit: async () => {commits++;}, abort: async () => {aborts++;}})});
            const bytes = value.kind === "BYTES" ? value.bytes : output;
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), n => n.toString(16).padStart(2, "0")).join("");
            const generations = await metadata.generations(value.receipt.objectKey);
            return {hash, receipt: value.receipt, states: generations.map(g => g.state), commits, aborts, written};
          } finally {metadata.close(); await session.close();}
        }, {identity, kind});
        const sha = identity.identity.kind === "FILE_SHA256" ? identity.identity.sha256 : "";
        expect(result.hash).toBe(sha); expect(result.receipt).toMatchObject({sizeBytes: identity.sizeBytes, localSha256: sha, assurance: "EXPECTED_SHA256"});
        expect(result.states).not.toContain("COMPLETE"); expect(result.aborts).toBe(0);
        if (kind === "SINK") {expect(result.commits).toBe(1); expect(result.written).toBe(identity.sizeBytes);}
        expect(server.requests("cache-failure").map(r => r.range)).toEqual([null]);
      } finally {await server.close();}
    });
  }
}
