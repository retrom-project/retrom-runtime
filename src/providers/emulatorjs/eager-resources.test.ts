import {afterEach, expect, it, vi} from "vitest";
import {prepareEagerBIOS, prepareEagerROM} from "./eager-resources.js";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {targetContentFixture} from "../../../tests/target-content-fixture.js";
import {unzipSync} from "fflate";
import type {EjsWindow} from "./emulator-instance.js";

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const close = vi.fn(async () => {});
  const unused = () => {throw new Error("unexpected random read");};
  const open = vi.fn(async () => ({abi: "content-io-v1" as const, id: "reader", sizeBytes: 3, close,
    readInto: unused, tryReadInto: unused, stream: unused}));
  const receipt = {objectKey: "b".repeat(64), storageGeneration: "fixture", sizeBytes: 3, localSha256: "a".repeat(64),
    assurance: "EXPECTED_SHA256" as const, pinnedEtag: null};
  const materialize = vi.fn(async () => ({kind: "BYTES" as const, bytes: Uint8Array.of(1, 2, 3), receipt}));
  const session = targetContentFixture({open, materialize, closeFile: close}, "fceumm");
  const create = vi.fn((_blob: Blob) => "blob:verified-bios"), revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL {static createObjectURL = create; static revokeObjectURL = revoke;});
  return {session, open, close, materialize, receipt, create, revoke, window: window as EjsWindow,
    controller: new AbortController(), file: {url: "/runtime/content/game/identity/game%20name.nes", sha256: "a".repeat(64), sizeBytes: 3}};
}

it("hands a verified File with its original extension to the core, using SHA and length", async () => {
  const f = fixture();
  await prepareEagerROM(f.window, f.file, f.session, f.controller.signal, vi.fn());
  expect(f.open).toHaveBeenCalledWith(expect.objectContaining({identity: {kind: "FILE_SHA256", sha256: f.file.sha256}, sizeBytes: 3}),
    expect.objectContaining({mode: "EAGER"}), f.controller.signal);
  expect(f.window.EJS_gameUrl).toBeInstanceOf(File);
  expect((f.window.EJS_gameUrl as File).name).toBe("game name.nes");
  expect(f.close).toHaveBeenCalledOnce();
  delete f.window.EJS_gameUrl;
});

it.each(["length", "cancel", "hash"])("a %s failure never hands partial ROM bytes to the core", async failure => {
  const f = fixture();
  if (failure === "length") {f.file.sizeBytes = 4;}
  if (failure === "cancel") {f.materialize.mockImplementationOnce(async () => {f.controller.abort(); return {kind: "BYTES", bytes: Uint8Array.of(1, 2, 3), receipt: f.receipt};});}
  if (failure === "hash") {f.materialize.mockRejectedValueOnce(new Error("CHECKSUM_MISMATCH"));}
  await expect(prepareEagerROM(f.window, f.file, f.session, f.controller.signal, vi.fn())).rejects.toThrow();
  expect(f.window.EJS_gameUrl).toBeUndefined();
  expect(f.close).toHaveBeenCalledOnce();
});

it.each(["4.2.3", "4.3.0-pre"] as const)("assembles verified named firmware for release %s", async release => {
  const f = fixture(), envelope = launchEnvelope();
  envelope.resources.push({kind: "BIOS_BUNDLE", role: "bios", ordinal: 0,
    files: [{...f.file, logicalName: "exec.bin", virtualPath: "exec.bin"},
      {...f.file, logicalName: "grom.bin", virtualPath: "grom.bin"}]});
  const cleanup = await prepareEagerBIOS(f.window, envelope, f.session, f.controller.signal, vi.fn(), release);
  expect(f.open).toHaveBeenCalledWith(expect.objectContaining({purpose: "FIRMWARE", sizeBytes: 3}),
    expect.objectContaining({mode: "EAGER"}), f.controller.signal);
  const blob = release === "4.3.0-pre" ? f.window.EJS_biosUrl as File : f.create.mock.calls[0][0] as Blob;
  if (release === "4.3.0-pre") {
    expect(blob).toBeInstanceOf(File); expect((blob as File).name).toBe("bundle.zip");
    expect(f.create).not.toHaveBeenCalled();
  } else {expect(f.window.EJS_biosUrl).toBe("blob:verified-bios");}
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = reject; reader.readAsArrayBuffer(blob);
  });
  expect(unzipSync(bytes)).toEqual({"exec.bin": Uint8Array.of(1, 2, 3), "grom.bin": Uint8Array.of(1, 2, 3)});
  cleanup();
  expect(f.window.EJS_biosUrl).toBeUndefined();
  if (release === "4.2.3") {expect(f.revoke).toHaveBeenCalledWith("blob:verified-bios");}
  else {expect(f.revoke).not.toHaveBeenCalled();}
  expect(f.close).toHaveBeenCalledTimes(2);
});

it.each(["length", "cancel", "hash"])("a BIOS %s failure never exposes a partial firmware archive", async failure => {
  const f = fixture(), envelope = launchEnvelope();
  envelope.resources.push({kind: "BIOS_BUNDLE", role: "bios", ordinal: 0,
    files: [{...f.file, logicalName: "lynxboot.img", virtualPath: "lynxboot.img", sizeBytes: failure === "length" ? 4 : 3}]});
  if (failure === "cancel") {f.materialize.mockImplementationOnce(async () => {f.controller.abort(); return {kind: "BYTES", bytes: Uint8Array.of(1, 2, 3), receipt: f.receipt};});}
  if (failure === "hash") {f.materialize.mockRejectedValueOnce(new Error("CHECKSUM_MISMATCH"));}
  await expect(prepareEagerBIOS(f.window, envelope, f.session, f.controller.signal, vi.fn(), "4.2.3")).rejects.toThrow();
  expect(f.window.EJS_biosUrl).toBeUndefined(); expect(f.create).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledOnce();
});
