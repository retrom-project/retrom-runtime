// @vitest-environment node
import {expect, it} from "vitest";
import {readFile} from "node:fs/promises";
import {buildVersion, versionFromTag} from "../scripts/release-version.mjs";
import {retromRuntimeProviderDefinition} from "../src/providers/retrom-runtime/catalog.js";
import {emulatorJsProviderDefinition} from "../src/providers/emulatorjs/catalog.js";

it("derives both formal Provider versions solely from the GitHub tag", () => {
  expect(buildVersion({GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.46.0"})).toBe("0.46.0");
  expect(versionFromTag("v0.46.0-rc.1")).toBe("0.46.0-rc.1");
  for (const tag of ["0.46.0", "v01.46.0", "latest", "v0.46.0-rc.0", "v0.46.0+local"]) {
    expect(() => versionFromTag(tag)).toThrow("PROVIDER_RELEASE_TAG_INVALID");
  }
  expect(() => buildVersion({GITHUB_REF_TYPE: "tag"})).toThrow("PROVIDER_RELEASE_TAG_INVALID");
});
it("keeps untagged builds explicitly developmental and never reads a branch as a release", () => {
  expect(buildVersion({})).toBe("0.0.0-dev");
  expect(buildVersion({GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "v0.46.0"})).toBe("0.0.0-dev");
  expect(buildVersion({RETROM_PFB_CANDIDATE_BUILD: "1", RETROM_PFB_CANDIDATE_VERSION: "0.48.1-dev.1"}))
    .toBe("0.48.1-dev.1");
  expect(() => buildVersion({RETROM_PFB_CANDIDATE_VERSION: "0.48.1-dev.1"}))
    .toThrow("PFB_CANDIDATE_VERSION_INVALID");
  expect(() => buildVersion({RETROM_PFB_CANDIDATE_BUILD: "1", RETROM_PFB_CANDIDATE_VERSION: "0.48.1"}))
    .toThrow("PFB_CANDIDATE_VERSION_INVALID");
  expect(retromRuntimeProviderDefinition.providerVersion).toBe("0.0.0-dev");
  expect(emulatorJsProviderDefinition.providerVersion).toBe("0.0.0-dev");
});
it("does not retain separately maintained package or source versions", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
  expect(pkg).not.toHaveProperty("version");
  expect(lock).not.toHaveProperty("version");
  expect(lock.packages[""]).not.toHaveProperty("version");
  expect(sources).not.toHaveProperty("packageVersion");
});
