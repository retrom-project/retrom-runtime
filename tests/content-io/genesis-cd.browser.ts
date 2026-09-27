import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {startFixtureServer} from "./fixture-server.mjs";

test("Sega CD mount uses bounded Range requests and reuses blocks in a new runtime session", async ({page}) => {
  const bundle = async (path: string) => (await build({entryPoints: [fileURLToPath(new URL(`../../src/${path}.ts`, import.meta.url))],
    bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
  const server = await startFixtureServer({contentModule: await bundle("../tests/content-io/target-session"), modules: {
    "disc.mjs": await bundle("providers/emulatorjs/disc-mount"), "worker.mjs": await bundle("content-io/worker"),
  }});
  const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity}) => {
      const clientPath = "/__test__/content.mjs", discPath = "/__test__/disc.mjs";
      const {createContentSession, targetContentFixture} = await import(clientPath) as typeof import("./target-session.js");
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
            new AbortController().signal, error => {throw error;}, targetContentFixture(session, "genesis-plus-gx-cd"));
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
    // Reading block 1 authorizes the immediately adjacent block-2 prefetch.
    // Scheduling may finish that optional request before the Reader closes.
    const required = ["bytes=0-262143", "bytes=262144-524287", `bytes=786432-${identity.sizeBytes - 1}`];
    const allowed = new Set([...required, "bytes=524288-786431"]);
    expect(result[0]).toEqual(expect.arrayContaining(required));
    expect(new Set(result[0]).size).toBe(result[0].length);
    expect(result[0].every(range => typeof range === "string" && allowed.has(range))).toBe(true);
    expect(result[1]).toEqual([]);
  } finally {await server.close();}
});
