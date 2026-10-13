/** Native initialization excludes time spent waiting for bounded Content I/O reads. */
export function waitForOnsEngine(initialized: Promise<void>, ready: () => boolean,
  reading: () => boolean, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let announced = false, idleMs = 0, previous = Date.now(), finished = false;
    const finish = (error?: unknown) => {
      if (finished) {return;}
      finished = true; clearInterval(timer); signal?.removeEventListener("abort", abort);
      if (error !== undefined) {reject(error);} else {resolve();}
    };
    const abort = () => finish(signal?.reason ?? new Error("ONS_RUNTIME_ABORTED"));
    const tick = () => {
      const now = Date.now();
      if (!reading()) {idleMs += now - previous;}
      previous = now;
      try {
        if (announced && ready()) {finish();}
        else if (idleMs >= 30_000) {finish(new Error("ONS_RUNTIME_TIMEOUT"));}
      } catch (error) {finish(error);}
    };
    const timer = setInterval(tick, 10);
    initialized.then(() => {announced = true;}, finish);
    signal?.addEventListener("abort", abort, {once: true});
    if (signal?.aborted) {abort();}
  });
}
