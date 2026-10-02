// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {prepareExternalContent} from "./external-content.js";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {targetContentFixture} from "../../../tests/target-content-fixture.js";
import type {EjsWindow} from "./emulator-instance.js";
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const envelope = launchEnvelope();
  const file = {sha256: "a".repeat(64), sizeBytes: 3, url: "https://host.test/bios"};
  envelope.resources.push({role: "external", kind: "EXTERNAL_FILE_SET", ordinal: 0,
    files: [{...file, logicalName: "bios.bin", virtualPath: "/bios.bin"}]},
    {role: "discs", kind: "MULTI_DISC", ordinal: 0, initialDiscIndex: 0, entries: [{...file, index: 0, label: "Disc 1"}]});
  const close = vi.fn(async () => {}), release = vi.fn(async () => {});
  const open = vi.fn(async () => ({id: "file", close} as never));
  const materialize = vi.fn(async () => ({kind: "BLOB" as const, blob: new Blob([new Uint8Array(3)]), release, receipt: {} as never}));
  const session = targetContentFixture({open, materialize, closeFile: close}, "yabause");
  const runtimeWindow = {} as EjsWindow, controller = new AbortController();
  vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:bios").mockReturnValueOnce("blob:disc");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return {envelope, runtimeWindow, controller, session, close, release, open, materialize, revoke};
}
it("hands verified BIOS and disc blobs to upstream loaders and retains leases until exit", async () => {
  const f = fixture();
  const cleanup = await prepareExternalContent(f.runtimeWindow, f.envelope, f.session, f.controller.signal);
  expect(f.open.mock.calls).toEqual(expect.arrayContaining([expect.arrayContaining([expect.objectContaining({mode: "EAGER", result: "BLOB"})])]));
  expect(f.open.mock.calls.map(args => (args as unknown as [{purpose: string}])[0].purpose)).toEqual(["FIRMWARE", "GAME"]);
  expect(f.runtimeWindow.EJS_externalFiles).toEqual({"/bios.bin": "blob:bios", "/disc-001.chd": "blob:disc"});
  expect(f.close).toHaveBeenCalledTimes(2);
  expect(f.release).not.toHaveBeenCalled();
  await cleanup(); await cleanup();
  expect(f.close).toHaveBeenCalledTimes(2); expect(f.release).toHaveBeenCalledTimes(2);
  expect(f.revoke).toHaveBeenCalledTimes(2); expect(f.runtimeWindow.EJS_externalFiles).toBeUndefined();
});
it("releases earlier files when a later download fails, without exposing original URLs", async () => {
  const f = fixture();
  f.materialize.mockResolvedValueOnce({kind: "BLOB", blob: new Blob([new Uint8Array(3)]), release: f.release, receipt: {} as never})
    .mockRejectedValueOnce(new Error("CHECKSUM_MISMATCH"));
  await expect(prepareExternalContent(f.runtimeWindow, f.envelope, f.session, f.controller.signal)).rejects.toThrow("CHECKSUM_MISMATCH");
  expect(f.runtimeWindow.EJS_externalFiles).toBeUndefined(); expect(f.close).toHaveBeenCalledTimes(2);
  expect(f.release).toHaveBeenCalledOnce(); expect(f.revoke).toHaveBeenCalledExactlyOnceWith("blob:bios");
});
