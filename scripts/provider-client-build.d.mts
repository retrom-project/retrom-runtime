import type {AssetIndexV1} from "../src/provider/module-api.js";

export type ProviderClientBuildInput = {
  assetIndex: AssetIndexV1;
  entryPoint: string;
  outfile: string;
};

export type ProviderClientBuildResult = {
  externalImports: string[];
  outfile: string;
  outputCount: number;
};

export function buildProviderClient(input: ProviderClientBuildInput): Promise<ProviderClientBuildResult>;
