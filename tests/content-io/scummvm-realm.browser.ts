import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile = async (path: string) => (await build({entryPoints: [`src/${path}.ts`], bundle: true,
  format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
test("[BR-10] BROWSER/scummvm-cross-realm iframe destinations cross the public Reader and retain consumer ownership", async ({page}) => {
  const server = await startFixtureServer({contentModule: await compile("content-io/client"), modules: {
    "files.mjs": await compile("scummvm/files"), "worker.mjs": await compile("content-io/worker"),
  }});
  const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({sizeBytes}) => {
      const url = "/__test__/content.mjs", {createContentSession} = await import(url) as typeof import("../../src/content-io/client.js");
      const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]});
      const iframe = document.createElement("iframe");
      try {
        await new Promise<void>(resolve => {iframe.onload = () => resolve(); iframe.src = "/__test__/page"; document.body.append(iframe);});
        const frame = iframe.contentWindow as Window & typeof globalThis;
        const {ScummvmFiles} = await frame.eval("import('/__test__/files.mjs')") as typeof import("../../src/scummvm/files.js");
        const files = new ScummvmFiles({schemaVersion: 1, files: [{path: "game.bin", sizeBytes, url: `${location.origin}/objects/multi-tail/game`}]}, "a".repeat(64), session);
        try {
          const bytes = await files.read("/game/game.bin", 0, 3), foreign = bytes instanceof frame.Uint8Array && !(bytes instanceof Uint8Array);
          const first = Array.from(bytes); bytes.fill(255); structuredClone(bytes, {transfer: [bytes.buffer]});
          return {foreign, first, next: Array.from(await files.read("/game/game.bin", 0, 3)), detached: bytes.byteLength === 0};
        } finally {await files.close();}
      } finally {await session.close(); iframe.remove();}
    }, {sizeBytes: identity.sizeBytes});
    expect(result).toEqual({foreign: true, detached: true, first: [17, 18, 19], next: [17, 18, 19]});
    expect(server.requests("game")).toHaveLength(1);
  } finally {await server.close();}
});
