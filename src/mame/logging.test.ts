import {afterEach, expect, test, vi} from "vitest";
import {nativeLog} from "./core.js";
afterEach(() => vi.restoreAllMocks());
test("optional configuration and a read-only disk retry remain diagnostic messages", () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
  for (const message of ["Optional memory region ':screen' not found", "Configuration file apple2p.cfg not found",
    ":sl6:diskiing:0:525: error opening image file /content/game.dsk with flags=00000003 (generic:2 Permission denied)"]) {
    nativeLog(message);
  }
  expect(warning).not.toHaveBeenCalled(); expect(debug).toHaveBeenCalledTimes(3);
});
test("missing required ROMs and real image failures remain visible", () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  nativeLog("341-0028-a.rom NOT FOUND"); nativeLog("Error: required files are missing");
  nativeLog(":sl6:diskiing:0:525: error opening image file /content/game.dsk with flags=00000001 (generic:2 Permission denied)");
  expect(warning).toHaveBeenCalledTimes(3);
});
