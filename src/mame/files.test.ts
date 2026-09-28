import {expect, it, vi} from "vitest";
import {mountFiles} from "./files.js";
import {eagerPolicy} from "../provider/content-policies.js";
import {materializeFileBytes} from "../provider/content-inputs.js";
vi.mock("../provider/content-inputs.js", async original => ({...await original<typeof import("../provider/content-inputs.js")>(),
  materializeFileBytes: vi.fn(async (_session, file: {sizeBytes: number}) => new Uint8Array(file.sizeBytes))}));
const source = {url: "/game", sha256: "a".repeat(64), sizeBytes: 143360};
const names = ["341-0011.d0", "341-0012.d8", "341-0013.e0", "341-0014.e8", "341-0015.f0", "341-0020-00.f8", "341-0036.chr", "341-0027-a.p5", "341-0028-a.rom"];
const config = {machine: "apple2p" as const, game: source, runtimeBaseUrl: "/provider/", bios: names.map(logicalName => ({...source, logicalName, sizeBytes: logicalName.endsWith(".p5") || logicalName.endsWith(".rom") ? 256 : 2048}))};
const content = {assetIndex: {}, contentSession: {inputPolicy: () => eagerPolicy(143360),
  open: async () => {throw new Error("unused");}, materialize: async () => {throw new Error("unused");}, closeFile: async () => {}}};
function fixture() {return {FS: {mkdirTree: vi.fn(), writeFile: vi.fn(), chmod: vi.fn(), ignorePermissions: true}};}
it("mounts the machine, Disk II card and nested controller BIOS and opens a read-only game", async () => {
  const core = fixture(); await mountFiles(core, config, content);
  expect(core.FS.writeFile).toHaveBeenCalledWith("/content/d2fdc/341-0028-a.rom", expect.any(Uint8Array));
  expect(core.FS.writeFile).toHaveBeenCalledWith("/content/a2diskiing/341-0027-a.p5", expect.any(Uint8Array));
  expect(core.FS.chmod).toHaveBeenCalledWith("/content/game.dsk", 0o444); expect(core.FS.ignorePermissions).toBe(false);
});
it("mounts a PV-1000 cartridge without requiring firmware and rejects invalid capacities", async () => {
  for (const sizeBytes of [8192, 16384, 32768]) {
    const core = fixture();
    await mountFiles(core, {...config, machine: "pv1000", bios: [], game: {...source, sizeBytes}}, content);
    expect(core.FS.writeFile).toHaveBeenCalledWith("/content/game.rom", expect.any(Uint8Array));
    expect(core.FS.writeFile).toHaveBeenCalledWith("/content/boot.cmd", new TextEncoder().encode("pv1000 -cart /content/game.rom -rompath /content -skip_gameinfo -nothrottle"));
  }
  await expect(mountFiles(fixture(), {...config, machine: "pv1000", bios: [], game: {...source, sizeBytes: 8193}}, content)).rejects.toThrow("MAME_CONTENT_INVALID");
});
it("rejects missing, duplicated and unexpected firmware before mounting anything", async () => {
  for (const bios of [config.bios.slice(0, -1), [...config.bios, config.bios[0]], [...config.bios.slice(0, -1), {...config.bios[0], logicalName: "../escape"}]]) {
    const core = fixture(); await expect(mountFiles(core, {...config, bios}, content)).rejects.toThrow("MAME_CONTENT_INVALID");
    expect(core.FS.writeFile).not.toHaveBeenCalled();
  }
});
it("loads Atom quickload media with both required firmware images and no disk expansion", async () => {
  const bytes = new Uint8Array(26), header = new DataView(bytes.buffer);
  header.setUint16(16, 0x2800, true); header.setUint16(18, 0x2800, true); header.setUint16(20, 4, true);
  vi.mocked(materializeFileBytes).mockResolvedValueOnce(bytes);
  const core = fixture();
  await mountFiles(core, {...config, machine: "atom", game: {...source, sizeBytes: bytes.length},
    bios: [{...source, logicalName: "abasic.ic20", sizeBytes: 8192}, {...source, logicalName: "afloat.ic21", sizeBytes: 4096}]}, content);
  expect(core.FS.writeFile).toHaveBeenCalledWith("/content/atom/abasic.ic20", expect.any(Uint8Array));
  expect(core.FS.writeFile).toHaveBeenCalledWith("/content/atom/afloat.ic21", expect.any(Uint8Array));
  expect(core.FS.writeFile).toHaveBeenCalledWith("/content/game.atm", bytes);
  expect(core.FS.writeFile).toHaveBeenCalledWith("/content/boot.cmd", new TextEncoder().encode('atom -pl6 "" -quickload /content/game.atm -rompath /content -skip_gameinfo -nothrottle'));
});
