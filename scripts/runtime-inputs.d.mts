import type {ProviderBundleResult} from "./provider-bundle.mjs";
import type {ProviderBuildRecord, ProviderReleaseIdentity} from "./provider-release.mjs";
export type RuntimeInputs = {
  schemaVersion: 1;
  repository: string;
  sourceTreeSha256: string;
  release: ProviderReleaseIdentity | null;
  tool: {archive: string; sizeBytes: number; sha256: string};
  providers: Array<ProviderBuildRecord & {moduleSha256: string}>;
};
export function writeRuntimeInputs(input: {
  outputRoot: string; sourceTreeSha256: string; release?: ProviderReleaseIdentity | null;
  tool: {archivePath: string; sizeBytes: number; sha256: string}; providers: ProviderBundleResult[];
}): Promise<RuntimeInputs>;
