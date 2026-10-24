import {describe, expect, it} from "vitest";
import {biosCatalog} from "./bios.js";
import {configureRuntime} from "./configure.js";
import {parseRuntimeConfiguration} from "./configuration.js";
import {prepareRuntime} from "./prepare.js";
import type {RuntimeContentFile} from "./types.js";

const sha = "a".repeat(64), fingerprint = "b".repeat(64);
const file = (logicalKey: string): RuntimeContentFile => ({logicalKey, name: logicalKey.split("/").pop()!, sizeBytes: 128, sha256: sha});
const directory = {platformId: "rpgmaker", defaultCoreId: "rpgmaker", allowedCoreIds: ["rpgmaker"]};
const fingerprints = Object.fromEntries(["rpgmaker-xp", "rpgmaker-vx", "rpgmaker-vx-ace", "rpgmaker-mv", "rpgmaker-2000"]
  .map(target => [`retrom-runtime/${target}`, fingerprint]));
const configure = (ini: string) => configureRuntime({platformId: "rpgmaker", coreIds: ["rpgmaker"], files: [file("Game.ini")],
  evidence: {"Game.ini": {text: ini}}}).content;

describe("[RTP-01] mkxp RTP requirements come from the game's Game.ini", () => {
  it("records the engine's official RTP when Game.ini declares it", () => {
    expect(configure("[Game]\r\nScripts=Data\\Scripts.rxdata\r\nRTP1=Standard\r\nRTP2=\r\nRTP3=\r\n"))
      .toEqual({kind: "RPG_MAKER_PROJECT", entryFile: "Game.ini", engine: "RPGXP", rtp: "Standard"});
    expect(configure("[Game]\nRTP=rpgvx\nScripts=Data/Scripts.rvdata\n"))
      .toEqual({kind: "RPG_MAKER_PROJECT", entryFile: "Game.ini", engine: "RPGVX", rtp: "RPGVX"});
    expect(configure("[Game]\nScripts=Data/Scripts.rvdata2\nRTP=RPGVXAce\n"))
      .toEqual({kind: "RPG_MAKER_PROJECT", entryFile: "Game.ini", engine: "RPGVXACE", rtp: "RPGVXAce"});
  });
  it("records no RTP when Game.ini declares none, an empty value or a package the engine does not ship", () => {
    for (const ini of ["[Game]\nScripts=Data/Scripts.rvdata2\n", "[Game]\nScripts=Data/Scripts.rvdata2\nRTP=\n",
      "[Game]\nScripts=Data/Scripts.rvdata2\nRTP=Standard\n", "[Game]\nScripts=Data/Scripts.rvdata2\nRTP=MyOwnRTP\n",
      "[Other]\nRTP=RPGVXAce\n[Game]\nScripts=Data/Scripts.rvdata2\n"]) {
      expect(configure(ini)).toEqual({kind: "RPG_MAKER_PROJECT", entryFile: "Game.ini", engine: "RPGVXACE"});
    }
  });
  it("accepts a stored RTP only for its own RGSS engine", () => {
    expect(parseRuntimeConfiguration({content: {kind: "RPG_MAKER_PROJECT", entryFile: "Game.ini", engine: "RPGXP", rtp: "Standard"}}).content)
      .toMatchObject({rtp: "Standard"});
    for (const content of [{engine: "RPGXP", rtp: "RPGVX"}, {engine: "RPGMV", rtp: "Standard"}, {engine: "RPG2000", rtp: "Standard"},
      {engine: "RPGVXACE", rtp: "rpgvxace"}, {engine: "RPGVXACE", rtp: 1}]) {
      expect(() => parseRuntimeConfiguration({content: {kind: "RPG_MAKER_PROJECT", entryFile: "Game.ini", ...content}})).toThrow();
    }
  });
  it("requires the declared RTP as a seekable rtp resource and nothing for games without one", () => {
    const prepare = (engine: string, entry: string, rtp?: string) => prepareRuntime({directory, fingerprints,
      config: {content: {kind: "RPG_MAKER_PROJECT", entryFile: entry, engine, ...rtp ? {rtp} : {}}},
      files: entry === "index.html" ? [file("index.html"), file("js/rpg_core.js")] : entry === "RPG_RT.ldb" ? [file("RPG_RT.ldb")] : [file("Game.ini")]})
      .biosRequirements;
    expect(prepare("RPGVXACE", "Game.ini", "RPGVXAce")).toEqual([expect.objectContaining({
      requirementKey: "retrom-runtime/rpgmaker-vx-ace/RPGVXAce.zip", targetId: "rpgmaker-vx-ace", logicalName: "RPGVXAce.zip",
      required: true, delivery: "SEEKABLE_BLOB", resourceRole: "rtp",
      archiveEntries: ["Audio/", "Graphics/Titles1/", "Graphics/Battlebacks1/"], archiveExcludes: ["Game.ini", "Data/"]})]);
    expect(prepare("RPGXP", "Game.ini", "Standard").map(item => item.logicalName)).toEqual(["Standard.zip"]);
    expect(prepare("RPGVX", "Game.ini", "RPGVX").map(item => item.logicalName)).toEqual(["RPGVX.zip"]);
    expect(prepare("RPGXP", "Game.ini")).toEqual([]);
    expect(prepare("RPGMV", "index.html")).toEqual([]);
    expect(prepare("RPG2000", "RPG_RT.ldb")).toEqual([]);
  });
  it("declares one installable RTP per mkxp Target without a fixed digest", () => {
    const rtps = biosCatalog().filter(item => item.delivery === "SEEKABLE_BLOB");
    expect(rtps.map(item => [item.targetId, item.logicalName])).toEqual([
      ["rpgmaker-xp", "Standard.zip"], ["rpgmaker-vx", "RPGVX.zip"], ["rpgmaker-vx-ace", "RPGVXAce.zip"]]);
    expect(rtps.every(item => item.sha256 === null && item.md5 === null && item.sizeBytes === null && item.virtualPath === null)).toBe(true);
  });
});
