export function prepareCoreCandidates(input: {
  sources: unknown; archiveRoot?: string; baseUrl?: string; outputRoot: string;
}): Promise<Record<string, string>>;
