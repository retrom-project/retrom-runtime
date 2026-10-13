import type {TargetContentRequirements, TargetArcadeDAT} from "../../provider/declarations.js";
import provenance from "../../runtime/arcade-provenance.json" with {type: "json"};

const flycastCatalog = {"path": "assets/4.2.3/data/cores/flycast-rom-requirements.json", "sha256": "4c72c87d92fd2d4f0473669be08c9cc01446d506d30f27303204261e2276aa87"};
const flycastCore = {"path": "assets/4.2.3/data/cores/flycast-wasm.data", "sha256": "44f7e789285fe2d1408357e3d49b64c47d2d2519bfee4b6225ddb7a0a2591894"};
const fbneo: TargetArcadeDAT = {"format": "ARCADE_XML", "asset": {"path": "assets/4.2.3/data/cores/fbneo-arcade.dat", "sha256": "b7192ff1aa025b8281979d96e12c8cf82e4df43a3afb81af6b668a4a7bbb90f9"}, "core": {"path": "assets/4.2.3/data/cores/fbneo-wasm.data", "sha256": "6cf6dcde0dd230415706d49e9b20ffcf3f58666cbd118e66c00d497ab5f5bfb8"}, "provenance": {"path": "assets/4.2.3/data/cores/fbneo-content-pair.json", "sha256": "6ec331af711fa37baa78edf9143da0f6bdebb4bc954744383f68bf6d49adb448"}};

const arcadeDATs: Readonly<Record<string, TargetArcadeDAT>> = {fbneo, fbalpha: {"format": "ARCADE_XML", "asset": {"path": "assets/4.2.3/data/cores/fbalpha-arcade.dat", "sha256": "4c257078e2f2ab66c75602905d68b7fe7e93e114858813a479e2fd08dd5f18a1"}, "core": {"path": "assets/4.2.3/data/cores/fbalpha-wasm.data", "sha256": "18ea6e0b352f757323602b856514a4955d99766c4c0a72df7eb2e457120373a4"}, "provenance": {"path": "assets/4.2.3/data/cores/fbalpha-content-pair.json", "sha256": "9276511f3299f5df9d31a4ddbe897987361b156b6fbc7919398e94c99f2a0317"}}};

export function emulatorContentRequirements(target: string): TargetContentRequirements | undefined {
 if (target === "azahar") {return {kind: "DECRYPTED_NCSD_NCCH"};}
 const platform = target.slice("flycast-".length);
 if (target.startsWith("flycast-") && (platform === "naomi" || platform === "naomi2" || platform === "atomiswave")) {
  return {kind: "FLYCAST_CARTRIDGE", platform, catalog: flycastCatalog, core: flycastCore};
 }
 return undefined;
}
export function emulatorArcadeDAT(target: string): TargetArcadeDAT | undefined {return arcadeDATs[target];}
export function emulatorROMSetSelection(target: string) {
 const coreId = ({fbalpha: "fbalpha", fbneo: "fbneo", mame2003: "mame2003", mame2003_plus: "mame2003_plus"} as Record<string, string>)[target];
 const source = provenance.find(source => source.coreId === coreId);
 return source ? {datSHA256: source.sha256, driver: "CONTENT_BASENAME" as const} : undefined;
}
export function emulatorRequirementAssets(target: string): string[] {
 const dat = arcadeDATs[target];
 if (dat) {return [dat.asset.path, dat.provenance.path];}
 return target.startsWith("flycast-") ? [flycastCatalog.path] : [];
}
