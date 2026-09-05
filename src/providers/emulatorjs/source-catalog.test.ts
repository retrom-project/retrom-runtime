import {describe, expect, it} from "vitest";

import {emulatorJsProviderDefinition} from "./catalog.js";
import {emulatorJsSourceCatalog} from "./source-catalog.js";

describe("EmulatorJS Provider source catalog", () => {
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
      target.implementation.artifactFlavor === "OVERRIDE");
    expect(emulatorJsSourceCatalog.overrides.map((override) => override.runtimeCore).sort())
      .toEqual(overrides.map((target) => target.implementation.runtimeCore).sort());
    for (const override of emulatorJsSourceCatalog.overrides) {
      expect(override.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(override.url).toMatch(/^https:\/\//u);
      expect(override.destination).toMatch(/^4\.2\.3\/data\/cores\//u);
    }
  });
});
