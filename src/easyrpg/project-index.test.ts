import {expect, it} from "vitest";
import {easyRpgProjectIndex} from "./project-index.js";

it("publishes the pinned engine's asset names while retaining root data and translation extensions", () => {
  expect(easyRpgProjectIndex([
    "CharSet/retrom-hero.png", "Picture/retrom-marker.png", "RPG_RT.ldb", "ExFont.png",
    "Translation/Meta.ini", "Translation/dialogue.po", "Music/Opening.ogg",
  ])).toEqual({metadata: {version: 2}, cache: {
    charset: {_dirname: "CharSet", "retrom-hero": "retrom-hero.png"},
    picture: {_dirname: "Picture", "retrom-marker": "retrom-marker.png"},
    "rpg_rt.ldb": "RPG_RT.ldb", exfont: "ExFont.png",
    translation: {_dirname: "Translation", "meta.ini": "Meta.ini", "dialogue.po": "dialogue.po"},
    music: {_dirname: "Music", opening: "Opening.ogg"},
  }});
});

it("normalizes lookup spelling while retaining original Unicode paths", () => {
  expect(easyRpgProjectIndex(["Picture/ＨＥＲＯ.png"])).toEqual({metadata: {version: 2},
    cache: {picture: {_dirname: "Picture", hero: "ＨＥＲＯ.png"}}});
});

it.each([
  ["Picture/Hero.png", "Picture/Hero.xyz"],
  ["Picture/Hero.png", "picture/Other.png"],
  ["Picture/Hero.png", "Picture/ＨＥＲＯ.png"],
  ["Picture.png", "Picture.png/Hero.png"],
  ["Picture/_dirname.png"],
].map(paths => ({paths})))("rejects ambiguous or reserved native lookups: $paths", ({paths}) => {
  expect(() => easyRpgProjectIndex(paths)).toThrow("RPG_RUNTIME_PACK_INVALID");
});
