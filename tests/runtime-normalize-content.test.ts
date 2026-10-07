// @vitest-environment node
import {afterEach, expect, it} from "vitest";
import {mkdtemp, rm, writeFile, readFile, access} from "node:fs/promises";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {zipSync} from "fflate";
import {normalizeContent} from "../scripts/runtime-normalize-content.mjs";
const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
async function input(name: string, bytes: Uint8Array) {
  const root = await mkdtemp(join(tmpdir(), "retrom-normalize-test-")); roots.push(root);
  const path = join(root, "source"); await writeFile(path, bytes);
  return {platformId: "tyranoscript", files: [{logicalKey: name, name, sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")}], locators: {[name]: path}, outputRoot: join(root, "normalized")};
}
function asar(header: object, data: Uint8Array) {
  const json = Buffer.from(JSON.stringify(header)), payload = 4 + Math.ceil(json.length / 4) * 4;
  const bytes = Buffer.alloc(12 + payload + data.length); bytes.writeUInt32LE(4); bytes.writeUInt32LE(4 + payload, 4);
  bytes.writeUInt32LE(payload, 8); bytes.writeUInt32LE(json.length, 12); json.copy(bytes, 16); bytes.set(data, 12 + payload); return bytes;
}
it("normalizes Electron ASAR into immutable native web files without running its executable", async () => {
  const bytes = Buffer.from("<html>test</html>");
  const request = await input("Desktop/resources/app.asar", asar({files: {"index.html": {size: bytes.length, offset: "0"}}}, bytes));
  const result = await normalizeContent(request);
  expect(result.files).toHaveLength(1); expect(result.files[0].logicalKey).toBe("index.html");
  expect(await readFile(result.files[0].path!)).toEqual(bytes);
  request.files[0].sha256 = "0".repeat(64); request.outputRoot += "-changed";
  await expect(normalizeContent(request)).rejects.toThrow("RUNTIME_CONTENT_CHANGED");
  await expect(access(request.outputRoot)).rejects.toThrow();
});
it("extracts the ZIP appended to an NW executable and rejects unsafe ASAR paths", async () => {
  const zip = zipSync({"index.html": Buffer.from("hello"), "data/#scene.ks": Buffer.from("[text]")});
  const request = await input("Desktop/Game.exe", Buffer.concat([Buffer.from("MZ-not-an-executable-test-prefix"), zip]));
  expect((await normalizeContent(request)).files.map(file => file.logicalKey)).toEqual(["data/#scene.ks", "index.html"]);
  const unsafe = await input("resources/app.asar", asar({files: {"../index.html": {size: 1, offset: "0"}}}, Uint8Array.of(1)));
  await expect(normalizeContent(unsafe)).rejects.toThrow("RUNTIME_ASAR_INVALID");
});
