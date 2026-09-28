import {expect, it, vi} from "vitest";
import {mountFiles} from "./files.js";
import {eagerPolicy} from "../provider/content-policies.js";
vi.mock("../provider/content-inputs.js", async original => ({...await original<typeof import("../provider/content-inputs.js")>(),
  materializeFileBytes: vi.fn(async (_session, file: {sizeBytes: number}) => new Uint8Array(file.sizeBytes))}));
const source = {url: "/game", sha256: "a".repeat(64), sizeBytes: 143360};
const names = ["341-0011.d0", "341-0012.d8", "341-0013.e0", "341-0014.e8", "341-0015.f0", "341-0020-00.f8", "341-0036.chr", "341-0027-a.p5", "341-0028-a.rom"];
const config = {game: source, runtimeBaseUrl: "/provider/", bios: names.map(logicalName => ({...source, logicalName, sizeBytes: logicalName.endsWith(".p5") || logicalName.endsWith(".rom") ? 256 : 2048}))};
const content = {assetIndex: {}, contentSession: {inputPolicy: () => eagerPolicy(143360),
  open: async () => {throw new Error("unused");}, materialize: async () => {throw new Error("unused");}, closeFile: async () => {}}};
function fixture() {return {FS: {mkdirTree: vi.fn(), writeFile: vi.fn(), chmod: vi.fn(), ignorePermissions: true}};}
it("mounts the machine, Disk II card and nested controller BIOS and opens a read-only game", async () => {
  const core = fixture(); await mountFiles(core, config, content);
  expect(core.FS.writeFile).toHaveBeenCalledWith("/content/d2fdc/341-0028-a.rom", expect.any(Uint8Array));
  expect(core.FS.writeFile).toHaveBeenCalledWith("/content/a2diskiing/341-0027-a.p5", expect.any(Uint8Array));
  expect(core.FS.chmod).toHaveBeenCalledWith("/content/game.dsk", 0o444); expect(core.FS.ignorePermissions).toBe(false);
});
it("rejects missing, duplicated and unexpected firmware before mounting anything", async () => {
  for (const bios of [config.bios.slice(0, -1), [...config.bios, config.bios[0]], [...config.bios.slice(0, -1), {...config.bios[0], logicalName: "../escape"}]]) {
    const core = fixture(); await expect(mountFiles(core, {...config, bios}, content)).rejects.toThrow("MAME_CONTENT_INVALID");
    expect(core.FS.writeFile).not.toHaveBeenCalled();
  }
});
