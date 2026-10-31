import {describe, expect, it} from "vitest";
import {hashBytes} from "../src/runtime/identity.js";
import {defaultKirikiriPatchOptions, isKirikiriPatchManifest, kirikiriPatchLaunches} from "../src/runtime/kirikiri-patches.js";
import type {ConfigureRequest} from "../src/runtime/configure.js";
import type {RuntimeConfiguration, RuntimeContentFile} from "../src/runtime/types.js";

type Fact = Pick<RuntimeContentFile, "logicalKey" | "sha256" | "sizeBytes">;
type Manifest = {kind: string; version: number; sourceFiles: Fact[]; overlayRoot: string; resources: Fact[]};
type Input = {files: RuntimeContentFile[]; evidence: NonNullable<ConfigureRequest["evidence"]>};
const configuration: RuntimeConfiguration = {content: {kind: "KIRIKIRI_PROJECT", entryFile: "bundle/data.xp3"}};

function file(logicalKey: string, text = "content"): RuntimeContentFile {
  const bytes = new TextEncoder().encode(text);
  return {logicalKey, name: logicalKey.split("/").at(-1)!, sha256: hashBytes(bytes), sizeBytes: bytes.length};
}
function fact({logicalKey, sha256, sizeBytes}: RuntimeContentFile): Fact {return {logicalKey, sha256, sizeBytes};}
function fixture(root = "bundle/", module = "module.dll"): Input {
  const sourceFiles = [file(`${root}${module}`), file(`${root}localization.bin`)];
  const overlayRoot = `${root}.runtime-patches/${module}`;
  const resource = file(`${overlayRoot}/scenario/first.scn`, "normalized translation");
  const manifest: Manifest = {kind: "KIRIKIRI_RESOURCE_PATCH", version: 1, sourceFiles: sourceFiles.map(fact), overlayRoot, resources: [fact(resource)]};
  const manifestFile = file(`${root}.runtime-launches/${module}.json`, JSON.stringify(manifest));
  return {files: [file(`${root}data.xp3`), ...sourceFiles, resource, manifestFile], evidence: {[manifestFile.logicalKey]: {text: JSON.stringify(manifest)}}};
}
function manifestPath(input: Input): string {return Object.keys(input.evidence)[0];}
function replaceText(input: Input, text: string) {
  const path = manifestPath(input);
  input.evidence[path] = {text};
  input.files[input.files.findIndex(item => item.logicalKey === path)] = file(path, text);
}
function changeManifest(input: Input, change: (manifest: Manifest) => void) {
  const manifest = JSON.parse(input.evidence[manifestPath(input)].text!) as Manifest;
  change(manifest); replaceText(input, JSON.stringify(manifest));
}
function combined(...inputs: Input[]): Input {
  const files = [...new Map(inputs.flatMap(input => input.files).map(item => [item.logicalKey, item])).values()];
  return {files, evidence: Object.assign({}, ...inputs.map(input => input.evidence))};
}
function invalid(input: Input) {
  expect(() => kirikiriPatchLaunches({...input, configuration})).toThrowError(expect.objectContaining({code: "RUNTIME_PATCH_MANIFEST_INVALID"}));
  expect(() => defaultKirikiriPatchOptions(input)).toThrowError(expect.objectContaining({code: "RUNTIME_PATCH_MANIFEST_INVALID"}));
}

describe("KiriKiri resource-patch launch configurations", () => {
  it("does not infer a patch from DLL names or a custom overlay without manifests", () => {
    const input = {files: [file("bundle/data.xp3"), file("bundle/translation.dll")], evidence: {}};
    const custom = {...configuration, cores: {kirikiri2: {options: {overlayRoot: "custom"}}}};
    expect(kirikiriPatchLaunches({...input, configuration: custom})).toEqual({items: [], selectedId: ""});
    expect(defaultKirikiriPatchOptions(input)).toBeUndefined();
  });

  it("offers original and normalized resources while preserving complete independent configurations", () => {
    const input = fixture();
    const current: RuntimeConfiguration = {...configuration, cores: {
      kirikiri2: {parentFiles: ["parent.bin"], options: {screenWidth: 1280, engineArguments: ["-debug"]}},
      other: {options: {nested: {value: true}}},
    }};
    const snapshot = structuredClone(current);
    const result = kirikiriPatchLaunches({...input, configuration: current});
    expect(result.selectedId).toBe("original");
    expect(result.items.map(item => [item.id, item.label])).toEqual([
      ["original", "原版资源"], ["bundle/.runtime-patches/module.dll", "资源补丁：module.dll"],
    ]);
    expect(result.items[0].configuration).toEqual(current);
    expect(result.items[1].configuration).toEqual({...current, cores: {...current.cores,
      kirikiri2: {...current.cores!.kirikiri2, options: {...current.cores!.kirikiri2.options, overlayRoot: ".runtime-patches/module.dll"}},
    }});
    result.items[0].configuration.cores!.kirikiri2.parentFiles!.push("new.bin");
    result.items[1].configuration.cores!.other.options!.nested = "changed";
    expect(current).toEqual(snapshot);
    expect(result.items[1].configuration.cores!.kirikiri2.parentFiles).toEqual(["parent.bin"]);
  });

  it("selects the active known overlay and removes empty option containers from original", () => {
    const input = fixture();
    const current = {...configuration, cores: {kirikiri2: {options: {overlayRoot: ".runtime-patches/module.dll"}}}};
    const result = kirikiriPatchLaunches({...input, configuration: current});
    expect(result.selectedId).toBe("bundle/.runtime-patches/module.dll");
    expect(result.items[0].configuration).toEqual(configuration);
    expect(result.items[1].configuration).toEqual(current);
  });

  it("preserves unrelated options when removing the overlay", () => {
    const current = {...configuration, cores: {kirikiri2: {options: {overlayRoot: ".runtime-patches/module.dll", screenWidth: 640}}, other: {romSet: "parent"}}};
    const {items} = kirikiriPatchLaunches({...fixture(), configuration: current});
    expect(items[0].configuration.cores).toEqual({kirikiri2: {options: {screenWidth: 640}}, other: {romSet: "parent"}});
  });

  it("retains an unknown active overlay as an explicit custom configuration", () => {
    const current = {...configuration, cores: {kirikiri2: {options: {overlayRoot: "user-overlay", screenWidth: 640}}}};
    const result = kirikiriPatchLaunches({...fixture(), configuration: current});
    expect(result.selectedId).toBe("custom:user-overlay");
    expect(result.items.at(-1)).toEqual({id: "custom:user-overlay", label: "自定义覆盖目录", configuration: current});
    expect(result.items.at(-1)!.configuration).not.toBe(current);
    expect(current.cores.kirikiri2.options.overlayRoot).toBe("user-overlay");
  });

  it("uses a deterministic order for multiple independent patch manifests", () => {
    const input = combined(fixture("bundle/", "z.dll"), fixture("bundle/", "a.dll"));
    expect(kirikiriPatchLaunches({...input, configuration}).items.map(item => item.id)).toEqual([
      "original", "bundle/.runtime-patches/a.dll", "bundle/.runtime-patches/z.dll",
    ]);
    expect(() => defaultKirikiriPatchOptions(input)).toThrowError(expect.objectContaining({code: "RUNTIME_LAUNCH_REQUIRED"}));
  });

  it("defaults to the sole validated patch in the selected project", () => {
    const input = combined(fixture("bundle/"), fixture("other/"));
    expect(defaultKirikiriPatchOptions({...input, entryFile: "bundle/data.xp3"})).toEqual({overlayRoot: ".runtime-patches/module.dll"});
    expect(defaultKirikiriPatchOptions({...input, entryFile: "missing/data.xp3"})).toBeUndefined();
    expect(kirikiriPatchLaunches({...input, configuration}).items).toHaveLength(2);
    expect(() => defaultKirikiriPatchOptions(input)).toThrowError(expect.objectContaining({code: "RUNTIME_LAUNCH_REQUIRED"}));
  });

  it("supports a project at the content root", () => {
    const input = fixture("");
    expect(defaultKirikiriPatchOptions(input)).toEqual({overlayRoot: ".runtime-patches/module.dll"});
    expect(kirikiriPatchLaunches({...input, configuration: {content: {kind: "KIRIKIRI_PROJECT", entryFile: "data.xp3"}}}).items).toHaveLength(2);
  });

  it("does not offer another project's manifests or mutate entry selection", () => {
    const input = fixture("other/");
    expect(kirikiriPatchLaunches({...input, configuration})).toEqual({items: [], selectedId: ""});
    expect(configuration.content).toEqual({kind: "KIRIKIRI_PROJECT", entryFile: "bundle/data.xp3"});
  });

  it("uses project-relative core options and full logical scheme IDs for nested entries", () => {
    const input = fixture("collection/game/");
    const entryFile = "collection/game/data.xp3";
    const current: RuntimeConfiguration = {content: {kind: "KIRIKIRI_PROJECT", entryFile},
      cores: {kirikiri2: {options: {overlayRoot: ".runtime-patches/module.dll"}}}};
    const result = kirikiriPatchLaunches({...input, configuration: current});
    expect(result.selectedId).toBe("collection/game/.runtime-patches/module.dll");
    expect(result.items[1].configuration).toEqual(current);
    expect(defaultKirikiriPatchOptions({...input, entryFile})).toEqual({overlayRoot: ".runtime-patches/module.dll"});
  });

  it("shares one manifest-path recognition rule with host evidence loading", () => {
    expect(isKirikiriPatchManifest(".runtime-launches/module.dll.json")).toBe(true);
    expect(isKirikiriPatchManifest("collection/game/.runtime-launches/module.dll.json")).toBe(true);
    expect(isKirikiriPatchManifest("collection/game/.runtime-launches/sub/module.dll.json")).toBe(false);
    expect(isKirikiriPatchManifest("collection/game/module.dll.json")).toBe(false);
  });

  it("keeps original, 62 patches and an active custom overlay within the 64 launch-option bound", () => {
    const input = combined(...Array.from({length: 62}, (_, index) => fixture("bundle/", `module-${index}.dll`)));
    const current = {...configuration, cores: {kirikiri2: {options: {overlayRoot: "custom"}}}};
    expect(kirikiriPatchLaunches({...input, configuration: current}).items).toHaveLength(64);
  });
});

describe("KiriKiri patch manifest integrity", () => {
  it("rejects a matched manifest whose text evidence is absent", () => {
    const input = fixture(); delete input.evidence[manifestPath(input)]; invalid(input);
  });

  it.each(["{", "null", "[]", "42", '"text"'])("rejects invalid JSON structure: %s", text => {
    const input = fixture(); replaceText(input, text); invalid(input);
  });

  it.each([
    (value: Manifest) => {value.kind = "OTHER";},
    (value: Manifest) => {value.version = 2;},
    (value: Manifest) => {Object.assign(value, {unsupported: true});},
    (value: Manifest) => {value.sourceFiles = [];},
    (value: Manifest) => {value.resources = [];},
    (value: Manifest) => {value.sourceFiles[0].sizeBytes++;},
    (value: Manifest) => {value.resources[0].sha256 = "a".repeat(64);},
    (value: Manifest) => {value.resources[0].sizeBytes = -1;},
    (value: Manifest) => {value.resources[0].sizeBytes = 1.5;},
    (value: Manifest) => {value.resources[0].sha256 = "invalid";},
    (value: Manifest) => {value.resources.push(value.resources[0]);},
    (value: Manifest) => {value.sourceFiles.push(value.sourceFiles[0]);},
    (value: Manifest) => {Object.assign(value.resources[0], {extra: "field"});},
  ])("rejects invalid schema, stale facts and duplicate claims %#", change => {
    const input = fixture(); changeManifest(input, change); invalid(input);
  });

  it.each(["../escape", "/absolute", "bundle/.runtime-patches/module.dll/", "bundle\\.runtime-patches\\module.dll",
    "bundle/.runtime-patches/../escape", "other/.runtime-patches/module.dll", "bundle/.runtime-patches", "bundle/plain-overlay", "bundle/.runtime-patches/\u0000"])(
    "rejects unsafe or cross-project overlay roots: %s", overlayRoot => {
      const input = fixture(); changeManifest(input, value => {value.overlayRoot = overlayRoot;}); invalid(input);
    });

  it("rejects a resource outside the declared overlay even if its file facts exist", () => {
    const input = fixture(), extra = file("bundle/.runtime-patches/module.dll-other/story.scn");
    input.files.push(extra); changeManifest(input, value => {value.resources = [fact(extra)];}); invalid(input);
  });

  it("rejects a source from another project", () => {
    const input = fixture(), extra = file("other/source.bin");
    input.files.push(extra); changeManifest(input, value => {value.sourceFiles = [fact(extra)];}); invalid(input);
  });

  it("rejects generated resources as original sources", () => {
    const input = fixture(); changeManifest(input, value => {value.sourceFiles = value.resources;}); invalid(input);
  });

  it.each(["source", "resource"])("rejects a missing %s file", kind => {
    const input = fixture(); input.files = input.files.filter(item => !item.logicalKey.endsWith(kind === "source" ? "localization.bin" : "first.scn")); invalid(input);
  });

  it("rejects unlisted files under an activated overlay", () => {
    const input = fixture(); input.files.push(file("bundle/.runtime-patches/module.dll/unlisted.scn")); invalid(input);
  });

  it("rejects duplicate actual file identities", () => {
    const input = fixture(); input.files.push({...input.files[1]}); invalid(input);
  });

  it("rejects two manifests claiming the same overlay root", () => {
    const input = fixture(), source = input.files.at(-1)!;
    const duplicate = {...source, logicalKey: "bundle/.runtime-launches/another.dll.json", name: "another.dll.json"};
    input.files.push(duplicate); input.evidence[duplicate.logicalKey] = input.evidence[source.logicalKey]; invalid(input);
  });

  it("rejects evidence whose bytes no longer match the manifest file", () => {
    const input = fixture(); input.evidence[manifestPath(input)].text += " "; invalid(input);
  });

  it("rejects evidence whose digest differs even when its byte count matches", () => {
    const input = fixture(); input.files.at(-1)!.sha256 = "0".repeat(64); invalid(input);
  });

  it("enforces the manifest UTF-8 byte limit", () => {
    const input = fixture();
    replaceText(input, input.evidence[manifestPath(input)].text! + " ".repeat(256 * 1024)); invalid(input);
  });

  it("enforces the core overlay root length limit", () => {
    invalid(fixture("bundle/", `${"m".repeat(240)}.dll`));
  });

  it("enforces a bounded manifest count before constructing launch alternatives", () => {
    invalid(combined(...Array.from({length: 63}, (_, index) => fixture("bundle/", `module-${index}.dll`))));
  });
});
