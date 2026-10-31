// @vitest-environment node
import {afterEach, describe, expect, it} from "vitest";
import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {tmpdir} from "node:os";
import {withKirikiriPatchEvidence, hostLaunchOptions} from "../scripts/runtime-kirikiri-patches.mjs";
import {configureHostInput, prepareHostInput} from "../scripts/runtime-host-input.mjs";
import type {HostContentLocator} from "../scripts/runtime-host-content.mjs";
import type {RuntimeConfiguration, RuntimeContentFile} from "../src/runtime/types.js";

const roots: string[] = [];
const project = "collection/game/";
const manifestPath = `${project}.runtime-launches/module.dll.json`;
const overlayRoot = `${project}.runtime-patches/module.dll`;
const config: RuntimeConfiguration = {content: {kind: "KIRIKIRI_PROJECT", entryFile: `${project}data.xp3`},
  cores: {kirikiri2: {options: {overlayRoot: "custom-overlay", steamService: "DISABLED"}}}};
const directory = {platformId: "kirikiri", defaultCoreId: "kirikiri2", allowedCoreIds: ["kirikiri2"]};
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fact = (logicalKey: string, bytes: Uint8Array): RuntimeContentFile =>
  ({logicalKey, name: logicalKey.split("/").at(-1)!, sizeBytes: bytes.length, sha256: sha(bytes)});
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});

async function managed(manifestBytes?: Buffer) {
  const root = await mkdtemp(join(tmpdir(), "retrom-kirikiri-patch-test-")); roots.push(root);
  const content: {key: string; bytes: Buffer}[] = [
    {key: `${project}data.xp3`, bytes: Buffer.from("original XP3 bytes")},
    {key: `${project}module.dll`, bytes: Buffer.from("source module bytes")},
    {key: `${project}localization.bin`, bytes: Buffer.from("source package bytes")},
    {key: `${overlayRoot}/scenario/first.scn`, bytes: Buffer.from("standard normalized resource")},
  ];
  const files = content.map(item => fact(item.key, item.bytes));
  const facts = (items: RuntimeContentFile[]) => items.map(({logicalKey, sizeBytes, sha256}) => ({logicalKey, sizeBytes, sha256}));
  const text = JSON.stringify({kind: "KIRIKIRI_RESOURCE_PATCH", version: 1, sourceFiles: facts(files.slice(1, 3)), overlayRoot,
    resources: facts(files.slice(3))});
  content.push({key: manifestPath, bytes: manifestBytes ?? Buffer.from(text)});
  files.push(fact(manifestPath, content.at(-1)!.bytes));
  const locators: Record<string, HostContentLocator> = {}, chunks: Buffer[] = [Buffer.from("UNRELATED-HEADER")];
  let offset = chunks[0].length;
  const physical = join(root, "managed-package.store");
  for (const item of content) {
    const gap = Buffer.from("UNRELATED-GAP");
    chunks.push(item.bytes, gap); locators[item.key] = {path: physical, offset, sizeBytes: item.bytes.length};
    offset += item.bytes.length + gap.length;
  }
  const bytes = Buffer.concat(chunks); await writeFile(physical, bytes);
  return {root, files, locators, text, physical, bytes, config: structuredClone(config), platformId: "kirikiri", coreIds: ["kirikiri2"]};
}
function request(input: Awaited<ReturnType<typeof managed>>) {return {...input, directory, fingerprints: {"retrom-runtime/kirikiri2-kag": "b".repeat(64)}};}
async function cli(command: string, input: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolveResult, reject) => {
    const child = execFile(process.execPath, [resolve("scripts/runtime-cli.mjs"), command], {cwd: tmpdir(), timeout: 10000}, (_error, stdout) => {
      try {resolveResult(JSON.parse(stdout));} catch (cause) {reject(cause);}
    });
    child.stdin!.end(JSON.stringify(input));
  });
}

describe("managed KiriKiri patch evidence", () => {
  it("reads only the manifest's managed slice and preserves existing evidence and sources", async () => {
    const input = await managed();
    const prefixBase64 = Buffer.from(input.text).subarray(0, 11).toString("base64");
    const evidence = {[`${project}module.dll`]: {text: "existing source evidence"}, [manifestPath]: {prefixBase64}};
    const prepared = await withKirikiriPatchEvidence({...input, evidence});
    expect(prepared.evidence).toEqual({...evidence, [manifestPath]: {prefixBase64, text: input.text}});
    expect(evidence[manifestPath]).toEqual({prefixBase64});
    expect(prepared.files).toBe(input.files);
    expect(await readFile(input.physical)).toEqual(input.bytes);
  });

  it("does not require locators when no recognized manifest exists", async () => {
    const files = [fact("data.xp3", Buffer.from("game")), fact("translation.dll", Buffer.from("module"))];
    const evidence = {"data.xp3": {prefixBase64: "AQ=="}};
    expect(await withKirikiriPatchEvidence({files, evidence})).toEqual({files, evidence});
    expect(await hostLaunchOptions({platformId: "kirikiri", config: {content: {kind: "KIRIKIRI_PROJECT", entryFile: "data.xp3"}}, files}))
      .toEqual({items: [], selectedId: ""});
  });

  it("requires a locator for a recognized manifest even when text evidence was supplied", async () => {
    const input = await managed();
    await expect(withKirikiriPatchEvidence({...input, locators: {}, evidence: {[manifestPath]: {text: input.text}}}))
      .rejects.toThrow("RUNTIME_CONTENT_LOCATOR_REQUIRED");
  });

  it("rejects changed bytes despite a previously supplied correct text", async () => {
    const input = await managed(); input.files.at(-1)!.sha256 = "0".repeat(64);
    await expect(withKirikiriPatchEvidence({...input, evidence: {[manifestPath]: {text: input.text}}})).rejects.toThrow("RUNTIME_CONTENT_CHANGED");
    await expect(hostLaunchOptions(input)).rejects.toThrow("RUNTIME_CONTENT_CHANGED");
  });

  it("rejects conflicting supplied evidence instead of silently replacing it", async () => {
    const input = await managed();
    await expect(withKirikiriPatchEvidence({...input, evidence: {[manifestPath]: {text: input.text + " "}}})).rejects.toThrow("RUNTIME_CONTENT_CHANGED");
  });

  it.each(["size", "offset"])("validates the exact locator %s", async field => {
    const input = await managed(); input.locators[manifestPath][field === "size" ? "sizeBytes" : "offset"]++;
    await expect(withKirikiriPatchEvidence(input)).rejects.toThrow("RUNTIME_CONTENT_CHANGED");
  });

  it.each([Buffer.from([0xff]), Buffer.from([0xc0, 0xaf]), Buffer.from([0xe4, 0xb8])])("rejects malformed UTF-8 evidence %#", async bytes => {
    const input = await managed(bytes);
    await expect(withKirikiriPatchEvidence(input)).rejects.toThrow("RUNTIME_PATCH_MANIFEST_INVALID");
  });

  it("bounds manifest bytes before requiring any locator", async () => {
    const input = await managed(Buffer.alloc(256 * 1024 + 1, 32));
    await expect(withKirikiriPatchEvidence({...input, locators: {}})).rejects.toThrow("RUNTIME_PATCH_MANIFEST_INVALID");
  });

  it("bounds manifest count before opening any files", async () => {
    const input = await managed(), manifest = input.files.at(-1)!;
    input.files.push(...Array.from({length: 62}, (_, index) => ({...manifest, logicalKey: `${project}.runtime-launches/module-${index}.json`})));
    await expect(withKirikiriPatchEvidence({...input, locators: {}})).rejects.toThrow("RUNTIME_PATCH_MANIFEST_INVALID");
  });

  it("honors cancellation before evidence work", async () => {
    const input = await managed(), controller = new AbortController(), reason = new Error("cancel-before-evidence"); controller.abort(reason);
    await expect(withKirikiriPatchEvidence(input, controller.signal)).rejects.toBe(reason);
    await expect(hostLaunchOptions(input, controller.signal)).rejects.toBe(reason);
  });

  it("honors cancellation while a real managed-file read is in flight", async () => {
    const input = await managed(), controller = new AbortController(), reason = new Error("cancel-evidence-read");
    const pending = withKirikiriPatchEvidence(input, controller.signal); controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(await readFile(input.physical)).toEqual(input.bytes);
  });
});

describe("host KiriKiri launch projection and preparation", () => {
  it("projects validated alternatives while retaining explicit custom configuration", async () => {
    const input = await managed(), snapshot = structuredClone(input.config);
    const result = await hostLaunchOptions(input);
    expect(result.selectedId).toBe("custom:custom-overlay");
    expect(result.items.map(item => item.id)).toEqual(["original", overlayRoot, "custom:custom-overlay"]);
    expect(result.items[1].configuration.cores?.kirikiri2.options?.overlayRoot).toBe(".runtime-patches/module.dll");
    expect(result.items[2].configuration).toEqual(snapshot);
    expect(input.config).toEqual(snapshot);
  });

  it("parses configuration before returning an empty projection for other platforms", async () => {
    const input = await managed(Buffer.from([0xff]));
    expect(await hostLaunchOptions({...input, platformId: "nes", config: {content: {kind: "SINGLE_FILE", entryFile: "game.nes"}}, locators: {}}))
      .toEqual({items: [], selectedId: ""});
    await expect(hostLaunchOptions({...input, platformId: "nes", config: {}})).rejects.toThrow("RUNTIME_CONFIGURATION_INVALID");
  });

  it("does not downgrade malformed recognized metadata to an ordinary launch", async () => {
    const input = await managed(Buffer.from("{}"));
    await expect(hostLaunchOptions(input)).rejects.toThrow("RUNTIME_PATCH_MANIFEST_INVALID");
    await expect(prepareHostInput(request(input))).rejects.toThrow("RUNTIME_PATCH_MANIFEST_INVALID");
  });

  it("checks source and generated resource facts during both launch listing and prepare", async () => {
    const input = await managed(); input.files[2].sha256 = "c".repeat(64);
    await expect(hostLaunchOptions(input)).rejects.toThrow("RUNTIME_PATCH_MANIFEST_INVALID");
    await expect(prepareHostInput(request(input))).rejects.toThrow("RUNTIME_PATCH_MANIFEST_INVALID");
  });

  it("provides bounded patch text to configure and validates prepare without changing saved options", async () => {
    const input = await managed();
    const configured = await configureHostInput(input);
    expect(configured.evidence?.[manifestPath]?.text).toBe(input.text);
    const prepared = await prepareHostInput(request(input));
    expect(prepared.config).toEqual(config);
    expect(input.config).toEqual(config);
  });

  it("passes cancellation into host configure and prepare evidence validation", async () => {
    const input = await managed(), controller = new AbortController(), reason = new Error("cancel-host-prepare"); controller.abort(reason);
    await expect(configureHostInput(input, controller.signal)).rejects.toBe(reason);
    await expect(prepareHostInput(request(input), controller.signal)).rejects.toBe(reason);
  });

  it("exposes launch-options through the read-only CLI using real managed locators", async () => {
    const input = await managed();
    const output = await cli("launch-options", input);
    expect(output).toMatchObject({selectedId: "custom:custom-overlay", items: [
      {id: "original"}, {id: overlayRoot}, {id: "custom:custom-overlay", configuration: config},
    ]});
    expect(await readFile(input.physical)).toEqual(input.bytes);
    expect(await cli("prepare", request(input))).toMatchObject({config});
  });
});
