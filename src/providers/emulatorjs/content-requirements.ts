import type {TargetContentRequirements, TargetArcadeDAT} from "../../provider/declarations.js";
import provenance from "../../runtime/arcade-provenance.json" with {type: "json"};

const flycastCatalog = {"path": "assets/4.2.3/data/cores/flycast-rom-requirements.json", "sha256": "4c72c87d92fd2d4f0473669be08c9cc01446d506d30f27303204261e2276aa87"};
const flycastCore = {"path": "assets/4.2.3/data/cores/flycast-wasm.data", "sha256": "44f7e789285fe2d1408357e3d49b64c47d2d2519bfee4b6225ddb7a0a2591894"};
const fbneo: TargetArcadeDAT = {"format": "ARCADE_XML", "asset": {"path": "assets/4.2.3/data/cores/fbneo-arcade.dat", "sha256": "b7192ff1aa025b8281979d96e12c8cf82e4df43a3afb81af6b668a4a7bbb90f9"}, "core": {"path": "assets/4.2.3/data/cores/fbneo-wasm.data", "sha256": "6cf6dcde0dd230415706d49e9b20ffcf3f58666cbd118e66c00d497ab5f5bfb8"}, "provenance": {"path": "assets/4.2.3/data/cores/fbneo-content-pair.json", "sha256": "6ec331af711fa37baa78edf9143da0f6bdebb4bc954744383f68bf6d49adb448"}};

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
