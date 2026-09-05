export type EmulatorJsProviderInput = {
  cacheRoot: string;
  catalog: {
    schemaVersion: number;
    releases: ReadonlyArray<{
      archive: {name: string; sha256: string; sizeBytes: number; url: string};
      commit: string;
      id: string;
      licenseRoots: readonly string[];
      repository: string;
      tag: string;
    }>;
    overrides: ReadonlyArray<{
      destination: string;
      runtimeCore: string;
      sha256: string;
      sizeBytes: number;
      sourceRelease: string;
      url: string;
    }>;
  };
  definition: {
    targets: ReadonlyArray<{
      assetPaths: readonly string[];
      implementation: {
        coreAssetPath: string;
        coreSha256: string;
        coreSizeBytes: number;
        release: string;
        runtimeCore: string;
      };
    }>;
  };
  extractArchive: (archive: string, destination: string, selections: string[]) => Promise<void>;
  fetchBytes: (url: string, maximum: number) => Promise<Uint8Array>;
  outputRoot: string;
};

export function materializeEmulatorJsProviderInput(input: EmulatorJsProviderInput): Promise<string>;
export function checkEmulatorJsProviderInput(input: EmulatorJsProviderInput): Promise<string>;
