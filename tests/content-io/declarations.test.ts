import golden from "./public-manifests.golden.json" with {type: "json"};
import {expect, it} from "vitest";
import {emulatorJsProviderDefinition} from "../../src/providers/emulatorjs/catalog.js";
import {retromRuntimeProviderDefinition} from "../../src/providers/retrom-runtime/catalog.js";
import {projectProviderManifest} from "../../src/provider/manifest.js";
import {defineTarget} from "../../src/provider/declarations.js";
it("[PK-01] CONTRACT/private-policies covers every input role without changing the public manifest shape", () => {
  for (const provider of [emulatorJsProviderDefinition, retromRuntimeProviderDefinition]) {
    for (const target of provider.targets) {
      expect(Object.keys(target.contentIO).sort()).toEqual(target.inputs.map((input) => input.role).sort());
      expect(() => defineTarget({...target, contentIO: {}})).toThrow();
    }
    const manifest = projectProviderManifest(provider);
    const expected=structuredClone(golden.find(entry=>entry.providerId===provider.providerId)!);
    expected.providerVersion=provider.providerId==="retrom-runtime"?"0.45.0":"2.21.0";
    const external=["j2me","rpgmaker-2000","rpgmaker-2003","rpgmaker-mv","rpgmaker-mz","tyranoscript"];
    for(const target of expected.targets){
      const managed=provider.providerId==="emulatorjs"?["flycast","neocd"].includes(target.id):!external.includes(target.id);
      if(managed){target.assetPaths.push("assets/content-io/worker.mjs");}
      if(provider.providerId==="retrom-runtime"&&target.id==="ppsspp"){
        target.assetPaths=target.assetPaths.filter(path=>path!=="assets/ppsspp/ppsspp-io.worker.mjs");target.assetPaths.push("assets/content-io/sync-client.mjs");
      }
      target.assetPaths=target.assetPaths.map(path=>path==="assets/play/range-device.mjs"?"assets/play/disc-device.mjs":path).sort();
    }
    expect(manifest).toEqual(expected);
    expect(JSON.stringify(manifest)).not.toContain("contentIO");
    expect(JSON.stringify(manifest)).not.toContain("boundaryId");
    expect(JSON.stringify(manifest)).not.toContain("maxFileBytes");
  }
});
