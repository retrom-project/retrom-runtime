import "../../../tests/emulatorjs-content-fixture.js";
// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {prepareParentContent} from "./parent-content.js";
import {installParentArchiveDownload, preserveParentArchive} from "./parent-archive.js";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {targetContentFixture} from "../../../tests/target-content-fixture.js";
import {ProviderContentOwner} from "../../provider/content-owner.js";
import type {EjsInstance, EjsWindow} from "./emulator-instance.js";

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

function fixture() {
  const envelope = launchEnvelope();
  envelope.resources.push({kind: "PARENT_ARCHIVE", role: "parent", ordinal: 0, rangeRequired: true,
    sha256: "c".repeat(64), sizeBytes: 3, url: "https://host.test/content/parent/bundle.zip"});
  const blob = new Blob([new Uint8Array([1, 2, 3])]);
  const close = vi.fn(async () => {}), release = vi.fn(async () => {});
  const unused = () => {throw new Error("unexpected reader access");};
  const open = vi.fn(async () => ({abi: "content-io-v1" as const, id: "parent", close, sizeBytes: 3,
    readInto: unused, tryReadInto: unused, stream: unused}));
  const receipt = {objectKey: "d".repeat(64), storageGeneration: "generation", sizeBytes: 3,
    localSha256: "c".repeat(64), assurance: "EXPECTED_SHA256" as const, pinnedEtag: null};
  const materialize = vi.fn(async () => ({kind: "BLOB" as const, blob, release, receipt}));
  const session = targetContentFixture({open, materialize, closeFile: close}, "fbneo");
  const runtimeWindow = {} as EjsWindow;
  const controller = new AbortController();
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:parent");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return {envelope, close, release, open, materialize, session, runtimeWindow, controller, create, revoke};
}

it("routes optional parent archives through persistent Content I/O in both EmulatorJS releases", () => {
  for (const id of ["fbneo", "mame2003", "supermodel"]) {
    const target = emulatorJsProviderDefinition.targets.find(entry => entry.id === id)!;
    expect(target.contentIO.parent).toMatchObject({mode: "EAGER", result: "BLOB"});
  }
});

it("delivers a verified local parent URL and retains its lease until idempotent cleanup", async () => {
  const f = fixture();
  const cleanup = await prepareParentContent(f.runtimeWindow, f.envelope, f.session, f.controller.signal, () => {}, "4.2.3");
  expect(f.open).toHaveBeenCalledWith(expect.objectContaining({identity: {kind: "FILE_SHA256", sha256: "c".repeat(64)}, sizeBytes: 3}),
    expect.objectContaining({mode: "EAGER", result: "BLOB"}), f.controller.signal);
  expect(f.runtimeWindow.EJS_gameParentUrl).toBe("blob:parent");
  expect(f.release).not.toHaveBeenCalled();
  await cleanup(); await cleanup();
  expect(f.runtimeWindow.EJS_gameParentUrl).toBeUndefined();
  expect(f.close).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce();
  expect(f.revoke).toHaveBeenCalledExactlyOnceWith("blob:parent");
});
it("preserves a 4.3 parent archive's actual filename through the explicit File extraction path", async () => {
  const f = fixture();
  Object.assign(f.runtimeWindow, {File});
  vi.stubGlobal("location", new URL("https://host.test/"));
  const cleanup = await prepareParentContent(f.runtimeWindow, f.envelope, f.session, f.controller.signal, () => {}, "4.3.0-pre");
  expect(f.runtimeWindow.EJS_gameParentUrl).toBeInstanceOf(File);
  const parent = f.runtimeWindow.EJS_gameParentUrl as File;
  expect(parent.name).toBe("bundle.zip");
  expect(new Uint8Array(await parent.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3));
  expect(f.create).not.toHaveBeenCalled();
  await cleanup();
  expect(f.release).toHaveBeenCalledOnce();
  expect(f.revoke).not.toHaveBeenCalled();
});

it("keeps the named 4.3 Parent ZIP intact for the core's archive lookup", () => {
  const previous = ["another-core"], parent = {dontExtractIfCore: previous};
  const instance = {downloadType: {parent}} as EjsInstance;
  const cleanup = preserveParentArchive(instance, "fbneo");
  // The pinned upstream File download dispatch reads this exact policy before decompression.
  expect(parent.dontExtractIfCore).toContain("fbneo");
  expect(parent.dontExtractIfCore).toContain("another-core");
  expect(previous).toEqual(["another-core"]);
  cleanup(); cleanup();
  expect(parent.dontExtractIfCore).toBe(previous);
});

it("rejects a missing Parent archive dispatch instead of silently extracting ROM members", () => {
  expect(() => preserveParentArchive({downloadType: {}} as EjsInstance, "fbneo"))
    .toThrow("PLAYER_PARENT_ARCHIVE_UNAVAILABLE");
});

it("mounts a 4.2 Parent ZIP under its frozen basename without invoking upstream extraction", async () => {
  const f = fixture(), downloadGameParent = vi.fn(async () => {}), writeFile = vi.fn();
  const instance = {downloadGameParent, config: {gameParentUrl: "blob:parent"}, gameManager: {FS: {writeFile}}};
  Object.assign(f.runtimeWindow, {EJS_emulator: instance, EJS_core: "fbneo"});
  vi.stubGlobal("location", new URL("https://host.test/"));
  const cleanup = installParentArchiveDownload(instance, f.envelope, f.session, f.controller.signal);
  await instance.downloadGameParent();
  expect(downloadGameParent).not.toHaveBeenCalled();
  expect(writeFile).toHaveBeenCalledExactlyOnceWith("/bundle.zip", Uint8Array.of(1, 2, 3));
  expect(instance.config.gameParentUrl).toBe("bundle.zip");
  cleanup();
  expect(instance.downloadGameParent).toBe(downloadGameParent);
  expect(f.release).toHaveBeenCalledOnce(); expect(f.close).toHaveBeenCalledOnce();
});

it.each(["length", "cancel", "download"])("cleans up a %s failure without handing the network URL to EmulatorJS", async failure => {
  const f = fixture();
  if (failure === "length") {f.envelope.resources[1] = {...f.envelope.resources[1], sizeBytes: 4} as typeof f.envelope.resources[number];}
  if (failure === "cancel") {f.controller.abort();}
  if (failure === "download") {f.materialize.mockRejectedValueOnce(new Error("CHECKSUM_MISMATCH"));}
  await expect(prepareParentContent(f.runtimeWindow, f.envelope, f.session, f.controller.signal, () => {}, "4.2.3")).rejects.toThrow();
  expect(f.create).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledOnce();
  expect(f.runtimeWindow.EJS_gameParentUrl).toBeUndefined();
  if (failure !== "download") {expect(f.release).toHaveBeenCalledOnce();}
});

it("bootstraps game content without creating absent parent work", async () => {
  const f = fixture(), envelope = launchEnvelope();
  vi.stubGlobal("location", new URL("https://host.test/"));
  const owner = new ProviderContentOwner(vi.fn());
  const target = emulatorJsProviderDefinition.targets.find(entry => entry.id === "fbneo")!;
  expect(await owner.start(target, envelope, {})).not.toBeNull();
  await (await prepareParentContent(f.runtimeWindow, envelope, null, f.controller.signal, () => {}, "4.2.3"))();
  expect(f.open).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled();
  await owner.close();
});

it("revokes a prepared parent if exit races with the mount handoff", async () => {
  const f = fixture();
  const cleanup = await prepareParentContent(f.runtimeWindow, f.envelope, f.session, f.controller.signal, () => {}, "4.2.3");
  f.controller.abort();
  await vi.waitFor(() => expect(f.close).toHaveBeenCalledOnce());
  await cleanup();
  expect(f.release).toHaveBeenCalledOnce();
  expect(f.revoke).toHaveBeenCalledExactlyOnceWith("blob:parent");
  expect(f.runtimeWindow.EJS_gameParentUrl).toBeUndefined();
});
