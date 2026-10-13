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
    files: [{...file, logicalName: "bios.bin", virtualPath: "dc/bios.bin"},
      {...file, logicalName: "boot.bin", virtualPath: "gam4980/boot.bin"}]});
  const close = vi.fn(async () => {}), release = vi.fn(async () => {});
  const open = vi.fn(async () => ({id: "file", close} as never));
  const materialize = vi.fn(async () => ({kind: "BLOB" as const, blob: new Blob([new Uint8Array(3)]), release, receipt: {} as never}));
  const session = targetContentFixture({open, materialize, closeFile: close}, "yabause");
  const runtimeWindow = {} as EjsWindow, controller = new AbortController();
  const write = vi.fn();
  class Manager {writeFile(path: string, bytes: Uint8Array) {write(path, bytes);}
    async loadExternalFiles() {throw new Error("Upstream extraction must not run");}}
  const mount = async () => {Reflect.set(runtimeWindow, "EJS_GameManager", Manager); await new Manager().loadExternalFiles();};
  return {envelope, runtimeWindow, controller, session, close, release, open, materialize, write, mount};
}
it("mounts verified firmware bytes and retains leases until exit", async () => {
  const f = fixture();
  const cleanup = await prepareExternalContent(f.runtimeWindow, f.envelope, f.session, f.controller.signal);
  expect(f.open.mock.calls).toEqual(expect.arrayContaining([expect.arrayContaining([expect.objectContaining({mode: "EAGER", result: "BLOB"})])]));
  expect(f.open.mock.calls.map(args => (args as unknown as [{purpose: string}])[0].purpose)).toEqual(["FIRMWARE", "FIRMWARE"]);
  await f.mount();
  expect(f.write.mock.calls).toEqual([["/dc/bios.bin", new Uint8Array(3)], ["/gam4980/boot.bin", new Uint8Array(3)]]);
  expect(f.close).toHaveBeenCalledTimes(2);
  expect(f.release).not.toHaveBeenCalled();
  await cleanup(); await cleanup();
  expect(f.close).toHaveBeenCalledTimes(2); expect(f.release).toHaveBeenCalledTimes(2);
  expect(Reflect.has(f.runtimeWindow, "EJS_GameManager")).toBe(false);
});
it("releases earlier files when a later download fails, without exposing original URLs", async () => {
  const f = fixture();
  f.materialize.mockResolvedValueOnce({kind: "BLOB", blob: new Blob([new Uint8Array(3)]), release: f.release, receipt: {} as never})
    .mockRejectedValueOnce(new Error("CHECKSUM_MISMATCH"));
  await expect(prepareExternalContent(f.runtimeWindow, f.envelope, f.session, f.controller.signal)).rejects.toThrow("CHECKSUM_MISMATCH");
  expect(f.runtimeWindow.EJS_externalFiles).toBeUndefined(); expect(f.close).toHaveBeenCalledTimes(2);
  expect(f.release).toHaveBeenCalledOnce();
});
it("prepares each Parent ZIP through the shared file path under its canonical archive name", async () => {
  const f = fixture();
  f.envelope.resources = [f.envelope.resources[0], {role: "parent", kind: "EXTERNAL_FILE_SET", ordinal: 0,
    files: ["base", "grand"].map(name => ({logicalName: `stored/${name}.zip`, virtualPath: `${name}.zip`,
      url: `https://host.test/${name}.zip`, sha256: "a".repeat(64), sizeBytes: 3}))}];
  const cleanup = await prepareExternalContent(f.runtimeWindow, f.envelope, f.session, f.controller.signal);
  await f.mount();
  expect(f.write.mock.calls.map(([path]) => path)).toEqual(["/base.zip", "/grand.zip"]);
  expect(f.materialize).toHaveBeenCalledTimes(2);
  await cleanup();
  expect(f.release).toHaveBeenCalledTimes(2);
});

it.each(["length", "cancel"])("cleans up external files after %s failure", async failure => {
  const f = fixture();
  if (failure === "length") {f.materialize.mockResolvedValueOnce({kind: "BLOB", blob: new Blob([new Uint8Array(4)]), release: f.release, receipt: {} as never});}
  else {f.controller.abort();}
  await expect(prepareExternalContent(f.runtimeWindow, f.envelope, f.session, f.controller.signal)).rejects.toThrow();
  expect(f.release).toHaveBeenCalledOnce(); expect(f.close).toHaveBeenCalledOnce();
  expect(Reflect.has(f.runtimeWindow, "EJS_GameManager")).toBe(false);
});
it("releases prepared files when cancelled and rejects duplicate mount paths", async () => {
  const f = fixture();
  const cleanup = await prepareExternalContent(f.runtimeWindow, f.envelope, f.session, f.controller.signal);
  f.controller.abort(); await cleanup();
  expect(f.release).toHaveBeenCalledTimes(2);
  expect(Reflect.has(f.runtimeWindow, "EJS_GameManager")).toBe(false);
  const other = fixture(), resource = other.envelope.resources[1];
  if (resource.kind !== "EXTERNAL_FILE_SET") {throw new Error("fixture");}
  resource.files[1].virtualPath = resource.files[0].virtualPath;
  await expect(prepareExternalContent(other.runtimeWindow, other.envelope, other.session, other.controller.signal))
    .rejects.toThrow("PLAYER_EXTERNAL_FILE_CONFLICT");
  expect(other.release).toHaveBeenCalledOnce();
});
