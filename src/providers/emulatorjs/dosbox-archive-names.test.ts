import {expect, it} from "vitest";
import {dosArchiveNames} from "./dosbox-archive-names.js";

it("keeps ASCII paths and consistently aliases shared Unicode directories and filenames", () => {
  const names = ["金庸群侠传/", "金庸群侠传/PLAY.BAT", "金庸群侠传/Z.COM", "金庸群侠传/子目录/运行.exe", "DOOM2/DOOM2.EXE"];
  const paths = dosArchiveNames(names), directory = paths.get(names[0])!;
  expect(directory).toMatch(/^[A-Z0-9]{8}\/$/u);
  expect(paths.get(names[1])).toBe(directory + "PLAY.BAT");
  expect(paths.get(names[2])).toBe(directory + "Z.COM");
  expect(paths.get(names[3])).toMatch(/^[A-Z0-9]{8}\/[A-Z0-9]{8}\/[A-Z0-9]{8}\.EXE$/u);
  expect(paths.get(names[4])).toBe(names[4]);
  expect([...paths]).toEqual([...dosArchiveNames(names)]);
});

it("avoids case-insensitive collisions with existing DOS names regardless of record order", () => {
  const unicode = "游戏/PLAY.BAT", native = dosArchiveNames([unicode]).get(unicode)!;
  const occupied = native.toLowerCase().replace("play.bat", "keep.txt");
  for (const names of [[unicode, occupied], [occupied, unicode]]) {
    const mapped = dosArchiveNames(names).get(unicode)!;
    expect(mapped.split("/")[0].toUpperCase()).not.toBe(native.split("/")[0]);
    expect(dosArchiveNames(names).get(occupied)).toBe(occupied);
  }
});
