import {describe, expect, it, vi} from "vitest";
import {kirikiriPe} from "../../tests/kirikiri-version-pe-fixture.js";
import {resolveKirikiriEngineMode} from "./engine-mode.js";

function file(path: string, bytes = kirikiriPe()) {
  return {path, reader: {sizeBytes: bytes.length, readInto: vi.fn(async (offset: number, target: Uint8Array) => {
    const part = bytes.subarray(offset, offset + target.length); target.set(part); return part.length;
  })}};
}
describe("KiriKiri engine mode selection", () => {
  it.each([false, true])("recognizes a renamed Z executable from its typed version resource (PE64=%s)", async pe64 => {
    expect(await resolveKirikiriEngineMode("AUTO", [file("任意名字.EXE", kirikiriPe(undefined, pe64))])).toBe("KIRIKIRI_Z");
  });
  it("keeps explicit choices without reading executables", async () => {
    const source = file("game.exe");
    for (const mode of ["KIRIKIRI2", "KIRIKIRI_Z"] as const) {
      expect(await resolveKirikiriEngineMode(mode, [source])).toBe(mode);
    }
    expect(source.reader.readInto).not.toHaveBeenCalled();
  });
  it("uses the original mode for missing or unrelated metadata and ignores executables outside the selected root", async () => {
    const nested = file("other/game.exe");
    for (const sources of [[], [nested], [file("tool.exe", kirikiriPe("Other application"))], [file("KIRIKIRI_Z.exe", new Uint8Array(1024))]]) {
      expect(await resolveKirikiriEngineMode("AUTO", sources)).toBe("KIRIKIRI2");
    }
    expect(nested.reader.readInto).not.toHaveBeenCalled();
  });
  it("requires all recognized engine metadata to agree, independently of file order", async () => {
    const z = file("a.exe"), old = file("b.exe", kirikiriPe("TVP(KIRIKIRI) 2 core / Scripting Platform for Win32"));
    expect(await resolveKirikiriEngineMode("AUTO", [z, old])).toBe("KIRIKIRI2");
    expect(await resolveKirikiriEngineMode("AUTO", [old, z])).toBe("KIRIKIRI2");
    expect(await resolveKirikiriEngineMode("AUTO", [z, file("copy.exe")])).toBe("KIRIKIRI_Z");
  });
  it.each(["pe", "resource-range", "cycle", "version-length", "version-type"])("falls back on malformed %s without trusting embedded strings", async corruption => {
    const bytes = kirikiriPe(), view = new DataView(bytes.buffer);
    if (corruption === "pe") {view.setUint32(0x80, 0, true);}
    if (corruption === "resource-range") {view.setUint32(0x264, 0xffffffff, true);}
    if (corruption === "cycle") {view.setUint32(0x214, 0x80000000, true);}
    if (corruption === "version-length") {view.setUint16(0x300, 0xffff, true);}
    if (corruption === "version-type") {view.setUint16(0x304, 1, true);}
    expect(await resolveKirikiriEngineMode("AUTO", [file("game.exe", bytes)])).toBe("KIRIKIRI2");
  });
  it("falls back if an executable cannot be inspected, including partial reads", async () => {
    const unavailable = file("failed.exe"); unavailable.reader.readInto.mockRejectedValue(new Error("offline"));
    expect(await resolveKirikiriEngineMode("AUTO", [file("game.exe"), unavailable])).toBe("KIRIKIRI2");
    const partial = file("partial.exe"); partial.reader.readInto.mockResolvedValue(1);
    expect(await resolveKirikiriEngineMode("AUTO", [partial])).toBe("KIRIKIRI2");
  });
  it("bounds executable count and resource bytes before issuing large reads", async () => {
    const files = Array.from({length: 17}, (_, i) => file(`${i}.exe`));
    expect(await resolveKirikiriEngineMode("AUTO", files)).toBe("KIRIKIRI2");
    expect(files.every(item => item.reader.readInto.mock.calls.length === 0)).toBe(true);
    const bytes = kirikiriPe(); new DataView(bytes.buffer).setUint32(0x98 + 96 + 20, 32 * 1024 * 1024, true);
    const large = file("game.exe", bytes);
    expect(await resolveKirikiriEngineMode("AUTO", [large])).toBe("KIRIKIRI2");
    expect(large.reader.readInto.mock.calls.every(([, target]) => target.length <= 4096)).toBe(true);
  });
  it("propagates cancellation instead of starting another mode", async () => {
    const abort = new AbortController(), source = file("game.exe");
    source.reader.readInto.mockImplementation(async () => {abort.abort(); throw abort.signal.reason;});
    await expect(resolveKirikiriEngineMode("AUTO", [source], abort.signal)).rejects.toMatchObject({name: "AbortError"});
  });
});
