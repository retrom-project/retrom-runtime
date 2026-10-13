// @vitest-environment node
import {createHash} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import {contentSessionFixture} from "../../tests/content-session-fixture.js";
import {loadCore} from "./core.js";

const owners: ReturnType<typeof contentSessionFixture>[] = [];
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
afterEach(async () => {await Promise.all(owners.splice(0).map(owner => owner.close())); vi.unstubAllGlobals();});

function fixture(size: number) {
  const base = "https://retrom.test/", family = "mame-test.wasm";
  const files: Record<string, Uint8Array> = {"mame-common.mjs": new Uint8Array(size).fill(32),
    "mame-common.wasm": new Uint8Array([1, 2, 3]), [family]: new Uint8Array([4, 5, 6])};
  const assets = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, {sizeBytes: bytes.length, sha256: sha(bytes)}]));
  files["mame-build.json"] = new TextEncoder().encode(JSON.stringify({schemaVersion: 1, adapterAbi: "retrom-mame-dylink-v1",
    buildId: "a".repeat(64), assets, families: {test: {module: family, arcade: true, machines: ["game"]}}}));
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const address = String(url), name = new URL(address).pathname.split("/").at(-1)!;
    const response = new Response(Uint8Array.from(files[name])); Object.defineProperty(response, "url", {value: address}); return response;
  });
  vi.stubGlobal("fetch", fetcher);
  const owner = contentSessionFixture(new URL(base).origin); owners.push(owner);
  const content = {contentSession: owner.session, assetIndex: Object.fromEntries(Object.entries(files)
    .map(([name, bytes]) => [`assets/mame/${name}`, {sizeBytes: bytes.length, sha256: sha(bytes)}]))};
  const config = {arcade: true as const, machine: "game", runtimeBaseUrl: base,
    game: {url: base + "game.zip", sha256: "b".repeat(64), sizeBytes: 22}, parents: [], deviceBios: []};
  // Stop at the module boundary: this test exercises actual Content IO verification,
  // while product verification executes the real compiled native module.
  const loader = vi.fn(async () => {throw Error("TEST_MODULE_BOUNDARY_REACHED");});
  return {config, content, loader, fetcher};
}

it("verifies an enlarged Current loader before reaching the module boundary", async () => {
  const sample = fixture(2 * 1024 * 1024 + 65536);
  await expect(loadCore(sample.config, sample.content, sample.loader)).rejects.toThrow("TEST_MODULE_BOUNDARY_REACHED");
  expect(sample.loader).toHaveBeenCalledOnce();
});

it("rejects a loader beyond its bounded size before fetching or executing it", async () => {
  const sample = fixture(4 * 1024 * 1024 + 1);
  await expect(loadCore(sample.config, sample.content, sample.loader)).rejects.toThrow("CONTENT_IO_SOURCE_INVALID");
  expect(sample.loader).not.toHaveBeenCalled();
  expect(sample.fetcher.mock.calls.some(([url]) => String(url).endsWith("mame-common.mjs"))).toBe(false);
});
