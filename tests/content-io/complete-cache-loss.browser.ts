import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";

const compile = async (contents: string) => (await build({stdin: {contents, resolveDir: process.cwd()},
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
const cases = [
  {kind: "BYTES", behavior: "NORMAL", error: null},
  {kind: "RANGE", behavior: "NORMAL", error: null},
  {kind: "BYTES", behavior: "CHANGED_ETAG", error: "CONTENT_IO_IDENTITY_CHANGED"},
  {kind: "RANGE", behavior: "CHANGED_ETAG", error: "CONTENT_IO_IDENTITY_CHANGED"},
  {kind: "BYTES", behavior: "CORRUPT_BODY", error: "CONTENT_IO_CHECKSUM_MISMATCH"},
] as const;

for (const backend of ["OPFS", "CACHE_BLOCKS"] as const) {
  for (const scenario of cases) {
    test(`[ST-11] BROWSER/${backend}-complete-loss-${scenario.kind}-${scenario.behavior} @S07`, async ({page}) => {
      const forceCache = backend === "CACHE_BLOCKS" ?
        "navigator.storage.getDirectory = async () => {throw new DOMException('fixture selects Cache Storage', 'NotAllowedError');};" : "";
      const server = await startFixtureServer({
        contentModule: await compile("export {createContentSession} from './src/content-io/client.ts'; export {ContentMetadata} from './src/content-io/store/metadata.ts';"),
        modules: {"worker.mjs": await compile("import './src/content-io/worker.ts';" + forceCache)},
      });
      const shape = {fixtureId: "multi-tail", seed: 17, delayBeforeHeadersMs: null,
        chunkDelayMs: null, disconnectAfterBytes: null, barrier: null};
      const identity = server.register({...shape, id: "original", behavior: "NORMAL"});
      server.register({...shape, id: "recovery", behavior: scenario.behavior});
      try {
        await page.goto(`${server.origin}/__test__/page`);
        const result = await page.evaluate(async ({identity, backend, kind}) => {
          const url = "/__test__/content.mjs";
          const {createContentSession, ContentMetadata} = await import(url) as typeof import("../../src/content-io/client.js") & typeof import("../../src/content-io/store/metadata.js");
          const create = () => createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
            {storageOrigin: location.origin, allowedOrigins: [location.origin]},
            {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
          const source = {identity: identity.identity, sizeBytes: identity.sizeBytes,
            url: `${location.origin}/objects/multi-tail/original`, purpose: "GAME", transport: "WHOLE_ALLOWED",
            etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
          const policy = {mode: "EAGER", bridge: "NONE", result: "BYTES", maxFileBytes: identity.sizeBytes,
            workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
          const digest = async (bytes: Uint8Array) => Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), value => value.toString(16).padStart(2, "0")).join("");
          const first = await create();
          let receipt, originalDigest, originalBackend;
          try {
            const reader = await first.open(source, policy);
            const value = await first.materialize(reader.id, {kind: "BYTES", maxBytes: source.sizeBytes});
            if (value.kind !== "BYTES") {throw new Error("unexpected materialization kind");}
            receipt = value.receipt; originalDigest = await digest(value.bytes); originalBackend = first.stats.backend;
          } finally {await first.close();}
          const metadata = await ContentMetadata.open();
          let complete;
          try {complete = await metadata.generation(receipt.objectKey, receipt.storageGeneration);}
          finally {metadata.close();}
          if (complete?.state !== "COMPLETE") {throw new Error("fixture must publish a complete generation before cache loss");}
          // Remove real optional storage bytes only, preserving metadata and source identity.
          if (backend === "CACHE_BLOCKS") {
            const cache = await caches.open("retrom-content-io-v1");
            const location = `${globalThis.location.origin}/__retrom_content_io_v1__/block/${receipt.objectKey}/${receipt.storageGeneration}/0`;
            if (!await cache.delete(location)) {throw new Error("expected cache block was not present");}
          } else {
            const root = await navigator.storage.getDirectory();
            const namespace = await root.getDirectoryHandle("retrom-content-io-v1");
            const objects = await namespace.getDirectoryHandle("objects");
            const directory = await objects.getDirectoryHandle(receipt.objectKey);
            await directory.removeEntry(`${receipt.storageGeneration}.data`);
          }
          const second = await create();
          let recoveredDigest = null, failure = null, tailMatches = null;
          try {
            const current = {...source, url: `${location.origin}/objects/multi-tail/recovery`};
            const reader = await second.open(kind === "RANGE" ? {...current, transport: "RANGE_REQUIRED"} : current,
              kind === "RANGE" ? {...policy, mode: "RANGE", bridge: "ASYNC", result: "READER"} : policy);
            let bytes: Uint8Array<ArrayBuffer>;
            if (kind === "RANGE") {
              bytes = new Uint8Array(source.sizeBytes); await reader.readInto(0, bytes);
            } else {
              const value = await second.materialize(reader.id, {kind: "BYTES", maxBytes: source.sizeBytes});
              if (value.kind !== "BYTES") {throw new Error("unexpected recovery kind");}
              bytes = new Uint8Array(value.bytes);
            }
            recoveredDigest = await digest(bytes);
            if (kind === "RANGE") {
              const tail = new Uint8Array(17); await reader.readInto(source.sizeBytes - tail.length, tail);
              tailMatches = tail.every((byte, index) => byte === bytes[bytes.length - tail.length + index]);
            }
          } catch (error) {failure = (error as Error).message;}
          finally {await second.close();}
          const held = (await navigator.locks.query()).held?.filter(lock => lock.name?.startsWith("retrom-content-io-v1:")) ?? [];
          return {originalDigest, originalBackend, recoveredDigest, failure, tailMatches, held};
        }, {identity, backend, kind: scenario.kind});
        const sha = identity.identity.kind === "FILE_SHA256" ? identity.identity.sha256 : "";
        expect(result.originalDigest).toBe(sha); expect(result.originalBackend).toBe(backend);
        expect(server.requests("original")).toHaveLength(1);
        // The negative controls must reach the changed HTTP source, not merely fail on local cache metadata.
        const recovery = server.requests("recovery");
        expect(recovery.length).toBeGreaterThan(0);
        expect(recovery.every(request => request.ifMatch === identity.etag)).toBe(true);
        expect(result.failure).toBe(scenario.error);
        if (scenario.error === null) {
          expect(result.recoveredDigest).toBe(sha);
          if (scenario.kind === "RANGE") {expect(result.tailMatches).toBe(true);}
          expect(recovery.every(request => request.complete)).toBe(true);
        }
        expect(result.held).toEqual([]);
      } finally {await server.close();}
    });
  }
}
