// Asyncify resumes outside callMain's synchronous try/catch. Observe failures
// inside the dedicated core iframe so a trapped engine cannot remain READY.
export function installCoreErrors(realm: Window, failed: (cause: unknown) => void, completedExit: () => boolean) {
  let reported = false;
  const report = (cause: unknown) => {if (!reported) {reported = true; failed(cause);}};
  const handle = (event: Event, cause: unknown) => {
    // Emscripten's Asyncify loop rejects with ExitStatus after onExit(0).
    // Only consume that control-flow exception during a requested shutdown.
    if (completedExit() && typeof cause === "object" && cause !== null &&
      "name" in cause && cause.name === "ExitStatus" && "status" in cause && cause.status === 0) {
      event.preventDefault(); return;
    }
    report(cause);
  };
  const error = (event: ErrorEvent) => {
    // Resource load failures are handled by the module loader, not engine traps.
    if (typeof event.message === "string") {handle(event, event.error ?? event.message);}
  };
  const rejection = (event: PromiseRejectionEvent) => handle(event, event.reason);
  realm.addEventListener("error", error);
  realm.addEventListener("unhandledrejection", rejection);
  return () => {
    realm.removeEventListener("error", error);
    realm.removeEventListener("unhandledrejection", rejection);
  };
}
