export type MameMachine = "apple2p" | "atom" | "pv1000";
type Firmware = {name: string; directory: string; size: number};
type Profile = {family: string; label: string; path: string; arguments: string; firmware: Firmware[]};
const appleNames = ["341-0011.d0", "341-0012.d8", "341-0013.e0", "341-0014.e8", "341-0015.f0", "341-0020-00.f8", "341-0036.chr"];
export const profiles: Record<MameMachine, Profile> = {
  apple2p: {family: "apple", label: "Apple II (MAME)", path: "/content/game.dsk",
    arguments: 'apple2p -sl4 "" -sl6 diskiing -gameio joy -flop1 /content/game.dsk',
    firmware: [...appleNames.map(name => ({name, directory: "apple2p", size: 2048})),
      {name: "341-0027-a.p5", directory: "a2diskiing", size: 256}, {name: "341-0028-a.rom", directory: "d2fdc", size: 256}]},
  atom: {family: "acorn", label: "Acorn Atom (MAME)", path: "/content/game.atm",
    arguments: 'atom -pl6 "" -quickload /content/game.atm',
    firmware: [{name: "abasic.ic20", directory: "atom", size: 8192}, {name: "afloat.ic21", directory: "atom", size: 4096}]},
  pv1000: {family: "vintage", label: "PV-1000 (MAME)", path: "/content/game.rom",
    arguments: "pv1000 -cart /content/game.rom", firmware: []},
};

export function validGameSize(machine: MameMachine, size: number): boolean {
  if (!Number.isSafeInteger(size)) {return false;}
  if (machine === "apple2p") {return size === 143360;}
  if (machine === "pv1000") {return [8192, 16384, 32768].includes(size);}
  return size > 22 && size <= 65557;
}

export function validateGame(machine: MameMachine, bytes: Uint8Array) {
  if (!validGameSize(machine, bytes.length)) {throw new Error("MAME_CONTENT_INVALID");}
  if (machine !== "atom") {return;}
  const header = new DataView(bytes.buffer, bytes.byteOffset, 22);
  const start = header.getUint16(16, true), size = header.getUint16(20, true);
  if (size + 22 !== bytes.length || start + size > 65536) {throw new Error("MAME_CONTENT_INVALID");}
}
