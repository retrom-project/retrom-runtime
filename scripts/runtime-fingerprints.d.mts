import type {ProviderDefinition} from "../src/provider/declarations.js";
import type {AssetIndexV1} from "../src/provider/module-api.js";
export function fingerprintProvider(definition: ProviderDefinition, assetIndex: AssetIndexV1, sourceOverrides?: Record<string, string>): Promise<Record<string,
  {fingerprint: string; inputs: Array<{kind: string; path: string; sha256: string}>}>>;
export function executionAssets(target: ProviderDefinition["targets"][number]): string[];
