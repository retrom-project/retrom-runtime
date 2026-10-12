import {expect, it, vi} from "vitest";
import type {ContentSessionClient} from "../../content-io/client.js";
import type {EjsWindow} from "./emulator-instance.js";
import {emulatorJsDisableCue, flycastDiscBootOptions, flycastContentName, mountSeekableContentRange} from "./disc-mount.js";
import {targetContentFixture} from "../../../tests/target-content-fixture.js";

it("keeps Flycast's native disc entry instead of auto-generating a CUE", () => {
  expect(emulatorJsDisableCue("flycast")).toBe(true);
});

it.each(["cdi", "chd"])("preserves Flycast's %s format in its content filename", extension => {
  expect(flycastContentName(`/content/%E6%96%91%E9%B8%A0.${extension}?token=x`, "a".repeat(64), "flycast"))
    .toBe(`${"a".repeat(64)}.${extension}`);
});
it("rejects unsupported single-file Dreamcast formats before presenting a placeholder to the core", () => {
  expect(() => flycastContentName("/content/disc.iso", "a".repeat(64), "flycast")).toThrow("FLYCAST_CONTENT_NAME_INVALID");
});

it("normalizes an arcade filename's case without changing the original archive", () => {
  expect(flycastContentName("/content/WLDRIDER.ZIP", "a".repeat(64), "flycast-naomi2")).toBe("wldrider.zip");
});

it.each(["cue", "iso", "chd"])("keeps the actual single-disc %s entry and original bounded reads", async extension => {
  const bytes = new TextEncoder().encode('FILE "track.iso" BINARY\n');
  const reader = {abi: "content-io-v1", sizeBytes: bytes.length, close: vi.fn(async () => {}),
    tryReadInto: (offset: number, output: Uint8Array) => {output.set(bytes.subarray(offset, offset + output.length)); return output.length;},
    readInto: vi.fn()};
  const session = {open: vi.fn(async () => reader)} as unknown as ContentSessionClient;
  const frame = {File} as unknown as EjsWindow;
  const range = await mountSeekableContentRange(frame, {url: `/content/Demo%20disc.${extension}`,
    sha256: "a".repeat(64), sizeBytes: bytes.length}, new AbortController().signal, vi.fn(),
  targetContentFixture(session, "genesis-plus-gx-cd"));
  try {
    expect(range.filename).toBe(`Demo disc.${extension}`);
    expect((frame.EJS_gameUrl as File).name).toBe(range.filename);
    expect(Array.from(await range.read(0, bytes.length))).toEqual(Array.from(bytes));
  } finally {await range.dispose();}
});

it("uses the native HLE boot path for CDI and retains BIOS boot for CHD and arcade", () => {
  expect(flycastDiscBootOptions("flycast", "/game/Disc.CDI?token=x")).toEqual({reicast_hle_bios: "enabled"});
  expect(flycastDiscBootOptions("flycast", "/game/disc.chd")).toEqual({});
  expect(flycastDiscBootOptions("flycast", "/game/wldrider.zip")).toEqual({});
  expect(flycastDiscBootOptions("other", "/game/disc.cdi")).toEqual({});
});
