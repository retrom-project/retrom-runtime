import {describe, expect, it} from "vitest";
import {kirikiriOverlayArchives, kirikiriResourceOverlayFiles} from "./overlays.js";

describe("explicit Kiri archive overlays", () => {
  it("preserves exact Unicode filenames, punctuation and selection order", () => {
    const paths = ["补丁/second, chosen.XP3", 'quote"name.xp3', "Patch.xp3", "patch.xp3"];
    expect(kirikiriOverlayArchives(paths)).toEqual(paths);
    expect(kirikiriOverlayArchives(paths)).not.toBe(paths);
    expect(kirikiriOverlayArchives(undefined)).toEqual([]);
    expect(kirikiriOverlayArchives([])).toEqual([]);
  });

  it("accepts the path and archive count boundaries", () => {
    const paths = Array.from({length: 32}, (_, index) => `${index}/${"a".repeat(235 - String(index).length)}.xp3`);
    expect(paths.every(path => path.length === 240)).toBe(true);
    expect(kirikiriOverlayArchives(paths)).toEqual(paths);
    expect(kirikiriOverlayArchives(["a".repeat(236) + ".xp3"])[0]).toHaveLength(240);
  });

  it.each([
    null, "", "patch.xp3", '["patch.xp3"]', {}, [1], [null],
    ["../patch.xp3"], ["/patch.xp3"], ["a//patch.xp3"], ["a/./patch.xp3"],
    ["a\\patch.xp3"], ["a\u0000.xp3"], ["a\u007f.xp3"], ["\ud800.xp3"], ["patch.xp3/"],
    ["patch.bin"], ["nested>patch.xp3"], ["patch.xp3", "patch.xp3"],
    ["a".repeat(237) + ".xp3"], Array.from({length: 33}, (_, index) => `${index}.xp3`),
  ].map(value => ({value})))("rejects malformed, unsafe, duplicate or unbounded selections %#", ({value}) => {
    expect(() => kirikiriOverlayArchives(value)).toThrow("KIRIKIRI_OVERLAY_ARCHIVES_INVALID");
  });

  it("encodes explicit order for the existing native lexical archive ABI and keeps loose resource names", () => {
    const paths = ["data.xp3", "z.xp3", "a.xp3", "overlay/z.xp3", "overlay/0/base.xp3", "overlay/scene.ks"];
    const selection = ["z.xp3", "a.xp3"];
    const files = kirikiriResourceOverlayFiles(paths, "overlay", selection);
    const nativeArchives = files.filter(file => /\.xp3$/iu.test(file.relativePath))
      .sort((left, right) => left.relativePath < right.relativePath ? -1 : 1);
    expect(nativeArchives.map(file => file.path)).toEqual(["/z.xp3", "/a.xp3", "/overlay/0/base.xp3", "/overlay/z.xp3"]);
    expect(files.find(file => file.path === "/overlay/scene.ks")).toEqual({path: "/overlay/scene.ks", relativePath: "scene.ks"});
    expect(paths).toEqual(["data.xp3", "z.xp3", "a.xp3", "overlay/z.xp3", "overlay/0/base.xp3", "overlay/scene.ks"]);
    expect(selection).toEqual(["z.xp3", "a.xp3"]);
  });

  it("retains an overlay root's original lexical archive names when archive selection is absent", () => {
    expect(kirikiriResourceOverlayFiles(["data.xp3", "overlay/z.xp3", "overlay/a.xp3"], "overlay", [])).toEqual([
      {path: "/overlay/z.xp3", relativePath: "z.xp3"}, {path: "/overlay/a.xp3", relativePath: "a.xp3"},
    ]);
    expect(kirikiriResourceOverlayFiles(["data.xp3", "patch3.xp3"], null, [])).toEqual([]);
  });

  it("keeps an overlapping archive only in the higher root layer and ignores unrelated content", () => {
    const files = kirikiriResourceOverlayFiles(["data.xp3", "manual.txt", "z.xp3", "overlay/a.xp3", "overlay/scene.ks"],
      "overlay", ["overlay/a.xp3", "z.xp3"]);
    expect(files.map(file => file.path)).toEqual(["/z.xp3", "/overlay/a.xp3", "/overlay/scene.ks"]);
    expect(files.filter(file => file.path === "/overlay/a.xp3")).toHaveLength(1);
  });
});
