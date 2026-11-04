import type {ProviderBundleResult} from "./provider-bundle.mjs";
import type {ProviderChunkPublication} from "./provider-chunks.mjs";
import type {ProviderBuildRecord, ProviderReleaseIdentity} from "./provider-release.mjs";
export type RuntimeInputs = {
  schemaVersion: 2;
  repository: string;
  sourceTreeSha256: string;
  release: ProviderReleaseIdentity | null;
  providers: Array<Omit<ProviderBuildRecord, "bundleDirectory" | "chunkDirectory"> & {moduleSha256: string}>;
};
export function writeRuntimeInputs(input: {
  outputRoot: string; sourceTreeSha256: string; release?: ProviderReleaseIdentity | null;
  providers: Array<ProviderBundleResult & {chunkRoot: string; chunks: ProviderChunkPublication}>;
}): Promise<RuntimeInputs>;
export function writeRebuiltRuntimeInputs(input: Omit<Parameters<typeof writeRuntimeInputs>[0], "providers"> & {
  providers: ProviderBundleResult[];
}): Promise<RuntimeInputs>;
