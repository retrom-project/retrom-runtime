// @vitest-environment node
import {execFileSync} from "node:child_process";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {expect, it} from "vitest";

it("requires exact provider bytes for product evidence even when saves remain compatible", () => {
  const root = mkdtempSync(join(tmpdir(), "product-matrix-identity-"));
  const write = (name: string, value: unknown) => writeFileSync(join(root, name), JSON.stringify(value));
  try {
    mkdirSync(join(root, "installed", "provider"), {recursive: true});
    const provider = {providerId: "emulatorjs", installationPath: "provider",
      bundleSha256: "b".repeat(64), moduleSha256: "c".repeat(64)};
    const fingerprint = "a".repeat(64);
    write("active.json", {providers: [provider]});
    write("installed/provider/runtime-fingerprints.json", {targets: {fceumm: {fingerprint}}});
    for (const changed of ["bundle", "module", "neither"]) {
      write("matrix.json", {rows: [{id: "emulatorjs/fceumm/nes", providerId: "emulatorjs", targetId: "fceumm",
        materialCandidates: [], materialStatus: "REDISTRIBUTABLE_FIXTURE_CANDIDATE", productStatus: "PASS",
        checks: {launch: "PENDING"}, semanticEvidence: [{result: "PASS", coreFingerprint: fingerprint,
          providerBundleSha256: changed === "bundle" ? "d".repeat(64) : provider.bundleSha256,
          providerModuleSha256: changed === "module" ? "e".repeat(64) : provider.moduleSha256,
          checks: {launch: "PASS"}}]}]});
      execFileSync(process.execPath, [resolve("scripts/acceptance/update-product-matrix.mjs"),
        "--matrix", join(root, "matrix.json"), "--evidence-root", root,
        "--provider-base", root, "--output", join(root, "output.json")]);
      const report = JSON.parse(readFileSync(join(root, "output.json"), "utf8"));
      expect(report.rows[0].productStatus, changed).toBe(changed === "neither" ? "PASS" : "PRODUCT_ATTEMPTED");
    }
  } finally {rmSync(root, {recursive: true, force: true});}
});
