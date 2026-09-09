export type OpenBORDevelopmentSource = {
  id: "openbor";
  repository: "https://github.com/retrom-project/openbor";
  upstreamCommit: string;
  adapterAbi: "openbor-host-v1";
  assets: {filename: string; output: string; maxSizeBytes: number}[];
};
export function validOpenBORSource(source: unknown): source is OpenBORDevelopmentSource;
export function asOpenBORCandidateSource(release: unknown): OpenBORDevelopmentSource;
export function stageOpenBORCandidate(source: unknown, directory: string | undefined, stage: URL): Promise<string[]>;
