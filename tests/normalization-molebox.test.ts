// @vitest-environment node
import {afterEach, expect, it} from "vitest";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {molebox4} from "../scripts/normalization/molebox.mjs";
import {fixture, sourcePE, type Resource} from "./normalization-molebox-fixture.js";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function request(bytes: Buffer) {
  const root = await mkdtemp(join(tmpdir(), "molebox-normalizer-")); roots.push(root);
  const path = join(root, "source.exe"), outputRoot = join(root, "output"); await writeFile(path, bytes); await mkdir(outputRoot);
  const file = {logicalKey: "nested/launch.exe", name: "launch.exe", sizeBytes: bytes.length, sha256: digest(bytes)};
  const files = [file], locators = {[file.logicalKey]: {path, offset: 0, sizeBytes: bytes.length}};
  return {platformId: "kirikiri", files, locators, original: {files, locators}, auditRoot: root,
    sourceContentHash: "a".repeat(64), cache: new Map(), outputRoot};
}
async function launchers(first: Resource[], second: Resource[]) {
  const input = await request(fixture({resources: first}).bytes), bytes = fixture({resources: second, relocate: true}).bytes;
  const file = {logicalKey: "nested/other.exe", name: "other.exe", sizeBytes: bytes.length, sha256: digest(bytes)};
  const path = join(input.auditRoot, "other.exe"); await writeFile(path, bytes);
  input.files.push(file); input.locators[file.logicalKey] = {path, offset: 0, sizeBytes: bytes.length};
  return input;
}
it("selects a dominating namespace only after verifying the shared executable and every inherited payload", async () => {
  const common = [{name: "engine.exe", flags: 0x17, bytes: sourcePE({}).bytes}, {name: "base.xp3", bytes: Buffer.from("base") }];
  const input = await launchers(common, [...common, {name: "extra.xp3", bytes: Buffer.from("extra") }]);
  const plans = await molebox4.probe(input);
  expect(plans).toHaveLength(1); expect(plans[0].launchDomain).toBe("nested/other.exe");
  const result = await molebox4.convert(input, plans[0]);
  const audit = JSON.parse(await readFile(join(input.auditRoot, "molebox-" + digest(Buffer.from("nested/other.exe")) + ".json"), "utf8"));
  expect(audit.coalescedLaunchers).toEqual(["nested/launch.exe"]);
  expect(result.files.some(file => file.logicalKey.endsWith("/extra.xp3"))).toBe(true);
  expect(await readFile(input.locators["nested/launch.exe"].path)).toEqual(fixture({resources: common}).bytes);
});
it.each(["conflicting-resource", "different-engine", "no-executable"])("keeps %s launch domains independent", async mode => {
  const common = [{name: "engine.exe", flags: mode === "no-executable" ? 7 : 0x17, bytes: sourcePE({}).bytes},
    {name: "base.xp3", bytes: Buffer.from("base") }];
  const other = common.map(row => ({...row, bytes: Buffer.from(row.bytes)}));
  if (mode !== "no-executable") other[mode === "conflicting-resource" ? 1 : 0].bytes[1] ^= 3;
  const input = await launchers(common, [...other, {name: "extra.xp3", bytes: Buffer.from("extra") }]);
  expect(await molebox4.probe(input)).toHaveLength(2);
});
it("coalesces byte-identical namespaces deterministically and still verifies corrupt aliases", async () => {
  const common = [{name: "engine.exe", flags: 0x17, bytes: sourcePE({}).bytes}];
  const input = await launchers(common, common);
  const plans = await molebox4.probe(input);
  expect(plans).toHaveLength(1); expect(plans[0].launchDomain).toBe("nested/launch.exe");
  const locator = input.locators["nested/other.exe"], bytes = await readFile(locator.path);
  bytes[fixture({resources: common, relocate: true}).corruptBlockAt + 2] ^= 3;
  await writeFile(locator.path, bytes);
  input.files[1].sha256 = digest(bytes);
  await expect(molebox4.probe(input)).rejects.toThrow("RUNTIME_MOLEBOX_INVALID");
});
it.each([false, true])("restores all named files from loader-derived offsets/keys and preserves the executable (relocated=%s)", async relocate => {
  const built = fixture({relocate}), input = await request(built.bytes), plans = await molebox4.probe(input);
  expect(molebox4.phase).toBe("container"); expect(plans).toHaveLength(1);
  expect(plans[0].outputs).toEqual(["nested/launch.exe", "nested/resources/boot.ks", "nested/resources/large.bin", "nested/resources/notes.txt"]);
  const result = await molebox4.convert(input, plans[0]);
  for (const resource of built.resources) expect(await readFile(join(input.outputRoot, "nested/resources", resource.name))).toEqual(resource.bytes);
  expect(await readFile(join(input.outputRoot, "nested/launch.exe"))).toEqual(built.bytes);
  expect(result.files).toHaveLength(4); expect(result.summary?.verifiedEntries).toBe(3);
});
it("does not claim an unrelated PE/overlay", async () => {
  const input = await request(Buffer.concat([sourcePE({}).bytes.subarray(0, 128), Buffer.alloc(1024)]));
  expect(await molebox4.probe(input)).toEqual([]);
});
it("leaves an ordinary large PE image unmatched before applying container allocation limits", async () => {
  const end = 33 * 1024 * 1024, bytes = Buffer.alloc(end + 8);
  sourcePE({}).bytes.subarray(0, 512).copy(bytes);
  bytes.writeUInt32LE(end - 0x1200, 0x178 + 40 + 8); bytes.writeUInt32LE(end - 0x1200, 0x178 + 40 + 16);
  expect(await molebox4.probe(await request(bytes))).toEqual([]);
});
it.each([["badCatalog", "RUNTIME_MOLEBOX_INVALID"], ["invalidName", "RUNTIME_MOLEBOX_PATH_INVALID"],
  ["injected", "RUNTIME_MOLEBOX_INJECTION_UNSUPPORTED"], ["cycle", "RUNTIME_MOLEBOX_INVALID"], ["duplicate", "RUNTIME_MOLEBOX_INVALID"],
  ["externalMount", "RUNTIME_MOLEBOX_UNSUPPORTED"]] as const)("fails closed for recognized %s", async (property, error) => {
  await expect(molebox4.probe(await request(fixture({[property]: true}).bytes))).rejects.toThrow(error);
});
it("retains a truly unnamed node by its native MD5 instead of guessing or discarding its name", async () => {
  const built = fixture({hidden: true}), input = await request(built.bytes), [plan] = await molebox4.probe(input);
  const result = await molebox4.convert(input, plan);
  expect(result.files.some(file => file.logicalKey === "nested/resources/boot.ks")).toBe(false);
  const descriptor = result.files.find(file => file.logicalKey.endsWith("/index.json"));
  expect(descriptor).toBeDefined();
  const index = JSON.parse(await readFile(join(input.outputRoot, descriptor!.logicalKey), "utf8"));
  const hash = createHash("md5").update(Buffer.from("RESOURCES\\BOOT.KS", "utf16le")).digest("hex");
  expect(index.kind).toBe("molebox4-steelbox");
  const hidden = index.entries.find((entry: {hash: string}) => entry.hash === hash);
  expect(hidden.flags).toBe(7);
  expect(await readFile(join(input.outputRoot, hidden.path))).toEqual(built.resources[0].bytes);
  expect(await readFile(join(input.outputRoot, "nested/launch.exe"))).toEqual(built.bytes);
});
it.each([0x17, 0x20, 0x40])("distinguishes executable-node flags from physical-file fallback (%i)", async flags => {
  const built = fixture({resources: [{name: "payload.bin", flags, bytes: Buffer.from("native bytes")}]});
  const probing = molebox4.probe(await request(built.bytes));
  if (flags === 0x17) expect(await probing).toHaveLength(1);
  else await expect(probing).rejects.toThrow("RUNTIME_MOLEBOX_UNSUPPORTED");
});
it("retains multiple hidden names that share the same native storage blocks", async () => {
  const bytes = Buffer.from("one physical block, two query names");
  const input = await request(fixture({resources: [{name: "one.bin", flags: 7, bytes},
    {name: "two.bin", flags: 0x17, bytes, aliasOf: 0}]}).bytes);
  const [plan] = await molebox4.probe(input), result = await molebox4.convert(input, plan);
  const payloads = result.files.filter(file => /\/[a-f0-9]{32}\.(?:bin|exe)$/u.test(file.logicalKey));
  expect(payloads).toHaveLength(2);
  for (const file of payloads) expect(await readFile(join(input.outputRoot, file.logicalKey))).toEqual(bytes);
});
it("rejects a stage expansion before allocating its declared oversized result", async () => {
  await expect(molebox4.probe(await request(fixture({expandedStage: 128 * 1024 * 1024}).bytes))).rejects.toThrow("RUNTIME_MOLEBOX_LIMIT");
});
it("validates every output block instead of accepting correct directory CRCs alone", async () => {
  const built = fixture(); built.bytes[built.corruptBlockAt + 2] ^= 3;
  const input = await request(built.bytes), [plan] = await molebox4.probe(input);
  await expect(molebox4.convert(input, plan)).rejects.toThrow("RUNTIME_MOLEBOX_INVALID");
});
it("uses container metadata to explicitly declare the same-path native module override", async () => {
  const input = await request(fixture().bytes), key = "nested/resources/boot.ks";
  input.files.push({logicalKey: key, name: "boot.ks", sizeBytes: 3, sha256: "b".repeat(64)});
  const [plan] = await molebox4.probe(input);
  expect(plan.claims).toEqual(["nested/launch.exe"]); expect(plan.overrides).toEqual([key]);
});
it("honors cancellation before reading or emitting a container", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(molebox4.probe({...await request(fixture().bytes), signal: controller.signal})).rejects.toThrow();
});
it("associates each embedded mount with its ordinal seed and gives later packages native precedence", async () => {
  const input = await request(fixture({multiplePackages: true}).bytes), [plan] = await molebox4.probe(input);
  const result = await molebox4.convert(input, plan);
  expect(await readFile(join(input.outputRoot, "nested/resources/boot.ks"), "utf8")).toBe("later package wins");
  expect(await readFile(join(input.outputRoot, "nested/resources/notes.txt"), "utf8")).toBe("plain text");
  expect(result.files).toHaveLength(4);
});
it("reads an immutable logical PE slice instead of the surrounding host file", async () => {
  const built = fixture(), input = await request(built.bytes), locator = input.locators[input.files[0].logicalKey];
  await writeFile(locator.path, Buffer.concat([Buffer.alloc(79, 1), built.bytes, Buffer.alloc(333, 2)])); locator.offset = 79;
  const [plan] = await molebox4.probe(input); await molebox4.convert(input, plan);
  expect(await readFile(join(input.outputRoot, "nested/launch.exe"))).toEqual(built.bytes);
});
it("fails if the source changes after planning instead of decoding stale packet offsets", async () => {
  const input = await request(fixture().bytes), [plan] = await molebox4.probe(input), locator = input.locators[input.files[0].logicalKey];
  const bytes = await readFile(locator.path); bytes[bytes.length - 1] ^= 1; await writeFile(locator.path, bytes);
  await expect(molebox4.convert(input, plan)).rejects.toThrow("RUNTIME_CONTENT_CHANGED");
});

