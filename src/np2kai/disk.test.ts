import {expect, it} from "vitest";
import {configuration, diskName} from "./disk.js";
it("disables the native joystick path so host buttons have only one target", () => {
  for (const name of ["game.hdi", "game.d88"]) {
    expect(new TextDecoder().decode(configuration(name))).toContain("\nJoystick=false\n");
  }
});
it("recognizes HDI geometry and a complete single D88 disk without trusting extensions", () => {
  const hdi = new Uint8Array(544), header = new DataView(hdi.buffer);
  [32, 512, 256, 2, 1, 1].forEach((value, index) => header.setUint32(8 + index * 4, value, true));
  expect(diskName(hdi)).toBe("game.hdi");
  expect(new TextDecoder().decode(configuration("game.hdi"))).toContain("HDD1FILE=/emulator/np2kai/game.hdi");
  const d88 = new Uint8Array(688); new DataView(d88.buffer).setUint32(28, d88.length, true);
  expect(diskName(d88)).toBe("game.d88");
  expect(new TextDecoder().decode(configuration("game.d88"))).not.toContain("HDD1FILE");
  for (const bad of [hdi.subarray(0, 543), d88.subarray(0, 687), new Uint8Array(688)]) {
    expect(() => diskName(bad)).toThrow("NP2KAI_DISK_FORMAT_UNSUPPORTED");
  }
  header.setUint32(28, 2, true);
  expect(() => diskName(hdi)).toThrow("NP2KAI_DISK_FORMAT_UNSUPPORTED");
});
