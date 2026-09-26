import {spawnSync} from "node:child_process";
import {describe, expect, it} from "vitest";

import {emulatorJsProviderDefinition} from "./catalog.js";
import {emulatorJsSourceCatalog} from "./source-catalog.js";

describe("EmulatorJS Provider source catalog", () => {
  it("pins DOSBox Pure to the published Content I/O core release", () => {
    expect(emulatorJsSourceCatalog.developmentForks.map(fork => fork.runtimeCore)).not.toContain("dosbox_pure");
    expect(emulatorJsSourceCatalog.forks.find(fork => fork.runtimeCore === "dosbox_pure"))
      .toMatchObject({repository: "https://github.com/retrom-project/dosbox-pure",
        tag: "retrom-core-g3a5222c97456-r1", commit: "a1ad67f90714c445fec56ed24d1e0525b37e4ecf",
        adapterAbi: "emulatorjs-content-io-v1"});
  });

  it("loads directly in Node for the PFB provider watcher", () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e",
      'import("./src/providers/emulatorjs/source-catalog.ts")'], {cwd: process.cwd(), encoding: "utf8"});
    expect(result.status, result.stderr).toBe(0);
  });

  it("pins every internal release used by the provider without host selection data", () => {
    const declared = [...new Set(emulatorJsProviderDefinition.targets.map((target) =>
      String(target.implementation.release)))].sort();
    expect(emulatorJsSourceCatalog.releases.map((release) => release.id).sort()).toEqual(declared);
    for (const release of emulatorJsSourceCatalog.releases) {
      expect(release.commit).toMatch(/^[0-9a-f]{40}$/u);
      expect(release.archive.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(release.archive.url).toBe(
        `${release.repository}/releases/download/${release.tag}/${release.archive.name}`,
      );
      expect(JSON.stringify(release)).not.toMatch(/selected|targetId|platform/u);
    }
    const overrides = emulatorJsProviderDefinition.targets.filter((target) =>
      target.implementation.artifactFlavor === "OVERRIDE" ||
      target.implementation.runtimeCore === "puae" && target.implementation.artifactFlavor === "THREAD_WASM" ||
      ["daphne", "dosbox_pure"].includes(target.implementation.runtimeCore) ||
      target.implementation.runtimeCore === "genesis_plus_gx");
    expect([...emulatorJsSourceCatalog.overrides, ...emulatorJsSourceCatalog.forks, ...emulatorJsSourceCatalog.developmentForks].map((override) => override.runtimeCore).sort())
      .toEqual([...new Set(overrides.map((target) => target.implementation.runtimeCore))].sort());
    for (const override of emulatorJsSourceCatalog.overrides) {
      expect(override.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(override.url).toMatch(/^https:\/\//u);
      expect(override.destination).toMatch(/^4\.2\.3\/data\/cores\//u);
    }
  });
});
