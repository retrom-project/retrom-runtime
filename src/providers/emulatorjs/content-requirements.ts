import type {TargetContentRequirements, TargetArcadeDAT} from "../../provider/declarations.js";

const flycastCatalog = {"path": "assets/4.2.3/data/cores/flycast-rom-requirements.json", "sha256": "845b175b4854c3a800eeb9249dc3138c37fa7dcfae45d0fca8f912fdd10a65e1"};
const flycastCore = {"path": "assets/4.2.3/data/cores/flycast-wasm.data", "sha256": "2654fb698a230853ce7ab2ed9515fbffe8d5a583e93ef302bc3ec610691f9f20"};
const fbneo: TargetArcadeDAT = {"format": "ARCADE_XML", "asset": {"path": "assets/4.2.3/data/cores/fbneo-arcade.dat", "sha256": "1864074639d42c2b6a7ad407e2df609c8824041408e42421eb7fa58fce5993e7"}, "core": {"path": "assets/4.2.3/data/cores/fbneo-wasm.data", "sha256": "eab740b32303a75fa9007a4d03e6566aa4ece0e84d3550b2f9490d116e106625"}, "provenance": {"path": "assets/4.2.3/data/cores/fbneo-content-pair.json", "sha256": "4cb989cd43bdf956de1e43b81dea81b2a1f6c55ce69712e4c224141ba1b31c51"}};

export function emulatorContentRequirements(target: string): TargetContentRequirements | undefined {
 if (target === "azahar") {return {kind: "DECRYPTED_NCSD_NCCH"};}
 const platform = target.slice("flycast-".length);
 if (target.startsWith("flycast-") && (platform === "naomi" || platform === "naomi2" || platform === "atomiswave")) {
  return {kind: "FLYCAST_CARTRIDGE", platform, catalog: flycastCatalog, core: flycastCore};
 }
 return undefined;
}
export function emulatorArcadeDAT(target: string): TargetArcadeDAT | undefined {return target === "fbneo" ? fbneo : undefined;}
export function emulatorRequirementAssets(target: string): string[] {
 if (target === "fbneo") {return [fbneo.asset.path, fbneo.provenance.path];}
 return target.startsWith("flycast-") ? [flycastCatalog.path] : [];
}
