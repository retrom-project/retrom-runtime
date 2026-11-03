// @vitest-environment node
import {afterEach, expect, it} from "vitest";
import {mkdtemp, mkdir, writeFile, readFile, rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runNormalization} from "../scripts/normalization/pipeline.mjs";
import {normalizers} from "../scripts/normalization/registry.mjs";
import {protectedEnigma} from "./normalization-enigma-fixture.js";
import {enigmaProtector} from "../scripts/normalization/enigma.mjs";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function input(bytes: Buffer) {
  const root = await mkdtemp(join(tmpdir(), "enigma-normalization-")); roots.push(root);
  const path = join(root, "source"), outputRoot = join(root, "output"); await writeFile(path, bytes); await mkdir(outputRoot);
  const file = {logicalKey: "nested/run.exe", name: "run.exe", sha256: sha(bytes), sizeBytes: bytes.length};
  return {platformId: "kirikiri", files: [file], locators: {[file.logicalKey]: {path, offset: 0, sizeBytes: bytes.length}}, outputRoot};
}
it.each([false, true])("extracts virtual resources from statically recovered PE configuration (relocate=%s)", async relocate => {
  const built = protectedEnigma({relocate, large: true}), request = await input(built.bytes);
  const result = await runNormalization(request, normalizers);
  expect(result.files.map(file => file.logicalKey)).toContain("nested/assets/story.txt");
  expect(await readFile(join(request.outputRoot, "nested/assets/story.txt"))).toEqual(built.payload);
  expect(await readFile(join(request.outputRoot, "nested/run.exe"))).toEqual(built.bytes);
});
it("decodes indexed compressed blocks across the 65536-byte logical boundary", async () => {
  const built = protectedEnigma({large: true, compressed: true}), request = await input(built.bytes);
  const result = await runNormalization(request, normalizers);
  expect(result.files.map(file => file.logicalKey)).toContain("nested/assets/story.txt");
  expect(await readFile(join(request.outputRoot, "nested/assets/story.txt"))).toEqual(built.payload);
});
it("declares physical-file replacement from the virtual tree, preserving unrelated siblings", async () => {
  const built = protectedEnigma(), request = await input(built.bytes), source = Buffer.from("old physical data");
  const key = "nested/assets/story.txt", path = join(roots.at(-1)!, "old"); await writeFile(path, source);
  request.files.push({logicalKey: key, name: "story.txt", sizeBytes: source.length, sha256: sha(source)});
  request.locators[key] = {path, offset: 0, sizeBytes: source.length};
  const keep = Buffer.from("sibling"), keepPath = join(roots.at(-1)!, "keep"); await writeFile(keepPath, keep);
  request.files.push({logicalKey: "nested/keep.txt", name: "keep.txt", sizeBytes: keep.length, sha256: sha(keep)});
  request.locators["nested/keep.txt"] = {path: keepPath, offset: 0, sizeBytes: keep.length};
  const result = await runNormalization(request, normalizers);
  expect(await readFile(join(request.outputRoot, key))).toEqual(built.payload);
  expect(result.files.find(file => file.logicalKey === "nested/keep.txt")?.sha256).toBe(sha(keep));
  expect(result.normalization?.details).toContainEqual(expect.objectContaining({code: "CONTAINER_FILE_OVERRIDE", member: key, sourceSha256: sha(source)}));
});
it.each(["../escape.txt", "path\\escape.txt", "%APPDATA%/escape.txt"])("rejects a virtual path outside its executable domain: %s", async path => {
  await expect(runNormalization(await input(protectedEnigma({path}).bytes), normalizers)).rejects.toThrow("RUNTIME_ENIGMA_PATH_INVALID");
});
it("rejects a matched but changed configuration and preserves the source", async () => {
  const built = protectedEnigma(); built.bytes[built.configRaw + 30] ^= 1; const request = await input(built.bytes);
  await expect(runNormalization(request, normalizers)).rejects.toThrow("RUNTIME_ENIGMA_INVALID");
  expect(await readFile(request.locators[request.files[0].logicalKey].path)).toEqual(built.bytes);
});
it("honors cancellation before inspecting a protected source", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(runNormalization(await input(protectedEnigma().bytes), normalizers, controller.signal)).rejects.toThrow();
});
it("checks the immutable locator slice and fails conversion if the source changes after planning", async () => {
  const built = protectedEnigma(), request = await input(built.bytes), locator = request.locators[request.files[0].logicalKey];
  await writeFile(locator.path, Buffer.concat([Buffer.alloc(79, 5), built.bytes, Buffer.alloc(53, 2)])); locator.offset = 79;
  const context = {...request, original: request, sourceContentHash: "a".repeat(64), cache: new Map(), auditRoot: roots.at(-1)!};
  const [plan] = await enigmaProtector.probe(context); expect(plan.outputs).toContain("nested/assets/story.txt");
  const changed = Buffer.from(built.bytes); changed[0x400] ^= 1;
  await writeFile(locator.path, Buffer.concat([Buffer.alloc(79, 5), changed, Buffer.alloc(53, 2)]));
  await expect(enigmaProtector.convert(context, plan)).rejects.toThrow("RUNTIME_CONTENT_CHANGED");
});
