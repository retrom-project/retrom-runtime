import {expect, it} from "vitest";
import {validateProviderManifest} from "./contract.js";
import {projectProviderManifest} from "./manifest.js";
import {emulatorJsProviderDefinition} from "../providers/emulatorjs/catalog.js";

it("accepts declared target content requirements and rejects unbound or malformed evidence", () => {
 const manifest = projectProviderManifest(emulatorJsProviderDefinition);
 expect(() => validateProviderManifest(manifest)).not.toThrow();
 const original = manifest.targets.find(target => target.id === "flycast-naomi")!;
 for (const patch of [
  {kind: "FLYCAST_CARTRIDGE", platform: ["naomi"]},
  {kind: "DECRYPTED_NCSD_NCCH", hidden: true},
  {...original.contentRequirements, core: {path: "assets/missing.data", sha256: "a".repeat(64)}},
 ]) {
  expect(() => validateProviderManifest({...manifest, targets: [{...original, contentRequirements: patch}]}))
   .toThrow("PROVIDER_MANIFEST_INVALID");
 }
 const fbneo = manifest.targets.find(target => target.id === "fbneo")!;
 expect(() => validateProviderManifest({...manifest, targets: [{...fbneo, arcadeDAT: {...fbneo.arcadeDAT, format: "GUESS"}}]}))
  .toThrow("PROVIDER_MANIFEST_INVALID");
});
