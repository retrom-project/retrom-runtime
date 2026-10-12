export interface PFBProviderDevInput {
  providerId?: "retrom-runtime" | "emulatorjs";
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

export function buildPFBProvidersDev(input: Omit<PFBProviderDevInput, "localAssets"> & {
  assetsByProvider: Partial<Record<"retrom-runtime" | "emulatorjs", PFBProviderDevInput["localAssets"]>>;
}): Promise<Record<string, {baseBundleSha256: string; moduleSha256: string}>>;

type PFBProviderSelection = Required<Pick<PFBProviderDevInput, "providerId" | "entryPoint">>;

export const defaultPFBProviderDevInput: PFBProviderSelection;

export function selectedPFBProviderDevInput(outputRoot: string): Promise<PFBProviderSelection>;
