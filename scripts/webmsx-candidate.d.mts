export type WebMSXDevelopmentSource = {
  id: "webmsx";
  repository: "https://github.com/retrom-project/WebMSX";
  upstreamCommit: string;
  adapterAbi: "webmsx-host-v1";
  assets: {filename: string; output: string; maxSizeBytes: number}[];
};
export function validWebMSXSource(source: unknown): source is WebMSXDevelopmentSource;
export function asWebMSXCandidateSource(release: unknown): WebMSXDevelopmentSource;
export function stageWebMSXCandidate(source: unknown, directory: string | undefined, stage: URL): Promise<string[]>;
