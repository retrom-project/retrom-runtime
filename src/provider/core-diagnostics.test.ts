import {expect, it} from "vitest";
import {CoreDiagnostics} from "./core-diagnostics.js";

it("keeps required files and fatal errors through noisy progress, deduplicates and bounds evidence", () => {
  const log = new CoreDiagnostics();
  log.record("\nprogram.bin NOT FOUND\nFatal error: Required files are missing.\n");
  for (let index = 0; index < 40; index++) {
    log.record(`[INFO] progress ${index}\n[DEBUG] debug ${index}\n[WARN] video ${index}`);
    log.record(`registration ${index}`);
    log.record("program.bin NOT FOUND");
  }
  expect(log.messages()).toContain("program.bin NOT FOUND");
  expect(log.messages()).toContain("Fatal error: Required files are missing.");
  expect(log.messages()).toHaveLength(2);
  expect(log.messages().filter(value => value === "program.bin NOT FOUND")).toHaveLength(1);
  log.record("[ERROR] " + "x".repeat(9000));
  for (let index = 0; index < 20; index++) {log.record(`[ERROR] required member ${index} is missing`);}
  expect(log.messages()).toHaveLength(8);
  expect(log.messages().every(message => message.length <= 500)).toBe(true);
  const copy = log.messages(); log.clear();
  expect(log.messages()).toEqual([]); expect(copy.length).toBeGreaterThan(0);
});
