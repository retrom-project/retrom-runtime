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

type PFBProviderSelection = Required<Pick<PFBProviderDevInput, "providerId" | "entryPoint">>;

export const defaultPFBProviderDevInput: PFBProviderSelection;

export function selectedPFBProviderDevInput(outputRoot: string): Promise<PFBProviderSelection>;
