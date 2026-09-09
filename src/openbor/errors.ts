// Asyncify resumes outside callMain's synchronous try/catch. Observe failures
// inside the dedicated core iframe so a trapped engine cannot remain READY.
export function installCoreErrors(realm: Window, failed: () => void) {
  let reported = false;
  const report = () => {if (!reported) {reported = true; failed();}};
  realm.addEventListener("error", report);
  realm.addEventListener("unhandledrejection", report);
  return () => {
    realm.removeEventListener("error", report);
    realm.removeEventListener("unhandledrejection", report);
  };
}
