export type RuffleDevelopmentSource = {
  id: "ruffle";
  repository: "https://github.com/retrom-project/ruffle";
  upstreamCommit: string;
  adapterAbi: "ruffle-host-v1";
  assets: {filename: string; output: string; maxSizeBytes: number}[];
};
export function validRuffleSource(source: unknown): source is RuffleDevelopmentSource;
export function stageRuffleCandidate(source: unknown, directory: string | undefined, stage: URL): Promise<string[]>;
