// Asyncify resumes outside callMain's synchronous try/catch. Observe failures
// inside the dedicated core iframe so a trapped engine cannot remain READY.
export function installCoreErrors(realm: Window, failed: (cause: unknown) => void) {
  let reported = false;
  const report = (cause: unknown) => {if (!reported) {reported = true; failed(cause);}};
  const error = (event: ErrorEvent) => {
    // Resource load failures are handled by the module loader, not engine traps.
    if (typeof event.message === "string") {report(event.error ?? event.message);}
  };
  const rejection = (event: PromiseRejectionEvent) => report(event.reason);
  realm.addEventListener("error", error);
  realm.addEventListener("unhandledrejection", rejection);
  return () => {
    realm.removeEventListener("error", error);
    realm.removeEventListener("unhandledrejection", rejection);
  };
}
