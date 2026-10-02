import {afterEach, expect, it, vi} from "vitest";
import {prepareEagerBIOS, prepareEagerROM} from "./eager-resources.js";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {targetContentFixture} from "../../../tests/target-content-fixture.js";
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
  const create = vi.fn(() => "blob:verified-bios"), revoke = vi.fn();
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

it("BIOS uses archive bytes metadata and releases its local URL on exit", async () => {
  const f = fixture(), envelope = launchEnvelope();
  envelope.resources.push({kind: "BIOS_BUNDLE", role: "bios", ordinal: 0,
    files: [{...f.file, logicalName: "bundle.zip", virtualPath: "bundle.zip"}]});
  const cleanup = await prepareEagerBIOS(f.window, envelope, f.session, f.controller.signal, vi.fn());
  expect(f.open).toHaveBeenCalledWith(expect.objectContaining({purpose: "FIRMWARE", sizeBytes: 3}),
    expect.objectContaining({mode: "EAGER"}), f.controller.signal);
  expect(f.window.EJS_biosUrl).toBe("blob:verified-bios");
  cleanup();
  expect(f.window.EJS_biosUrl).toBeUndefined();
  expect(f.revoke).toHaveBeenCalledWith("blob:verified-bios");
  expect(f.close).toHaveBeenCalledOnce();
});
