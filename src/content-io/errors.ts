import numbers from "../../contracts/content-io/v1/errors.json" with {type: "json"};
export const errorNumbers = Object.freeze(numbers);
export type ContentErrorName = keyof typeof errorNumbers;
export type ErrorScope = "REQUEST" | "OBJECT" | "SESSION";
export class ContentIOError extends Error {
  readonly code: `CONTENT_IO_${ContentErrorName}`;
  readonly codeNumber: number;
  readonly scope: ErrorScope;
  readonly retryable: boolean;
  constructor(name: ContentErrorName, options: {scope?: ErrorScope; cause?: unknown; retryable?: boolean} = {}) {
    super(`CONTENT_IO_${name}`, {cause: options.cause});
    this.name = "ContentIOError";
    this.code = `CONTENT_IO_${name}`;
    this.codeNumber = errorNumbers[name];
    this.scope = options.scope ?? (name === "IDENTITY_CHANGED" || name === "CHECKSUM_MISMATCH" ? "OBJECT" :
      name === "AUTHORIZATION_FAILED" ? "SESSION" : "REQUEST");
    this.retryable = (name === "NETWORK_FAILED" || name === "TIMEOUT") && options.retryable === true;
  }
}
export function toContentIOError(error: unknown): ContentIOError {
  if (error instanceof ContentIOError) {return error;}
  if (error instanceof Error && error.name === "AbortError") {return new ContentIOError("ABORTED", {cause: error});}
  return new ContentIOError("INTERNAL", {cause: error});
}
export function fail(name: ContentErrorName): never {throw new ContentIOError(name);}
