import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {coreFixturePath} from "./core-fixture.js";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (file: string) => (await build({entryPoints: [file], bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
const runtime = (file: string) => fileURLToPath(new URL(`../../src/${file}.ts`, import.meta.url));
test("[BR-04] BROWSER/play-fork actual polling facade reads above 4GiB through the public Worker @S13", async ({page}) => {
  const server = await startFixtureServer({contentModule: await bundle(runtime("content-io/client")), modules: {
    "worker.mjs": await bundle(runtime("content-io/worker")), "device.mjs": await bundle(await coreFixturePath("play", "js/retrom/disc-device.mjs")),
  }});
  const identity = server.register({id: "game", fixtureId: "big-offset", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity}) => {
      const clientUrl = "/__test__/content.mjs", deviceUrl = "/__test__/device.mjs";
      const {createContentSession} = await import(clientUrl) as typeof import("../../src/content-io/client.js");
      const {discDevice} = await import(deviceUrl) as {discDevice(module: {HEAPU8: Uint8Array}, reader: unknown, fail: (error: Error) => void): {read(pointer: number, offset: number, length: number): void; isDone(): boolean; hasError(): boolean; close(): void}};
      const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]}, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
      try {
        const reader = await session.open({identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/big-offset/game`,
          purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT", },
        {mode: "RANGE", bridge: "POLLING", result: "READER", maxFileBytes: Number.MAX_SAFE_INTEGER, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", });
        const memory = {HEAPU8: new Uint8Array(64)}, errors: string[] = [], device = discDevice(memory, reader, error => errors.push(error.message));
        device.read(8, 4295229424, 32); const pending = !device.isDone(); memory.HEAPU8 = new Uint8Array(64);
        while (!device.isDone()) {await new Promise(resolve => setTimeout(resolve, 10));}
        const bytes = Array.from(memory.HEAPU8.slice(8, 40)); await session.close();
        device.read(8, 4295229424, 32); while (!device.isDone()) {await new Promise(resolve => setTimeout(resolve, 10));}
        device.close(); return {bytes, errors, pending, failed: device.hasError()};
      } finally {await session.close();}
    }, {identity});
    const byteAt = (n: number) => (n % 251 + 17 * (Math.floor(n / 251) % 251) + 31 * (Math.floor(n / 65536) % 251) + 17) % 256;
    expect(result.bytes).toEqual(Array.from({length: 32}, (_, index) => byteAt(4295229424 + index)));
    expect(result).toMatchObject({pending: true, failed: true, errors: ["CONTENT_IO_ABORTED"]}); expect(server.requests("game")).toHaveLength(2);
  } finally {await server.close();}
});
