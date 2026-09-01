export type CandidateDeclaration = {
  schemaVersion: 1;
  kind: "RETROM_RUNTIME_NEW_CORE_CANDIDATE_V1";
  branchCoreId: string;
  adapterSourceModule: string;
  runtimeFiles: Array<{
    candidateFilename: string;
    bundlePath: string;
    pathInRelease: string;
    role: string;
    maxSizeBytes: number;
  }>;
  artifact: Record<string, unknown>;
};

export function loadCandidateDeclaration(root: string): Promise<CandidateDeclaration | null>;
export function exactKeys(value: unknown, fields: string[]): boolean;
