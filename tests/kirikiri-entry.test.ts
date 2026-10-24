// @vitest-environment node
import {afterEach, expect, it} from "vitest";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {configureHostInput} from "../scripts/runtime-host-input.mjs";
import {configureRuntime} from "../src/runtime/configure.js";
import {prepareRuntime} from "../src/runtime/prepare.js";
import type {RuntimeContentFile} from "../src/runtime/types.js";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
const file = (logicalKey: string): RuntimeContentFile => ({logicalKey, name: logicalKey, sizeBytes: 128, sha256: "a".repeat(64)});
const request = {platformId: "kirikiri", coreIds: ["kirikiri2"]};

it("identifies an XP3 archive under a different suffix from bounded package-member evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "runtime-xp3-")); roots.push(root);
  const prefix = Buffer.from("5850330d0a200a1a8b6701", "hex"), content = Buffer.concat([prefix, Buffer.alloc(2000)]);
  const physical = join(root, "package"); await writeFile(physical, Buffer.concat([Buffer.from("before"), content, Buffer.from("after")]));
  const main = {...file("game/data.bin"), sizeBytes: content.length, sha256: createHash("sha256").update(content).digest("hex")};
  const files = [main, file("game/patch.xp3"), file("game/graphics.xp3")];
  const input = await configureHostInput({...request, files, locators: {
    [main.logicalKey]: {path: physical, offset: 6, sizeBytes: main.sizeBytes},
  }});
  const config = configureRuntime(input);
  expect(config.content).toEqual({kind: "KIRIKIRI_PROJECT", entryFile: "game/data.bin"});
  const prepared = prepareRuntime({config, files, fingerprints: {"retrom-runtime/kirikiri2-kag": "b".repeat(64)},
    directory: {platformId: "kirikiri", defaultCoreId: "kirikiri2", allowedCoreIds: ["kirikiri2"]}});
  expect(prepared.targetOptions.startupXp3Path).toBe("data.bin");
  expect(prepared.resources[0].entryFile).toBe("data.bin");
});

it("selects a canonical project root containing a nested backup of the same canonical entry", () => {
  expect(configureRuntime({...request, files: [file("game/data.xp3"), file("game/Backup/data.xp3")]}).content)
    .toEqual({kind: "KIRIKIRI_PROJECT", entryFile: "game/data.xp3"});
});

it("keeps a containing archive project ahead of a nested startup script", () => {
  const input = {...request, files: [file("game/data.xp3"), file("game/Backup/startup.tjs")]};
  expect(configureRuntime(input).content)
    .toEqual({kind: "KIRIKIRI_PROJECT", entryFile: "game/data.xp3"});
  expect(configureRuntime({...input, selection: {entryFile: "game/Backup/startup.tjs"}}).content)
    .toEqual({kind: "KIRIKIRI_PROJECT", entryFile: "game/Backup/startup.tjs"});
});

it.each([
  ["one/startup.tjs", "two/data.xp3"],
  ["one/data.xp3", "two/startup.tjs"],
  ["game/data.xp3", "game-backup/startup.tjs"],
])("requires a decision between different project roots %s and %s", (first, second) => {
  for (const paths of [[first, second], [second, first]]) {
    const input = {...request, files: paths.map(file)};
    expect(() => configureRuntime(input)).toThrow("RUNTIME_ENTRY_REQUIRED");
    for (const entryFile of paths) {
      expect(configureRuntime({...input, selection: {entryFile}}).content)
        .toEqual({kind: "KIRIKIRI_PROJECT", entryFile});
    }
  }
});

it.each([
  {entryFile: "game/startup.tjs", paths: ["game/data.xp3", "game/startup.tjs", "game/Backup/startup.tjs"]},
  {entryFile: "game/data.xp3", paths: ["game/patch.xp3", "game/data.xp3", "game/Backup/startup.tjs"]},
])("preserves same-project entry priority for $entryFile", ({entryFile, paths}) => {
  expect(configureRuntime({...request, files: paths.map(file)}).content)
    .toEqual({kind: "KIRIKIRI_PROJECT", entryFile});
});

it("keeps a signature-backed containing project ahead of nested standard archives", () => {
  const files = [file("game/data.bin"), file("game/Backup/data.xp3"), file("game/Backup/startup.tjs")];
  const evidence = {"game/data.bin": {prefixBase64: Buffer.from("5850330d0a200a1a8b6701", "hex").toString("base64")}};
  expect(configureRuntime({...request, files, evidence}).content)
    .toEqual({kind: "KIRIKIRI_PROJECT", entryFile: "game/data.bin"});
});

it("preserves ambiguity within one project and rejects projects without an entry", () => {
  expect(() => configureRuntime({...request, files: [file("game/voice.xp3"), file("game/patch.xp3")]}))
    .toThrow("RUNTIME_ENTRY_REQUIRED");
  expect(() => configureRuntime({...request, files: [file("game/readme.txt")]}))
    .toThrow("RUNTIME_ENTRY_MISSING");
});

it("retains ambiguity between peer projects and validates an explicit entry against engine candidates", () => {
  const input = {...request, files: [file("one/data.xp3"), file("two/data.xp3"), file("readme.txt")]};
  expect(() => configureRuntime(input)).toThrow("RUNTIME_ENTRY_REQUIRED");
  expect(configureRuntime({...input, selection: {entryFile: "two/data.xp3"}}).content)
    .toEqual({kind: "KIRIKIRI_PROJECT", entryFile: "two/data.xp3"});
  expect(() => configureRuntime({...input, selection: {entryFile: "readme.txt"}})).toThrow("RUNTIME_ENTRY_MISSING");
});
