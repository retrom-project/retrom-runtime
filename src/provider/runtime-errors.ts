import {PlayerRuntimeError} from "./errors.js";

/** Observe engine exceptions for the entire isolated frame lifetime. */
export function observeRuntimeErrors(realm: Window, failed: (error: PlayerRuntimeError) => void): () => void {
  const error = (event: ErrorEvent) => {
    if (isResizeDeliveryNotice(event, realm)) {return;}
    if (typeof event.message === "string") {failed(new PlayerRuntimeError("PLAYER_RUNTIME_FAILED", {cause: event.error ?? event.message}));}
  };
  const rejected = (event: PromiseRejectionEvent) => failed(new PlayerRuntimeError("PLAYER_RUNTIME_FAILED", {cause: event.reason}));
  const violation = (event: SecurityPolicyViolationEvent) => {
    if (event.disposition === "enforce" && ["eval", "wasm-eval"].includes(event.blockedURI)) {
      failed(new PlayerRuntimeError("PLAYER_RUNTIME_CSP_BLOCKED"));
    }
  };
  realm.addEventListener("error", error);
  realm.addEventListener("unhandledrejection", rejected);
  realm.document.addEventListener("securitypolicyviolation", violation);
  return () => {
    realm.removeEventListener("error", error);
    realm.removeEventListener("unhandledrejection", rejected);
    realm.document.removeEventListener("securitypolicyviolation", violation);
  };
}

function isResizeDeliveryNotice(event: ErrorEvent, realm: Window): boolean {
  // Resize Observer 3.4.6 specifies this message-only browser notification when
  // layout observations move to the next frame; it is not an engine exception.
  return event.message === "ResizeObserver loop completed with undelivered notifications." &&
    event.error == null && (event.filename === "" || event.filename === realm.location.href) &&
    event.lineno === 0 && event.colno === 0;
}
