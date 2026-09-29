export type NativeReadyOptions = {
  loading?: {subscribe(listener: (busy: boolean, error?: Error) => void): () => void};
  signal?: AbortSignal;
};

/** Content I/O bounds each read; the engine deadline covers only time without reads. */
export function nativeReadyDeadline(options: NativeReadyOptions, fail: (error: Error) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let closed = false;
  const dispose = () => {
    if (closed) {return;}
    closed = true; clearTimeout(timer); unsubscribe?.();
    options.signal?.removeEventListener("abort", abort);
  };
  const finish = (error: Error) => {dispose(); fail(error);};
  const abort = () => finish(new DOMException("Aborted", "AbortError"));
  const changed = (busy: boolean, error?: Error) => {
    if (closed) {return;}
    if (error) {finish(error); return;}
    clearTimeout(timer);
    if (!busy) {timer = setTimeout(() => finish(new Error("RPG_RUNTIME_TIMEOUT")), 30_000);}
  };
  if (options.signal?.aborted) {abort(); return dispose;}
  options.signal?.addEventListener("abort", abort, {once: true});
  if (options.loading) {unsubscribe = options.loading.subscribe(changed);} else {changed(false);}
  if (closed) {unsubscribe?.();}
  return dispose;
}

/** Local activity only: no additional messages or capabilities cross the game frame. */
export class NativeContentActivity {
  private active = 0;
  private error?: Error;
  private readonly listeners = new Set<(busy: boolean, error?: Error) => void>();
  subscribe(listener: (busy: boolean, error?: Error) => void): () => void {
    this.listeners.add(listener); listener(this.active > 0, this.error);
    return () => {this.listeners.delete(listener);};
  }
  fail(error: Error): void {
    if (this.error) {return;}
    this.error = error;
    for (const listener of this.listeners) {listener(this.active > 0, error);}
  }
  begin(): () => void {
    this.active++;
    if (this.active === 1) {for (const listener of this.listeners) {listener(true);}}
    let finished = false;
    return () => {
      if (finished) {return;}
      finished = true; this.active--;
      if (!this.active) {for (const listener of this.listeners) {listener(false);}}
    };
  }
}
