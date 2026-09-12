export function readPFBProviderCoreFiles(
  outputRoot: string, providerId: string, staging: string,
  assetIndex: Record<string, {sha256: string; sizeBytes: number}>,
): Promise<Array<{path: string; contents: Buffer}>>;
