import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {startFixtureServer} from "./fixture-server.mjs";

test("Sega CD mount uses bounded Range requests and reuses blocks in a new runtime session", async ({page}) => {
  const bundle = async (path: string) => (await build({entryPoints: [fileURLToPath(new URL(`../../src/${path}.ts`, import.meta.url))],
    bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
  const server = await startFixtureServer({contentModule: await bundle("content-io/client"), modules: {
    "disc.mjs": await bundle("providers/emulatorjs/disc-mount"), "worker.mjs": await bundle("content-io/worker"),
  }});
  const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity}) => {
      const clientPath = "/__test__/content.mjs", discPath = "/__test__/disc.mjs";
      const {createContentSession} = await import(clientPath) as typeof import("../../src/content-io/client.js");
      const {mountSeekableContentRange} = await import(discPath) as typeof import("../../src/providers/emulatorjs/disc-mount.js");
      if (identity.identity.kind !== "FILE_SHA256") {throw new Error("fixture identity");}
      const counts = [];
      for (let index = 0; index < 2; index++) {
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}),
          {storageOrigin: location.origin, allowedOrigins: [location.origin]},
          {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
        const frame = {File, EJS_gameUrl: undefined};
        try {
          const before = (await (await fetch("/__test__/requests/game")).json() as unknown[]).length;
          const range = await mountSeekableContentRange(frame as never,
            {url: `${location.origin}/objects/multi-tail/game`, sha256: identity.identity.sha256, sizeBytes: identity.sizeBytes},
            new AbortController().signal, error => {throw error;}, session);
          const marker = (frame as Record<string, unknown>).EJS_gameUrl;
          if (!(marker instanceof File) || marker.size > 64) {throw new Error("whole disc mounted");}
          const bytes = await range.read(262140, 19);
          if (bytes.length !== 19) {throw new Error("short read");}
          await range.dispose();
          const requests = (await (await fetch("/__test__/requests/game")).json() as {range: string | null}[]).slice(before);
          counts.push(requests.map(request => request.range));
        } finally {await session.close();}
      }
      return counts;
    }, {identity});
    expect(result[0].length).toBeGreaterThan(0);
    expect(result[0].length).toBeLessThanOrEqual(3);
    expect(result[0].every(range => typeof range === "string" && /^bytes=\d+-\d+$/u.test(range))).toBe(true);
    expect(result[1]).toEqual([]);
  } finally {await server.close();}
});
