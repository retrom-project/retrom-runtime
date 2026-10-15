// @vitest-environment node
import {expect, it} from "vitest";
import {createRpgPluginFiles} from "./plugin-files.js";
const href = "https://runtime.test/run/id/Game%20Name/www/index.html";
it("keeps immutable scenarios separate from writable saves with exact bytes and snapshot isolation", () => {
  const files = createRpgPluginFiles(href, [{path: "scenario/En/start.sl", data: new TextEncoder().encode("物語").buffer}]);
  expect(files.fs.readFileSync("/run/id/Game Name/scenario/En/start.sl", "utf8")).toBe("物語");
  expect(files.fs.readFileSync("scenario/En/start.sl").toString()).toBe("物語");
  files.fs.writeFileSync(files.saveDirectory + "common.rpgsave", "{}");
  const snapshot = files.snapshot(); files.fs.writeFileSync("save/common.rpgsave", '{"flag":true}');
  const next = createRpgPluginFiles(href, []); next.restore(snapshot);
  expect(next.fs.readFileSync("save/common.rpgsave", {encoding: "utf8"})).toBe("{}");
  expect(next.fs.existsSync("scenario/En/start.sl")).toBe(false);
  expect(() => next.restore([{path: "scenario/En/start.sl", data: new ArrayBuffer(1)}])).toThrow();
  expect(next.fs.readFileSync("save/common.rpgsave", "utf8")).toBe("{}");
  next.fs.unlinkSync("save/common.rpgsave"); expect(next.snapshot()).toEqual([]);
});
it("denies traversal, external paths, content writes and over-budget saves without losing old bytes", () => {
  const files = createRpgPluginFiles(href, []);
  for (const path of ["../save/x.rpgsave", "/etc/passwd", "https://evil.test/x", "save/../x.rpgsave", "save\\x.rpgsave", "save/nested/x.rpgsave", "scenario/a.sl"]) {
    expect(() => files.fs.writeFileSync(path, "bad")).toThrow();
  }
  files.fs.writeFileSync("save/common.rpgsave", "old");
  expect(() => files.fs.writeFileSync("save/common.rpgsave", new Uint8Array(16 * 1024 * 1024 + 1))).toThrow("RPG_PLUGIN_FILES_TOO_LARGE");
  expect(files.fs.readFileSync("save/common.rpgsave", "utf8")).toBe("old");
  files.close(); expect(files.snapshot()).toEqual([]);
});
