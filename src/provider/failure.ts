import type {RuntimeFailureV1} from "./generated/provider-module-v2.js";

/** Adapter-owned classification and native text, copied before native resources disappear. */
export class RuntimeFailureError extends Error {
  constructor(readonly code: string, readonly category: RuntimeFailureV1["category"],
    readonly diagnostics: readonly string[] = [], options?: ErrorOptions) {super(code, options);}
}

const network = new Set(["CONTENT_IO_NETWORK_FAILED", "CONTENT_IO_TIMEOUT", "CONTENT_IO_PRELOAD_FAILED",
  "PLAYER_RESOURCE_IDLE_TIMEOUT", "PLAYER_RESOURCE_NETWORK_FAILED", "PLAYER_RUNTIME_LOADER_FAILED"]);
const storage = new Set(["CONTENT_IO_CACHE_UNAVAILABLE", "CONTENT_IO_WORKSPACE_UNAVAILABLE"]);
const content = new Set(["PLAYER_CONTENT_REJECTED", "CONTENT_IO_CHECKSUM_MISMATCH", "CONTENT_IO_IDENTITY_CHANGED",
  "CONTENT_IO_SIZE_MISMATCH", "CONTENT_IO_LIMIT_EXCEEDED"]);

export function createRuntimeFailure(code: string, error: unknown, phase: RuntimeFailureV1["phase"]): RuntimeFailureV1 {
  const category = classifyFailure(code, error);
  const diagnostics: {source: "CORE" | "RUNTIME"; message: string}[] = [];
  const append = (source: "CORE" | "RUNTIME", message: string) => {
    const sanitized = sanitizeDiagnostic(message);
    if (sanitized && diagnostics.length < 8 && !diagnostics.some(item => item.message === sanitized)) {
      diagnostics.push({source, message: sanitized});
    }
  };
  if (error instanceof RuntimeFailureError) {
    for (const message of error.diagnostics.slice(-8)) {append("CORE", message);}
  }
  let cause = error;
  const visited = new Set<unknown>();
  for (let depth = 0; cause != null && depth < 4 && !visited.has(cause); depth++) {
    visited.add(cause);
    // Error objects can originate in a separate iframe realm.
    if (typeof cause === "object" && "message" in cause && typeof cause.message === "string") {
      append("RUNTIME", cause.message);
      if ("stack" in cause && typeof cause.stack === "string") {
        for (const line of cause.stack.split("\n").slice(1, 5)) {append("RUNTIME", line);}
      }
      cause = "cause" in cause ? cause.cause : undefined;
    } else {if (typeof cause === "string") {append("RUNTIME", cause);} break;}
  }
  return {code: /^[A-Z][A-Z0-9_]{1,127}$/u.test(code) ? code : "RUNTIME_FAILED", phase, category,
    retryable: category === "NETWORK" && network.has(code), diagnostics};
}

function classifyFailure(code: string, error: unknown): RuntimeFailureV1["category"] {
  return error instanceof RuntimeFailureError ? error.category : network.has(code) ? "NETWORK" :
    storage.has(code) ? "STORAGE" : code === "PLAYER_RUNTIME_CSP_BLOCKED" ? "SECURITY" : content.has(code) ? "CONTENT" : "CORE";
}

export function sanitizeDiagnostic(value: string): string {
  return value.slice(-8000)
    .replace(/(?:https?|file|blob):[^\s<>"']+/giu, "[URL]")
    .replace(/(?:[A-Za-z]:\\|\/(?:home|Users|tmp|data|workspace|mnt)\/)[^\s<>"']+/gu, "[path]")
    .replace(/(?:authorization|cookie|password|token|secret|csrf)[=: \t]+[^\r\n]*/giu, "[redacted]")
    .split("").filter(character => "\n\r\t".includes(character) || character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join("")
    .trim().slice(-500);
}
