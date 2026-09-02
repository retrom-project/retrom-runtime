import type {ProviderDefinition} from "../src/provider/declarations.js";
import type {ProviderManifest} from "../src/provider/manifest.js";
import type {ProviderBundleResult} from "./provider-bundle.mjs";

export type RetromRuntimeProviderBuildInput = {
  commit: string;
  definition: ProviderDefinition;
  entryPoint: string;
  manifest: ProviderManifest;
  outputRoot: string;
  stageRoot: string;
};

export function buildRetromRuntimeProviderBundle(
  input: RetromRuntimeProviderBuildInput,
): Promise<ProviderBundleResult>;

export type EmulatorJsProviderBuildInput = Omit<RetromRuntimeProviderBuildInput, "stageRoot"> & {
  sourceCatalog: unknown;
  sourceRoot: string;
};

export function buildEmulatorJsProviderBundle(
  input: EmulatorJsProviderBuildInput,
): Promise<ProviderBundleResult>;

export function targetContractDigests(
  manifest: ProviderManifest,
  assetIndex: Readonly<Record<string, {sha256: string; sizeBytes: number}>>,
): Record<string, string>;

export function canonicalJsonBytes(value: unknown): Buffer;
