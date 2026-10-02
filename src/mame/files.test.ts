import {afterEach, expect, it, vi} from "vitest";
import {zipSync} from "fflate";
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
afterEach(() => vi.unstubAllGlobals());
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
it("mounts Apple IIe using its own ROM set and the shared Disk II controller", async () => {
  const bios = [
    ["342-0133-a.chr", 4096], ["342-0135-b.64", 8192], ["342-0134-a.64", 8192], ["342-0132-c.e12", 2048],
    ["341-0027-a.p5", 256], ["341-0028-a.rom", 256],
  ] as const;
  const core = fixture();
  await mountFiles(core, {...config, machine: "apple2e", bios: bios.map(([logicalName, sizeBytes]) => ({...source, logicalName, sizeBytes}))}, content);
  expect(core.FS.writeFile).toHaveBeenCalledWith("/content/apple2e/342-0133-a.chr", expect.any(Uint8Array));
  expect(core.FS.writeFile).toHaveBeenCalledWith("/content/boot.cmd", new TextEncoder().encode(
    'apple2e -sl4 "" -sl6 diskiing -gameio joy -flop1 /content/game.dsk -rompath /content -skip_gameinfo -nothrottle'));
});
it("mounts a single SG-1000 or ColecoVision cartridge from a bounded ZIP", async () => {
  for (const [machine, extension, length, firmware] of [
    ["sg1000", "sg", 49152, []],
    ["coleco", "col", 32768, [{...source, logicalName: "313_10031-4005_73108a.u2", sizeBytes: 8192}]],
  ] as const) {
    const archive = zipSync({[`Game.${extension}`]: new Uint8Array(length)});
    vi.mocked(materializeFileBytes).mockResolvedValueOnce(archive);
    const core = fixture();
    await mountFiles(core, {...config, machine, bios: [...firmware], game: {...source, sizeBytes: archive.length}}, content);
    expect(core.FS.writeFile).toHaveBeenCalledWith(`/content/game.${extension}`, expect.any(Uint8Array));
    expect(core.FS.writeFile).toHaveBeenCalledWith("/content/boot.cmd", new TextEncoder().encode(
      `${machine} -cart /content/game.${extension} -rompath /content -skip_gameinfo -nothrottle`));
  }
});
it("rejects malformed cartridge ZIPs and oversized expanded media", async () => {
  for (const archive of [zipSync({"a.sg": new Uint8Array(8192), "b.sg": new Uint8Array(8192)}),
    zipSync({"../a.sg": new Uint8Array(8192)}), zipSync({"a.sg": new Uint8Array(65537)})]) {
    vi.mocked(materializeFileBytes).mockResolvedValueOnce(archive);
    const core = fixture();
    await expect(mountFiles(core, {...config, machine: "sg1000", bios: [], game: {...source, sizeBytes: archive.length}}, content))
      .rejects.toThrow("MAME_CONTENT_INVALID");
  }
});
it("mounts a MAME arcade machine with the selected game, parent and BIOS archives", async () => {
  const parent = zipSync({"puckman.zip": new Uint8Array(40)}), bios = zipSync({"namco51.zip": new Uint8Array(20)});
  vi.mocked(materializeFileBytes).mockResolvedValueOnce(new Uint8Array(40)).mockResolvedValueOnce(parent).mockResolvedValueOnce(bios);
  const fetch = vi.fn(() => {throw new Error("BIOS bypassed Content I/O");});
  vi.stubGlobal("fetch", fetch);
  const core = fixture(), arcade = {arcade: true as const, machine: "mspacman", game: {...source, sizeBytes: 40},
    parent: {...source, url: "/parent"}, bios: {...source, url: "/bios"}, deviceBios: [], runtimeBaseUrl: "/provider/"};
  await mountFiles(core, arcade, content);
  expect(fetch).not.toHaveBeenCalled();
  expect(materializeFileBytes).toHaveBeenCalledWith(content.contentSession, arcade.bios, expect.any(Object), "FIRMWARE", undefined, expect.any(Function));
  expect(core.FS.writeFile).toHaveBeenCalledWith("/content/roms/mspacman.zip", expect.any(Uint8Array));
  expect(core.FS.writeFile).toHaveBeenCalledWith("/content/roms/puckman.zip", expect.any(Uint8Array));
  expect(core.FS.writeFile).toHaveBeenCalledWith("/content/roms/namco51.zip", expect.any(Uint8Array));
  expect(core.FS.writeFile).toHaveBeenCalledWith("/content/boot.cmd",
    new TextEncoder().encode("mspacman -rompath /content/roms -skip_gameinfo -nothrottle"));
});
it("rejects archive names that could escape the MAME ROM directory", async () => {
  const parent = zipSync({"../escape.zip": new Uint8Array(40)});
  vi.mocked(materializeFileBytes).mockResolvedValueOnce(new Uint8Array(40)).mockResolvedValueOnce(parent);
  const core = fixture();
  await expect(mountFiles(core, {arcade: true, machine: "mspacman", game: {...source, sizeBytes: 40},
    parent: {...source, url: "/parent"}, bios: null, deviceBios: [], runtimeBaseUrl: "/provider/"}, content)).rejects.toThrow("MAME_CONTENT_INVALID");
  expect(core.FS.writeFile).not.toHaveBeenCalled();
});
it("mounts the separately installed Sega Model 2 billboard ROM at its MAME search path", async () => {
  const core = fixture(), deviceBios = [{...source, logicalName: "epr-18022.ic2",
    virtualPath: "content/roms/segabill/epr-18022.ic2", sizeBytes: 65536}];
  await mountFiles(core, {arcade: true, machine: "vf2", game: {...source, sizeBytes: 40},
    parent: null, bios: null, deviceBios, runtimeBaseUrl: "/provider/"}, content);
  expect(core.FS.mkdirTree).toHaveBeenCalledWith("/content/roms/segabill");
  expect(core.FS.writeFile).toHaveBeenCalledWith("/content/roms/segabill/epr-18022.ic2", expect.any(Uint8Array));
});
