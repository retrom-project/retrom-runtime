export class PlayerRuntimeError extends Error {
  readonly name = "PlayerRuntimeError";

  constructor(readonly code: string, options?: ErrorOptions) {
    super(code, options);
  }
}
