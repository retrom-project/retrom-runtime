export type BoundaryEntry = {repository: string; path: string; symbol: string; classification: string;
  reason: string; tests: string[]; ownerStage: string};
export type BoundarySite = {symbol: string; kind: string; callee: string; line: number};
export function scanBoundaries(path: string, text: string): BoundarySite[];
export function auditSource(repository: string, path: string, text: string, entries: BoundaryEntry[]): BoundarySite[];
export function repositorySources(root: string, directories: string[]): Promise<{path: string; text: string}[]>;
