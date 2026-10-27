// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {mkdtemp, readFile, rm, writeFile, access, mkdir, readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {deflateSync} from "node:zlib";
import {Worker} from "node:worker_threads";
import {normalizeContent} from "../scripts/runtime-normalize-content.mjs";
import {tinyPE, tinyFirstBytePE} from "./kirikiri-pe-fixture.js";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(path => rm(path, {recursive: true, force: true})));});
const magic = Buffer.from("5850330d0a200a1a8b6701", "hex");
function u64(value: number) {const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes;}
function chunk(tag: string, bytes: Uint8Array) {return Buffer.concat([Buffer.from(tag), u64(bytes.length), bytes]);}
function indexFile(index: Buffer, compressed = false) {
  const header = Buffer.concat([magic, u64(19)]);
  return Buffer.concat([header, Buffer.from([compressed ? 1 : 0]),
    ...(compressed ? [u64(deflateSync(index).length), u64(index.length), deflateSync(index)] : [u64(index.length), index])]);
}
async function input(bytes: Buffer, name = "data.xp3") {
  const root = await mkdtemp(join(tmpdir(), "kirikiri-normalize-")); roots.push(root);
  const path = join(root, "mounted-source"), prefix = Buffer.from("adjacent-source-bytes");
  await writeFile(path, Buffer.concat([prefix, bytes, prefix]));
  return {platformId: "kirikiri", files: [{logicalKey: name, name, sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")}],
  locators: {[name]: {path, offset: prefix.length, sizeBytes: bytes.length}}, outputRoot: join(root, "output")};
}
it("leaves an ordinary XP3 immutable and does not create a second package", async () => {
  const request = await input(indexFile(Buffer.alloc(0)), "data.bin");
  const original = await readFile(request.locators["data.bin"].path);
  expect((await normalizeContent(request)).files).toEqual(request.files);
  expect(await readFile(request.locators["data.bin"].path)).toEqual(original);
  await expect(access(request.outputRoot)).rejects.toThrow();
});
it("leaves an unsupported Hxv4 variant to the normal import flow when no converter matches", async () => {
  const request = await input(indexFile(chunk("Hxv4", Buffer.alloc(14))));
  const original = await readFile(request.locators["data.xp3"].path);
  expect(await normalizeContent(request)).toEqual({files: request.files});
  expect(await readFile(request.locators["data.xp3"].path)).toEqual(original);
  await expect(access(request.outputRoot)).rejects.toThrow();
});
it("does not claim an unknown XP3 index representation merely from its container signature", async () => {
  const bytes = indexFile(Buffer.alloc(0)); bytes[19] = 3;
  const request = await input(bytes);
  expect(await normalizeContent(request)).toEqual({files: request.files});
  await expect(access(request.outputRoot)).rejects.toThrow();
});
it.each(["eliF", "neko"])("rejects malformed %s name tables without returning unchanged original facts", async tag => {
  const request = await input(indexFile(chunk(tag, Buffer.alloc(5)), true));
  await expect(normalizeContent(request)).rejects.toThrow("RUNTIME_KIRIKIRI_ARCHIVE_INVALID");
  await expect(access(request.outputRoot)).rejects.toThrow();
});
it.each(["eliF", "neko"])("never downgrades known %s to unmatched after a later index error", async tag => {
  for (const index of [Buffer.from(tag), Buffer.concat([chunk(tag, Buffer.alloc(6)), Buffer.from("truncated")])]) {
    const request = await input(indexFile(index));
    await expect(normalizeContent(request)).rejects.toThrow("RUNTIME_KIRIKIRI_ARCHIVE_INVALID");
    await expect(access(request.outputRoot)).rejects.toThrow();
  }
});
it("does not follow an XP3 pointer into an adjacent member of the physical input object", async () => {
  const descriptor = Buffer.concat([u64(1000000), Buffer.alloc(10)]);
  const request = await input(indexFile(chunk("sen:", descriptor)));
  await expect(normalizeContent(request)).rejects.toThrow("RUNTIME_KIRIKIRI_ARCHIVE_INVALID");
});

function adler(bytes: Uint8Array) {
  let a = 1, b = 0;
  for (const byte of bytes) {a = (a + byte) % 65521; b = (b + a) % 65521;}
  return ((b << 16) | a) >>> 0;
}
interface Resource {name: string; bytes: Buffer; declared?: number; h?: number; flags?: number; raw?: boolean}
function protectedXP3(resources: Resource[], tag = "eliF", firstFallback?: number) {
  const parts: Buffer[] = [], rows: Buffer[] = []; let offset = 19;
  for (const resource of resources) {
    const name = resource.name.replace(/[A-Z]/gu, c => c.toLowerCase()), encoded = Buffer.from(name, "utf16le");
    const physical = Buffer.from(createHash("md5").update(encoded).digest("hex"), "utf16le");
    const h = resource.h ?? adler(resource.bytes), fold = (h ^ 0x12345678) >>> 0, key = ((fold ^ (fold >>> 8) ^ (fold >>> 16) ^ (fold >>> 24)) & 255) || 0x55;
    const body = resource.raw ? resource.bytes : Buffer.from(resource.bytes.map(byte => byte ^ key));
    if (!resource.raw && firstFallback !== undefined && body.length) body[0] ^= (fold & 255) || firstFallback;
    const info = Buffer.alloc(22), segment = Buffer.alloc(28), seed = Buffer.alloc(4), names = Buffer.alloc(6);
    info.writeUInt32LE(resource.flags ?? 0x80000000); info.writeBigUInt64LE(BigInt(resource.declared ?? body.length), 4);
    info.writeBigUInt64LE(BigInt(body.length), 12); info.writeUInt16LE(physical.length / 2, 20);
    segment.writeBigUInt64LE(BigInt(offset), 4); segment.writeBigUInt64LE(BigInt(body.length), 12); segment.writeBigUInt64LE(BigInt(body.length), 20);
    seed.writeUInt32LE(h); names.writeUInt32LE(h); names.writeUInt16LE(encoded.length / 2, 4);
    rows.push(chunk(tag, Buffer.concat([names, encoded])), chunk("File", Buffer.concat([chunk("info", Buffer.concat([info, physical])), chunk("segm", segment), chunk("adlr", seed)])));
    parts.push(body); offset += body.length;
  }
  const index = Buffer.concat(rows);
  return Buffer.concat([magic, u64(offset), ...parts, Buffer.from([0]), u64(index.length), index]);
}
function resources(): Resource[] {return ["startup.tjs", "目录/ÄA.TXT", "scene.ks"].map((name, i) => ({name, bytes: Buffer.from(`resource-${i}:` + "中文资源".repeat(20))}));}
async function withModule(bytes: Buffer, module = tinyPE()) {
  const request = await input(bytes), path = join(request.outputRoot, "..", "native-profile");
  await writeFile(path, module);
  request.files.push({logicalKey: "plugin/helper.tpm", name: "plugin/helper.tpm", sizeBytes: module.length, sha256: createHash("sha256").update(module).digest("hex")});
  request.locators["plugin/helper.tpm"] = {path, offset: 0, sizeBytes: module.length};
  return request;
}
function decodedResources(bytes: Buffer) {
  const index = Number(bytes.readBigUInt64LE(11)), size = Number(bytes.readBigUInt64LE(index + 1)), result = new Map<string, Buffer>();
  for (let at = index + 9; at < index + 9 + size;) {
    expect(bytes.toString("ascii", at, at + 4)).toBe("File"); const end = at + 12 + Number(bytes.readBigUInt64LE(at + 4));
    let name = "", position = 0, length = 0;
    for (let sub = at + 12; sub < end;) {
      const tag = bytes.toString("ascii", sub, sub + 4), count = Number(bytes.readBigUInt64LE(sub + 4)), start = sub + 12;
      if (tag === "info") {expect(bytes.readUInt32LE(start)).toBe(0); name = bytes.toString("utf16le", start + 22, start + count);}
      if (tag === "segm") {expect(bytes.readUInt32LE(start)).toBe(0); position = Number(bytes.readBigUInt64LE(start + 4)); length = Number(bytes.readBigUInt64LE(start + 12));}
      sub = start + count;
    }
    result.set(name, bytes.subarray(position, position + length)); at = end;
  }
  return result;
}
it("normalizes a neko name table using statically recovered dual Tiny keys", async () => {
  const items = resources(), request = await withModule(protectedXP3(items, "neko", 0x69), tinyFirstBytePE());
  const original = await readFile(request.locators["data.xp3"].path), result = await normalizeContent(request);
  expect(result.normalization).toMatchObject({archiveCount: 1, verifiedEntries: 3, formatCounts: {"cxfilterfs-neko": 1}});
  const decoded = decodedResources(await readFile(result.files.find(file => file.logicalKey === "data.xp3")!.path!));
  for (const item of items) expect(decoded.get(item.name.replace(/[A-Z]/gu, c => c.toLowerCase()))).toEqual(item.bytes);
  expect(await readFile(request.locators["data.xp3"].path)).toEqual(original);
});
it("keeps first-byte candidates distinct even when their bulk keys collide", async () => {
  const items = resources(); items[2].bytes = Buffer.alloc(131073, 0x97);
  const request = await withModule(protectedXP3(items, "neko", 0x69), tinyFirstBytePE());
  // Equal fold and low byte: one behavior, so accepting both must not become ambiguous.
  // Equal fold but a different low byte: a distinct first key that must fail checksum.
  const modules = [tinyFirstBytePE(0x13355678), tinyFirstBytePE(0x12345779), tinyPE()];
  for (const [i, module] of modules.entries()) {
    const logicalKey = `plugin/candidate-${i}.dll`, path = join(request.outputRoot, "..", `module-${i}`);
    await writeFile(path, module);
    request.files.push({logicalKey, name: logicalKey, sizeBytes: module.length, sha256: createHash("sha256").update(module).digest("hex")});
    request.locators[logicalKey] = {path, offset: 0, sizeBytes: module.length};
  }
  const result = await normalizeContent(request), output = result.files.find(file => file.logicalKey === "data.xp3")!;
  const decoded = decodedResources(await readFile(output.path!));
  expect(decoded.get("scene.ks")).toEqual(items[2].bytes);
  expect(result.normalization).toMatchObject({verifiedEntries: 3, metadataCorrections: 0});
});
it("rejects a wrong first-byte key even when every bulk key is correct", async () => {
  const request = await withModule(protectedXP3(resources(), "neko", 0x69), tinyFirstBytePE(0x12345779));
  await expect(normalizeContent(request)).rejects.toThrow("RUNTIME_KIRIKIRI_FILTER_UNAVAILABLE");
  await expect(access(request.outputRoot)).rejects.toThrow();
});
it("discovers the native-data filter and publishes complete ordinary resources while retaining the mounted source", async () => {
  const items = resources(), request = await withModule(protectedXP3(items));
  const source = await readFile(request.locators["data.xp3"].path), result = await normalizeContent(request);
  const output = result.files.find(file => file.logicalKey === "data.xp3")!;
  expect(output.path).toBe(join(request.outputRoot, "data.xp3"));
  const bytes = await readFile(output.path!), decoded = decodedResources(bytes);
  expect(decoded.size).toBe(items.length);
  for (const item of items) {expect(decoded.get(item.name.replace(/[A-Z]/gu, c => c.toLowerCase()))).toEqual(item.bytes);}
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(output.sha256);
  expect(result.files[1]).toEqual(request.files[1]);
  expect(result.normalization).toMatchObject({archiveCount: 1, verifiedEntries: 3, metadataCorrections: 0});
  expect(await readFile(request.locators["data.xp3"].path)).toEqual(source);
});
it("rejects truncated real resources and checksum failures, and removes all partial outputs", async () => {
  for (const corrupt of [{...resources()[0], declared: 1024, flags: 0}, {...resources()[0], h: 123456}]) {
    const request = await withModule(protectedXP3([...resources(), {...corrupt, name: "bad.tjs"}]));
    await expect(normalizeContent(request)).rejects.toThrow(/RUNTIME_KIRIKIRI_(?:ARCHIVE_INVALID|FILTER_UNAVAILABLE|CHECKSUM_MISMATCH)/u);
    await expect(access(request.outputRoot)).rejects.toThrow();
    await expect(access(request.locators["data.xp3"].path)).resolves.toBeUndefined();
  }
});
it("limits native short-stream correction to independently identified protector warning metadata", async () => {
  const warning = {name: "$$$ this is a protected archive. $$$ warning.txt", bytes: Buffer.from("Warning: Extracting this archive is a synthetic metadata sentinel."),
    declared: 910, flags: 0, h: 1754764004, raw: true};
  const request = await withModule(protectedXP3([...resources(), warning])), result = await normalizeContent(request);
  expect(result.normalization).toMatchObject({verifiedEntries: 3, metadataCorrections: 1});
  expect(result.normalization!.details[0]).toMatchObject({code: "FORMAT_WARNING_SHORT_STREAM", member: warning.name});
  const audit = (await readdir(request.outputRoot)).find(name => name.startsWith(".audit-"))!;
  expect((await readFile(join(request.outputRoot, audit, "entries.jsonl"), "utf8"))).toContain('"sourceIntegrityVerified":false');
});
it("audits a uniform seed-only patch and still rejects checksum errors in mixed-seed archives", async () => {
  const patch = resources().slice(0, 2).map((item, i) => ({...item, name: `patch-${i}.tjs`, h: 123456}));
  const request = await withModule(protectedXP3(resources(), "Yuzu"));
  const bytes = protectedXP3(patch, "Yuzu"), path = join(request.outputRoot, "..", "patch-source"); await writeFile(path, bytes);
  request.files.push({logicalKey: "patch.xp3", name: "patch.xp3", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")});
  request.locators["patch.xp3"] = {path, offset: 0, sizeBytes: bytes.length};
  const result = await normalizeContent(request);
  expect(result.normalization).toMatchObject({archiveCount: 2, verifiedEntries: 3, metadataCorrections: 2});
  expect(result.normalization!.details.map(row => row.code)).toEqual(["REUSED_FILTER_SEED", "REUSED_FILTER_SEED"]);
  const output = await readFile(result.files.find(file => file.logicalKey === "patch.xp3")!.path!);
  expect([...decodedResources(output).values()]).toEqual(patch.map(item => item.bytes));
  const mixed = await withModule(protectedXP3([...resources(), ...patch], "Yuzu"));
  await expect(normalizeContent(mixed)).rejects.toThrow("RUNTIME_KIRIKIRI_CHECKSUM_MISMATCH");
  await expect(access(mixed.outputRoot)).rejects.toThrow();
});
it("converts every protected archive group while preserving ordinary archives, patch paths and deterministic content", async () => {
  const items = resources(), request = await withModule(protectedXP3(items));
  const patch = [{name: "scene.ks", bytes: Buffer.from("汉化补丁覆盖内容".repeat(20))}, ...items.slice(0, 2)];
  const append = async (name: string, bytes: Buffer) => {
    const path = join(request.outputRoot, "..", `source-${request.files.length}`); await writeFile(path, bytes);
    const file = {logicalKey: name, name, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")};
    request.files.push(file); request.locators[name] = {path, offset: 0, sizeBytes: bytes.length}; return file;
  };
  const ordinary = await append("unmodified.xp3", indexFile(Buffer.alloc(0)));
  await append("patch/patch2.xp3", protectedXP3(patch, "Yuzu"));
  const unsupported = await append("optional.xp3", indexFile(chunk("Hxv4", Buffer.alloc(14))));
  const before = await Promise.all(request.files.map(file => readFile(request.locators[file.logicalKey].path)));
  const first = await normalizeContent(request);
  expect(first.normalization).toMatchObject({archiveCount: 2, verifiedEntries: 6, formatCounts: {"cxfilterfs-elif": 1, "cxfilterfs-yuzu": 1},
    plugins: [{id: "kirikiri-cxfilterfs", version: 1, formats: ["cxfilterfs-elif", "cxfilterfs-yuzu"],
      validation: {outputFilesVerified: 2, resourceEntriesVerified: 6}}]});
  expect(first.files.find(file => file.logicalKey === ordinary.logicalKey)).toEqual(ordinary);
  expect(first.files.find(file => file.logicalKey === unsupported.logicalKey)).toEqual(unsupported);
  const data = decodedResources(await readFile(first.files.find(file => file.logicalKey === "data.xp3")!.path!));
  const override = decodedResources(await readFile(first.files.find(file => file.logicalKey === "patch/patch2.xp3")!.path!));
  expect(data.get("scene.ks")).toEqual(items[2].bytes); expect(override.get("scene.ks")).toEqual(patch[0].bytes);
  const second = await normalizeContent({...request, outputRoot: `${request.outputRoot}-second`});
  const facts = (result: typeof first) => result.files.map(({logicalKey, sizeBytes, sha256}) => ({logicalKey, sizeBytes, sha256}));
  expect(facts(second)).toEqual(facts(first)); expect(second.normalization).toEqual(first.normalization);
  expect(await Promise.all(request.files.map(file => readFile(request.locators[file.logicalKey].path)))).toEqual(before);
});
it("cancels its worker and cleans only its own staging directory", async () => {
  const request = await withModule(protectedXP3(resources())), controller = new AbortController();
  const source = await readFile(request.locators["data.xp3"].path);
  const result = normalizeContent(request, controller.signal); controller.abort(new Error("TEST_CANCELLED"));
  await expect(result).rejects.toThrow("TEST_CANCELLED");
  await expect(access(request.outputRoot)).rejects.toThrow();
  expect(await readFile(request.locators["data.xp3"].path)).toEqual(source);
  await mkdir(request.outputRoot); await writeFile(join(request.outputRoot, "existing"), "untouched");
  await expect(normalizeContent(request)).rejects.toThrow();
  expect(await readFile(join(request.outputRoot, "existing"), "utf8")).toBe("untouched");
});
it("reclaims completed output when cancellation arrives during worker termination", async () => {
  const request = await withModule(protectedXP3(resources())), controller = new AbortController();
  const source = await readFile(request.locators["data.xp3"].path), terminate = Worker.prototype.terminate;
  const termination = vi.spyOn(Worker.prototype, "terminate").mockImplementation(function (this: Worker) {
    controller.abort(new Error("LATE_CANCELLED"));
    return terminate.call(this);
  });
  try {
    await expect(normalizeContent(request, controller.signal)).rejects.toThrow("LATE_CANCELLED");
    await expect(access(request.outputRoot)).rejects.toThrow();
    expect(await readFile(request.locators["data.xp3"].path)).toEqual(source);
  } finally {termination.mockRestore();}
});
