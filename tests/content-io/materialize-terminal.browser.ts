import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile = async (contents: string) => (await build({stdin: {contents, resolveDir: process.cwd()},
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
for (const failure of ["write", "commit", "last-ack-cancel"] as const) {
  test(`[X-12] BROWSER/stream-${failure} @S07`, async ({page}) => {
    const client = await compile(`export {createContentSession} from './src/content-io/client.ts';
      import {PortRPC} from './src/content-io/bridge/async.ts'; export const acknowledgements = [];
      const send = PortRPC.prototype.send; PortRPC.prototype.send = function(message) {
        if (message.type === 'JOB_ACK') acknowledgements.push(message.chunkIndex); return send.call(this, message);
      };`);
    const server = await startFixtureServer({contentModule: client, modules: {"worker.mjs": await compile("import './src/content-io/worker.ts';")}});
    const identity = server.register({id: "terminal", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
      delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
    try {
      await page.goto(`${server.origin}/__test__/page`);
      const result = await page.evaluate(async ({identity, failure}) => {
        const url = "/__test__/content.mjs";
        const {createContentSession, acknowledgements} = await import(url) as typeof import("../../src/content-io/client.js") & {acknowledgements: number[]};
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]});
        try {
          const source = {identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/multi-tail/terminal`, purpose: "GAME",
            transport: "WHOLE_ALLOWED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
          const policy = {mode: "EAGER", bridge: "NONE", result: "WORKSPACE_FILE", maxFileBytes: source.sizeBytes,
            workspace: "OPFS_REQUIRED", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
          const reader = await session.open(source, policy), controller = new AbortController();
          const progress: boolean[] = [], aborts: string[] = []; let commits = 0, terminal = "", writes = 0;
          try {
            await session.materialize(reader.id, {kind: "SINK", maxBytes: source.sizeBytes, createSink: async () => ({
              write: async (offset, bytes) => {
                writes++; if (offset + bytes.length !== source.sizeBytes) {return;}
                if (failure === "write") {throw new Error("write failed");}
                if (failure === "last-ack-cancel") {controller.abort(); await new Promise(resolve => setTimeout(resolve, 0));}
              },
              commit: async () => {commits++; if (failure === "commit") {throw new Error("commit failed");}},
              abort: async reason => {aborts.push(reason);}})}, controller.signal, value => progress.push(value.committed));
            terminal = "SUCCESS";
          } catch (cause) {terminal = String(cause);}
          const acks = [...acknowledgements];
          const next = await session.open(source, {...policy, result: "BYTES", workspace: "NONE"});
          const value = await session.materialize(next.id, {kind: "BYTES", maxBytes: source.sizeBytes});
          if (value.kind !== "BYTES") {throw new Error("kind");}
          return {terminal, aborts, commits, writes, progress, acks, recovered: value.receipt.localSha256};
        } finally {await session.close();}
      }, {identity, failure});
      expect(result.terminal).toContain(failure === "last-ack-cancel" ? "ABORTED" : "WORKSPACE_UNAVAILABLE");
      expect(result.aborts).toEqual([failure === "last-ack-cancel" ? "CANCELLED" : "FAILED"]);
      expect(result.commits).toBe(failure === "commit" ? 1 : 0); expect(result.writes).toBe(4); expect(result.progress).not.toContain(true);
      expect(result.acks).toEqual(failure === "commit" ? [0, 1, 2, 3] : [0, 1, 2]);
      expect(result.recovered).toBe(identity.identity.kind === "FILE_SHA256" ? identity.identity.sha256 : "");
      expect(server.requests("terminal").map(r => r.range)).toEqual([null]);
    } finally {await server.close();}
  });
}
