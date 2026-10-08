export type RuntimeHostTool = {archivePath: string; sizeBytes: number; sha256: string};
export function buildRuntimeHostTool(input: {
  repositoryRoot: string; outputRoot: string; version: string; sourceTreeSha256: string;
}): Promise<RuntimeHostTool>;
export function copyProductionDependencies(sourceRoot: string, destination: string,
  dependencies: Record<string, string>, copied?: Map<string, string>): Promise<void>;
