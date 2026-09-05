export interface PFBProviderDevInput {
  activePath: string;
  entryPoint: string;
  installedRoot: string;
  localAssets: ReadonlyArray<{source: string; output: string}>;
  outputRoot: string;
}

export function buildPFBProviderDev(input: PFBProviderDevInput): Promise<{
  baseBundleSha256: string;
  moduleSha256: string;
}>;

export const defaultPFBProviderDevInput: Pick<PFBProviderDevInput, "entryPoint">;
