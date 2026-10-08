/** RetroArch retains the browser's request Promise without awaiting its rejection.
 * Own only this optional browser facility; engine exceptions remain fatal. */
export function ownEmulatorJsWakeLocks(realm: Window, unavailable: () => void): () => Promise<void> {
  const wakeLock = realm.navigator.wakeLock;
  if (!wakeLock?.request) {return async () => {};}
  const descriptor = Object.getOwnPropertyDescriptor(wakeLock, "request");
  const request = wakeLock.request;
  const held = new Set<WakeLockSentinel>();
  let stopped = false;
  const release = async (sentinel: WakeLockSentinel) => {
    held.delete(sentinel);
    if (sentinel.released) {return;}
    try {await sentinel.release();} catch {unavailable();}
  };
  const ownedRequest: WakeLock["request"] = function (type) {
    const pending = request.call(wakeLock, type);
    // Return the original Promise: callers still observe real success/rejection,
    // never a fabricated lock. The native enable path otherwise leaves it unhandled.
    void pending.then(sentinel => {
      if (stopped) {void release(sentinel);} else {held.add(sentinel);}
    }, unavailable);
    return pending;
  };
  Object.defineProperty(wakeLock, "request", {configurable: true, writable: true, value: ownedRequest});
  return async () => {
    if (stopped) {return;}
    stopped = true;
    if (wakeLock.request === ownedRequest) {
      if (descriptor) {Object.defineProperty(wakeLock, "request", descriptor);}
      else {Reflect.deleteProperty(wakeLock, "request");}
    }
    // A pending browser permission request must not block exit. Its fulfillment
    // observer releases any late grant after the frame has stopped.
    await Promise.all([...held].map(release));
  };
}
