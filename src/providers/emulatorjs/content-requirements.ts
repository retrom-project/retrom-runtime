import type {TargetContentRequirements, TargetArcadeDAT} from "../../provider/declarations.js";
import provenance from "../../runtime/arcade-provenance.json" with {type: "json"};

const flycastCatalog = {"path": "assets/4.2.3/data/cores/flycast-rom-requirements.json", "sha256": "4c72c87d92fd2d4f0473669be08c9cc01446d506d30f27303204261e2276aa87"};
const flycastCore = {"path": "assets/4.2.3/data/cores/flycast-wasm.data", "sha256": "44f7e789285fe2d1408357e3d49b64c47d2d2519bfee4b6225ddb7a0a2591894"};
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
export function emulatorROMSetSelection(target: string) {
 const coreId = ({fbneo: "fbneo", mame2003: "mame2003", mame2003_plus: "mame2003_plus"} as Record<string, string>)[target];
 const source = provenance.find(source => source.coreId === coreId);
 return source ? {datSHA256: source.sha256, driver: "CONTENT_BASENAME" as const} : undefined;
}
export function emulatorRequirementAssets(target: string): string[] {
 if (target === "fbneo") {return [fbneo.asset.path, fbneo.provenance.path];}
 return target.startsWith("flycast-") ? [flycastCatalog.path] : [];
}
