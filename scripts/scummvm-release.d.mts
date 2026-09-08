export function validScummvmSource(value: unknown): boolean;
export function assertScummvmCandidateMode(inputs: readonly unknown[], pfb: boolean, formal: boolean): void;
export function validateScummvmLayout(layout: unknown): Map<string, number>;
export function unpackScummvmCandidate(source: unknown, layout: unknown, bytes: Uint8Array): Map<string, Uint8Array>;
export function scummvmOutput(path: string): string;
