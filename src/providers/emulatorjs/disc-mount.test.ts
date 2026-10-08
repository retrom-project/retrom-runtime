import {expect, it, vi} from "vitest";
import type {ContentSessionClient} from "../../content-io/client.js";
import type {EjsWindow} from "./emulator-instance.js";
import {mountSeekableContentRange} from "./disc-mount.js";
import {targetContentFixture} from "../../../tests/target-content-fixture.js";

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
