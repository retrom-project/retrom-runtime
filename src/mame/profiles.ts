export type MameMachine = "apple2p" | "apple2e" | "atom" | "pv1000" | "sg1000" | "coleco";
type Firmware = {name: string; directory: string; size: number};
type Profile = {family: string; label: string; path: string; arguments: string; firmware: Firmware[]};
const appleNames = ["341-0011.d0", "341-0012.d8", "341-0013.e0", "341-0014.e8", "341-0015.f0", "341-0020-00.f8", "341-0036.chr"];
export const profiles: Record<MameMachine, Profile> = {
  apple2p: {family: "apple", label: "Apple II (MAME)", path: "/content/game.dsk",
    arguments: 'apple2p -sl4 "" -sl6 diskiing -gameio joy -flop1 /content/game.dsk',
    firmware: [...appleNames.map(name => ({name, directory: "apple2p", size: 2048})),
      {name: "341-0027-a.p5", directory: "a2diskiing", size: 256}, {name: "341-0028-a.rom", directory: "d2fdc", size: 256}]},
  apple2e: {family: "apple", label: "Apple IIe (MAME)", path: "/content/game.dsk",
    arguments: 'apple2e -sl4 "" -sl6 diskiing -gameio joy -flop1 /content/game.dsk',
    firmware: [{name: "342-0133-a.chr", directory: "apple2e", size: 4096},
      {name: "342-0135-b.64", directory: "apple2e", size: 8192},
      {name: "342-0134-a.64", directory: "apple2e", size: 8192},
      {name: "342-0132-c.e12", directory: "apple2e", size: 2048},
      {name: "341-0027-a.p5", directory: "a2diskiing", size: 256},
      {name: "341-0028-a.rom", directory: "d2fdc", size: 256}]},
  atom: {family: "acorn", label: "Acorn Atom (MAME)", path: "/content/game.atm",
    arguments: 'atom -pl6 "" -quickload /content/game.atm',
    firmware: [{name: "abasic.ic20", directory: "atom", size: 8192}, {name: "afloat.ic21", directory: "atom", size: 4096}]},
  pv1000: {family: "vintage", label: "PV-1000 (MAME)", path: "/content/game.rom",
    arguments: "pv1000 -cart /content/game.rom", firmware: []},
  sg1000: {family: "sg1000", label: "SG-1000 (MAME)", path: "/content/game.sg",
    arguments: "sg1000 -cart /content/game.sg", firmware: []},
  coleco: {family: "coleco", label: "ColecoVision (MAME)", path: "/content/game.col",
    arguments: "coleco -cart /content/game.col",
    firmware: [{name: "313_10031-4005_73108a.u2", directory: "coleco", size: 8192}]},
};

export function validGameSize(machine: MameMachine, size: number): boolean {
  if (!Number.isSafeInteger(size)) {return false;}
  if (machine === "apple2p" || machine === "apple2e") {return size === 143360;}
  if (machine === "pv1000") {return [8192, 16384, 32768].includes(size);}
  if (machine === "sg1000" || machine === "coleco") {return size > 22 && size <= 2 * 1024 * 1024;}
  return size > 22 && size <= 65557;
}

export function validateGame(machine: MameMachine, bytes: Uint8Array) {
  if (!validGameSize(machine, bytes.length)) {throw new Error("MAME_CONTENT_INVALID");}
  if (machine === "sg1000" || machine === "coleco") {
    const limit = machine === "sg1000" ? 65536 : 32768;
    if (bytes.length < 8192 || bytes.length > limit || bytes.length % 8192 !== 0) {throw new Error("MAME_CONTENT_INVALID");}
  }
  if (machine !== "atom") {return;}
  const header = new DataView(bytes.buffer, bytes.byteOffset, 22);
  const start = header.getUint16(16, true), size = header.getUint16(20, true);
  if (size + 22 !== bytes.length || start + size > 65536) {throw new Error("MAME_CONTENT_INVALID");}
}
