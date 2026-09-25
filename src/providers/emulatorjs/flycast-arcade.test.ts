import {describe, expect, it, vi} from "vitest";
import {flycastContentName, emulatorJsDisableCue, configureContentDisc} from "./disc-mount.js";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import type {ContentSessionClient} from "../../content-io/client.js";
import type {EjsWindow} from "./emulator-instance.js";

describe("Flycast seekable content", () => {
  it("keeps the machine name and ZIP extension for arcade targets", () => {
    for (const target of ["flycast-naomi", "flycast-naomi2", "flycast-atomiswave"]) {
      expect(flycastContentName("/content/game/pstone2.zip", "a".repeat(64), target)).toBe("pstone2.zip");
    }
  });
  it("keeps the existing Dreamcast CHD identity", () => {
    expect(flycastContentName("/content/game/game.chd", "b".repeat(64), "flycast"))
      .toBe(`${"b".repeat(64)}.chd`);
  });
  it("rejects misleading names and unsupported targets", () => {
    expect(() => flycastContentName("/content/game/game.chd", "a".repeat(64), "flycast-naomi")).toThrow();
    expect(() => flycastContentName("/content/game/../pstone2.zip", "a".repeat(64), "flycast-naomi")).toThrow();
    expect(() => flycastContentName("/content/game/pstone2.zip", "a".repeat(64), "unknown")).toThrow();
  });
  it("keeps Flycast cartridge ZIPs instead of making a synthetic CD cue", () => {
    for (const target of ["flycast-naomi", "flycast-naomi2", "flycast-atomiswave"]) {
      expect(emulatorJsDisableCue("flycast", target)).toBe(true);
    }
    expect(emulatorJsDisableCue("flycast", "flycast")).toBe(false);
    expect(emulatorJsDisableCue("cap32", "cap32")).toBe(true);
    expect(emulatorJsDisableCue("quasi88", "quasi88")).toBe(true);
  });
  it.each([
    {target: "flycast", url: "/content/game.chd", filename: `${"a".repeat(64)}.chd`},
    {target: "flycast-naomi", url: "/content/pstone2.zip", filename: "pstone2.zip"},
  ])("reads bounded ranges in two $target instances without materializing the game", async ({target, url, filename}) => {
    const envelope = launchEnvelope();
    Object.assign(envelope.resources[0], {kind: "SEEKABLE_BLOB", rangeRequired: true,
      url, sizeBytes: 1024 * 1024});
    envelope.runtime.targetId = target;
    const readInto = vi.fn(async (_position: number, output: Uint8Array) => {
      output.fill(42); return output.length;
    });
    const materialize = vi.fn(() => {throw Error("EAGER_ROM_DOWNLOAD");});
    const open = vi.fn(async () => ({abi: "content-io-v1", sizeBytes: 1024 * 1024,
      tryReadInto: () => null, readInto, close: vi.fn(async () => {})}));
    const session = {open, materialize} as unknown as ContentSessionClient;
    for (let instance = 0; instance < 2; instance++) {
      const frame = document.createElement("iframe");
      document.body.append(frame);
      const runtimeWindow = frame.contentWindow as EjsWindow;
      const mounted = await configureContentDisc(runtimeWindow, envelope, "flycast", new AbortController().signal,
        session, vi.fn());
      expect((runtimeWindow.EJS_gameUrl as File).name).toBe(filename);
      expect((runtimeWindow.EJS_gameUrl as File).size).toBeLessThan(64);
      expect(runtimeWindow.RETROM_FLYCAST_RANGE).toBe(mounted.range);
      expect(await mounted.range?.read(128 * 1024, 4096)).toEqual(new Uint8Array(4096).fill(42));
      await mounted.range?.dispose(); mounted.cleanup?.(); frame.remove();
    }
    expect(open).toHaveBeenCalledTimes(2);
    expect(readInto).toHaveBeenCalledTimes(2);
    expect(materialize).not.toHaveBeenCalled();
  });
});
