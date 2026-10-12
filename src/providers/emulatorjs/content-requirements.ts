import type {TargetContentRequirements, TargetArcadeDAT} from "../../provider/declarations.js";
import provenance from "../../runtime/arcade-provenance.json" with {type: "json"};

const flycastCatalog = {"path": "assets/4.2.3/data/cores/flycast-rom-requirements.json", "sha256": "ad46976c01472c9aa710e0d0f15d0a39bff2ac1b7fc49d7bbb4092773bfa77fd"};
const flycastCore = {"path": "assets/4.2.3/data/cores/flycast-wasm.data", "sha256": "c8ed647ff6d63bff45314ee5acea0b2f91fa6ef4049f62e19c4065aff95c2a6d"};
const fbneo: TargetArcadeDAT = {"format": "ARCADE_XML", "asset": {"path": "assets/4.2.3/data/cores/fbneo-arcade.dat", "sha256": "b7192ff1aa025b8281979d96e12c8cf82e4df43a3afb81af6b668a4a7bbb90f9"}, "core": {"path": "assets/4.2.3/data/cores/fbneo-wasm.data", "sha256": "4f0ea82f529eefbbbd4d97f347dcbd55655ba9dd7ccc9d20e4c4806e0885fafa"}, "provenance": {"path": "assets/4.2.3/data/cores/fbneo-content-pair.json", "sha256": "e6380f45de1e854c8c889ebd00efa4d3520994365392f269ae10441d953faa28"}};

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
