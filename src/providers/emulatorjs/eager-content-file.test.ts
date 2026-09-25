import {describe, expect, it, vi} from "vitest";
import type {ContentSessionClient} from "../../content-io/client.js";
import {mountEagerContentFile} from "./disc-mount.js";
import type {EjsWindow} from "./emulator-instance.js";

const sha256 = "a".repeat(64);

describe("eager EmulatorJS content file", () => {
  it.each([
    "adf", "adz", "dms", "fdi", "ipf", "raw", "hdf", "hdz", "lha", "chd", "nrg", "iso",
  ])("materializes a %s game from its content URL", async extension => {
    const bytes = new Uint8Array(16);
    bytes.set(new TextEncoder().encode("MComprHD"));
    const close = vi.fn(async () => {});
    const open = vi.fn(async () => ({id: "reader", close}));
    const materialize = vi.fn(async () => ({kind: "BYTES", bytes}));
    const session = {open, materialize} as unknown as ContentSessionClient;
    const runtimeWindow = {File} as unknown as EjsWindow;
    const report = vi.fn();
    const file = await mountEagerContentFile(runtimeWindow,
      {url: `/games/opaque-id/Deluxe%20Game%20(AGA).${extension}`, sha256, sizeBytes: bytes.length}, new AbortController().signal,
      () => {}, session, report);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({transport: "WHOLE_ALLOWED", purpose: "GAME"}),
      expect.objectContaining({mode: "EAGER", result: "BYTES"}), expect.any(AbortSignal));
    expect(materialize).toHaveBeenCalledWith("reader", {kind: "BYTES", maxBytes: 2 ** 31 - 1},
      expect.any(AbortSignal), expect.any(Function));
    expect(close).toHaveBeenCalledOnce();
    expect(file.filename).toBe(`Deluxe Game (AGA).${extension}`);
    expect(file.read(0, bytes.length)).toEqual(bytes);
    expect(runtimeWindow.EJS_gameUrl).toBeInstanceOf(File);
    expect((runtimeWindow.EJS_gameUrl as File).name).toBe(file.filename);
  });
});
