import {versionFromTag} from "./release-version.mjs";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

export function assertFormalCoreSources(sources, catalog, tag) {
  const version = versionFromTag(tag);
  if ((sources.developmentInputs ?? []).length || (catalog.developmentCores ?? []).length ||
      (catalog.developmentForks ?? []).length) {
    throw new Error("FORMAL_RELEASE_DEVELOPMENT_CORE_FORBIDDEN");
  }
  if (/-rc\.[1-9][0-9]*$/u.test(version)) {return;}
  for (const release of [...sources.upstreamReleases, ...catalog.forks ?? []]) {
    if (/-rc\.[1-9][0-9]*$/u.test(release.tag)) {
      throw new Error(`STABLE_RELEASE_RC_CORE_FORBIDDEN:${release.id ?? release.runtimeCore}:${release.tag}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.RETROM_PROVIDER_BUILD_MODE === "release") {
    const sources = JSON.parse(await readFile(new URL("../provider-sources.json", import.meta.url), "utf8"));
    const {emulatorJsSourceCatalog} = await import("../dist/providers/emulatorjs/source-catalog.js");
    assertFormalCoreSources(sources, emulatorJsSourceCatalog, process.env.GITHUB_REF_NAME);
    console.log("formal release core sources: PASS");
  }
}
