import type {AssetIndexV1} from "../src/provider/module-api.js";

export type ProviderClientBuildInput = {
  assetIndex: AssetIndexV1;
  pfbCoreInputs?: Record<string, {sha256: string; sizeBytes: number; artifactSetSha256: string}>;
  entryPoint: string;
  outfile: string;
};

export type ProviderClientBuildResult = {
  externalImports: string[];
  outfile: string;
  outputCount: number;
};

export function buildProviderClient(input: ProviderClientBuildInput): Promise<ProviderClientBuildResult>;
