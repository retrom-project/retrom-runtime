import type {StartupDeadline, StartupTransfer} from "./startup-deadline.js";
import type {StartupTasks, StartupTask} from "./startup.js";

type NetworkWindow = Window & {XMLHttpRequest: typeof XMLHttpRequest; fetch: typeof fetch};

/** Observe actual transport bytes, including responses without a Content-Length. */
export function observeStartupNetwork(frame: Window, deadline: StartupDeadline, tasks?: StartupTasks): (abort: boolean) => void {
  const runtimeWindow = frame as NetworkWindow;
  const controller = new AbortController(), cleanups: Array<() => void> = [];
  const requests = new Set<XMLHttpRequest>();
  const prototype = runtimeWindow.XMLHttpRequest.prototype, send = prototype.send;
  const observedSend: typeof send = function(this: XMLHttpRequest, body) {
    const transfer = deadline.transfer();
    requests.add(this);
    const progress = (event: ProgressEvent) => transfer.progress(event.loaded);
    const failed = () => transfer.fail();
    const finished = () => {transfer.complete(); requests.delete(this); unwatch();};
    const unwatch = () => {
      this.removeEventListener("progress", progress); this.removeEventListener("error", failed);
      this.removeEventListener("timeout", failed); this.removeEventListener("loadend", finished);
    };
    this.addEventListener("progress", progress); this.addEventListener("error", failed);
    this.addEventListener("timeout", failed); this.addEventListener("loadend", finished);
    cleanups.push(unwatch);
    try {send.call(this, body);} catch (error) {finished(); transfer.fail(error); throw error;}
  };
  prototype.send = observedSend;
  const fetch = runtimeWindow.fetch;
  const observedFetch: typeof fetch = async (input, init) => {
    const transfer = deadline.transfer(), task = tasks?.begin("CORE_ASSETS");
    try {
      const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : null);
      const signal = requestSignal ? AbortSignal.any([requestSignal, controller.signal]) : controller.signal;
      const response = await fetch.call(runtimeWindow, input, {...init, signal});
      // Optional upstream resources can return 404 and fall back locally.
      // Preserve HTTP semantics; the consumer decides whether the status is fatal.
      if (!response.ok) {transfer.complete(); task?.fail(); return response;}
      return observeResponse(response, transfer, task);
    } catch (error) {task?.fail(); transfer.fail(error); throw error;}
  };
  runtimeWindow.fetch = observedFetch;
  return abort => {
    if (prototype.send === observedSend) {prototype.send = send;}
    if (runtimeWindow.fetch === observedFetch) {runtimeWindow.fetch = fetch;}
    if (abort) {controller.abort(); for (const request of requests) {request.abort();}}
    for (const cleanup of cleanups) {cleanup();}
    requests.clear();
  };
}

function observeResponse(response: Response, transfer: StartupTransfer, task: StartupTask | undefined): Response {
  if (!response.body) {transfer.complete(); task?.complete(); return response;}
  const reader = response.body.getReader();
  const length = Number(response.headers.get("Content-Length"));
  const total = Number.isSafeInteger(length) && length > 0 ? length : null;
  let loaded = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {transfer.complete(); task?.complete(); reader.releaseLock(); controller.close(); return;}
        loaded += chunk.value.byteLength; transfer.progress(loaded); task?.progress(loaded, total && loaded <= total ? total : null);
        controller.enqueue(chunk.value);
      } catch (error) {task?.fail(); transfer.fail(error); reader.releaseLock(); controller.error(error);}
    },
    async cancel(reason) {await reader.cancel(reason); reader.releaseLock(); task?.fail(); transfer.complete();},
  });
  const observed = new Response(stream, {status: response.status, statusText: response.statusText, headers: response.headers});
  for (const key of ["url", "redirected", "type"] as const) {Object.defineProperty(observed, key, {value: response[key]});}
  return observed;
}
