import type {Readable, Writable} from "node:stream";
export const maximumMessage: number;
export function serveJSONL(execute: (command: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>,
  options?: {input?: Readable; output?: Writable; concurrency?: number; capacity?: number}): Promise<void>;
