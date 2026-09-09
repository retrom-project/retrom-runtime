export const playFiles: Record<string, number>;
export function validPlaySource(source: unknown): boolean;
export function stagePlayCandidate(source: unknown, directory: string | undefined, stage: URL): Promise<string[]>;
