import {expect, it} from "vitest";
import {parseProjectIndex} from "./project-index.js";
const file = {path: "game/中文?#.bin", sizeBytes: 3, sha256: "a".repeat(64), mediaType: "application/octet-stream",
  url: "/runs/resource/%E4%B8%AD%E6%96%87%3F%23.bin"};
it("reads only the public immutable five-field tree without private engine fields", () => {
  expect(parseProjectIndex({schemaVersion: 1, files: [file]}, 2)).toEqual({schemaVersion: 1, files: [file]});
  expect(parseProjectIndex({schemaVersion: 1, files: [file], title: "private"}, 2)).toBeNull();
});
it.each(["sha256", "mediaType", "path", "sizeBytes", "url"])("requires declared %s", key => {
  const value = Object.fromEntries(Object.entries(file).filter(([field]) => field !== key));
  expect(parseProjectIndex({schemaVersion: 1, files: [value]}, 2)).toBeNull();
});
it.each([{sha256: "bad"}, {mediaType: "text/html\nunsafe"}, {path: "../escape"}, {path: "a\\b"},
  {url: "https://user:secret@runtime.invalid/a"}, {url: "/a#b"}, {url: "javascript:1"}, {sizeBytes: -1}])("rejects malformed immutable facts %j", patch => {
  expect(parseProjectIndex({schemaVersion: 1, files: [{...file, ...patch}]}, 2)).toBeNull();
});
it("bounds counts, folded path ambiguity and total exact sizes", () => {
  expect(parseProjectIndex({schemaVersion: 1, files: [file, {...file, path: file.path.toUpperCase()}]}, 2)).toBeNull();
  expect(parseProjectIndex({schemaVersion: 1, files: [file]}, 0)).toBeNull();
  expect(parseProjectIndex({schemaVersion: 1, files: [file, {...file, path: "x", sizeBytes: Number.MAX_SAFE_INTEGER}]}, 2)).toBeNull();
});
