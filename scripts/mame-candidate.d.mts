type MameRelease = {id: string; repository: string; upstreamCommit: string; adapterAbi: string;
  assets: Array<{filename: string; output: string; maxSizeBytes: number}>};
export function stageMameCandidate(release: MameRelease, directory: string, stage: URL): Promise<string[]>;
