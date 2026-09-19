import {ContentIOError, fail} from "./errors.js";
export function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) {throw abortError(signal);}
}
export function abortError(signal: AbortSignal): ContentIOError {
  return signal.reason instanceof ContentIOError ? signal.reason : new ContentIOError("ABORTED", {cause: signal.reason});
}
export function requestScope(signal: AbortSignal | undefined, timeoutMs: number) {
  checkSignal(signal);
  if (!(timeoutMs > 0) || !Number.isFinite(timeoutMs)) {fail("TIMEOUT");}
  const controller = new AbortController();
  const aborted = () => controller.abort(signal ? abortError(signal) : new ContentIOError("ABORTED"));
  signal?.addEventListener("abort", aborted, {once: true});
  const timer = setTimeout(() => controller.abort(new ContentIOError("TIMEOUT")), timeoutMs);
  return {signal: controller.signal, dispose() {clearTimeout(timer); signal?.removeEventListener("abort", aborted);}};
}
export async function abortable<Value>(operation: Promise<Value>, signal?: AbortSignal): Promise<Value> {
  checkSignal(signal);
  if (!signal) {return operation;}
  let abort: () => void = () => {};
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      abort = () => reject(abortError(signal));
      signal.addEventListener("abort", abort, {once: true});
      if (signal.aborted) {abort();}
    })]);
  } finally {signal.removeEventListener("abort", abort);}
}
export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {await abortable(new Promise<void>((resolve) => {timer = setTimeout(resolve, ms);}), signal);}
  finally {clearTimeout(timer);}
}

export function combineSignals(signals: readonly AbortSignal[]) {
  const controller = new AbortController();
  const listeners = signals.map((signal) => {
    const abort = () => controller.abort(abortError(signal));
    signal.addEventListener("abort", abort, {once: true});
    if (signal.aborted) {abort();}
    return () => signal.removeEventListener("abort", abort);
  });
  return {signal: controller.signal, dispose: () => {for (const remove of listeners) {remove();}}};
}
