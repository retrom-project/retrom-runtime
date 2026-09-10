import {describe, expect, it, vi} from "vitest";
import {installEmulatorJsRetroArchConfig} from "./retroarch-config.js";

const path = "/data/saves/SAME_CDI/same_cdi/cfg/cdimono1.cfg";
const originalConfig = `<?xml version="1.0"?><mameconfig version="10"><system name="cdimono1">
  <video><target index="0" view="Main Screen Standard (4:3)"/></video><input>
  <port tag=":slave_hle:MOUSEBTN" type="P1_BUTTON1" mask="1" defvalue="0"><newseq type="standard">JOYCODE_1_BUTTON4</newseq></port>
  <port tag=":slave_hle:MOUSEX" type="P1_MOUSE_X" mask="65535" defvalue="0"><newseq type="increment">JOYCODE_1_HAT1RIGHT</newseq><newseq type="decrement">JOYCODE_1_HAT1LEFT</newseq></port>
  <port tag=":slave_hle:MOUSEY" type="P1_MOUSE_Y" mask="65535" defvalue="0"><newseq type="increment">JOYCODE_1_HAT1DOWN</newseq><newseq type="decrement">JOYCODE_1_HAT1UP</newseq></port>
</input></system></mameconfig>`;

function fixture(config: string | null = originalConfig) {
  const readFile = vi.fn(() => {if (config === null) {throw new Error("missing file");} return config;});
  const writeFile = vi.fn((_name: string, content: string) => {config = content;});
  const callMain = vi.fn((_args: string[]) => config ?? "");
  class Manager {
    FS = {readFile, analyzePath: () => ({exists: config !== null})}; Module = {callMain}; writeFile = writeFile;
    getRetroArchCfg() {return 'savefile_directory = "/data/saves"';}
  }
  return {Manager, readFile, writeFile, callMain};
}

describe("SAME CD-i directional input configuration", () => {
  it("creates native defaults in a fresh browser without existing MAME configuration", () => {
    const {Manager, readFile, writeFile} = fixture(null);
    const cleanup = installEmulatorJsRetroArchConfig(window, "same_cdi", false);
    Reflect.set(window, "EJS_GameManager", Manager);
    try {
      const manager = new Manager(); manager.getRetroArchCfg();
      const xml = new DOMParser().parseFromString(manager.Module.callMain([]), "text/xml");
      expect(readFile).not.toHaveBeenCalled(); expect(writeFile).toHaveBeenCalledTimes(1);
      expect([...xml.querySelectorAll('port[keydelta="20"]')].map(node => node.getAttribute("type")))
        .toEqual(["P1_MOUSE_X", "P1_MOUSE_Y"]);
      expect(xml.querySelector('port[type="P1_BUTTON1"] > newseq')?.textContent?.trim()).toBe("JOYCODE_1_BUTTON4");
      expect(xml.querySelectorAll('port[type="P1_BUTTON1"] > newseq')).toHaveLength(1);
    } finally {cleanup(); Reflect.deleteProperty(window, "EJS_GameManager");}
  });

  it.each([false, true])("configures both directions without changing native mappings (restoring=%s)", (restoring) => {
    const {Manager, readFile, writeFile, callMain} = fixture();
    const cleanup = installEmulatorJsRetroArchConfig(window, "same_cdi", restoring);
    Reflect.set(window, "EJS_GameManager", Manager);
    try {
      const manager = new Manager(); manager.getRetroArchCfg(); manager.getRetroArchCfg();
      expect(readFile).not.toHaveBeenCalled(); // Saves and core defaults are not mounted yet.
      const result = manager.Module.callMain([]);
      const xml = new DOMParser().parseFromString(result, "text/xml");
      expect(readFile).toHaveBeenCalledWith(path, {encoding: "utf8"});
      expect(writeFile).toHaveBeenCalledTimes(1);
      expect(callMain).toHaveBeenCalledTimes(1);
      for (const axis of ["X", "Y"]) {
        const delta = Number(xml.querySelector(`port[type="P1_MOUSE_${axis}"]`)?.getAttribute("keydelta"));
        expect(delta).toBe(20);
        // Software that discards low pointer bits must recognize both signs.
        // With the original increment 2, the positive direction becomes zero.
        expect(delta >> 3).toBeGreaterThan(0); expect(-delta >> 3).toBeLessThan(0);
      }
      const previous = new DOMParser().parseFromString(originalConfig, "text/xml");
      expect([...xml.querySelectorAll("newseq")].map((node) => node.outerHTML))
        .toEqual([...previous.querySelectorAll("newseq")].map((node) => node.outerHTML));
      expect(xml.querySelector("video")?.outerHTML).toBe(previous.querySelector("video")?.outerHTML);
      cleanup(); expect(manager.Module.callMain).toBe(callMain);
    } finally {cleanup(); Reflect.deleteProperty(window, "EJS_GameManager");}
  });

  it.each(["broken XML", originalConfig.replace('type="P1_MOUSE_Y"', 'type="P2_MOUSE_Y"')])(
    "rejects a missing native input port rather than starting with ineffective defaults", (config) => {
      const {Manager, callMain} = fixture(config);
      const cleanup = installEmulatorJsRetroArchConfig(window, "same_cdi", false);
      Reflect.set(window, "EJS_GameManager", Manager);
      try {
        const manager = new Manager(); manager.getRetroArchCfg();
        expect(() => manager.Module.callMain([])).toThrow("PLAYER_RUNTIME_CONFIG_UNAVAILABLE");
        expect(callMain).not.toHaveBeenCalled();
      } finally {cleanup(); Reflect.deleteProperty(window, "EJS_GameManager");}
    });

  it("leaves other cores' configuration and startup unchanged", () => {
    const {Manager, readFile, writeFile} = fixture();
    Reflect.set(window, "EJS_GameManager", Manager);
    const cleanup = installEmulatorJsRetroArchConfig(window, "vice_xplus4", true);
    try {
      const manager = new Manager(); manager.getRetroArchCfg(); manager.Module.callMain([]);
      expect(readFile).not.toHaveBeenCalled(); expect(writeFile).not.toHaveBeenCalled();
    } finally {cleanup(); Reflect.deleteProperty(window, "EJS_GameManager");}
  });
});
