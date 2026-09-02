export type StartBarrier = {
  promise: Promise<void>;
  reject(error: Error): void;
  resolve(): void;
};

export function startWhenAvailable(runtimeWindow: Window) {
  const click = () => {
    const button = runtimeWindow.document.querySelector<HTMLElement>(".ejs_start_button");
    button?.click();
    return Boolean(button);
  };
  if (click()) {return () => undefined;}
  const Observer = runtimeWindow.document.defaultView?.MutationObserver;
  if (!Observer) {throw new Error("PLAYER_DOS_START_UNAVAILABLE");}
  let timeout = 0;
  const observer = new Observer(() => {
    if (!click()) {return;}
    observer.disconnect();
    runtimeWindow.clearTimeout(timeout);
  });
  observer.observe(runtimeWindow.document.documentElement, {childList: true, subtree: true});
  timeout = runtimeWindow.setTimeout(() => {
    observer.disconnect();
    runtimeWindow.dispatchEvent(new ErrorEvent("error", {error: new Error("PLAYER_DOS_START_UNAVAILABLE")}));
  }, 30_000);
  return () => {observer.disconnect(); runtimeWindow.clearTimeout(timeout);};
}

export function createStartBarrier(): StartBarrier {
  let rejectPromise: (error: Error) => void = () => undefined;
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });
  return {promise, reject: rejectPromise, resolve: resolvePromise};
}
