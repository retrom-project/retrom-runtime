export type RuffleAPI = {
  readonly hostAbi: string;
  readonly readyState: number;
  load(options: Record<string, unknown>): Promise<void>;
  suspend(): void;
  resume(): void;
  getCanvas(): HTMLCanvasElement | null;
  captureFrame(): Promise<Blob>;
  destroy(): void;
  volume: number;
};
export type RufflePlayer = HTMLElement & {ruffle(): RuffleAPI};
export type RuffleLoader = (base: string, frameWindow: Window, signal?: AbortSignal) => Promise<RufflePlayer>;
type RuffleGlobal = {config?: Record<string, unknown>; newest(): {createPlayer(): RufflePlayer}};

export const loadRuffle: RuffleLoader = async (base, frameWindow, signal) => {
  const realm = frameWindow as Window & {RufflePlayer?: RuffleGlobal};
  if (realm.RufflePlayer) {throw new Error("RUFFLE_FRAME_ALREADY_USED");}
  Object.assign(realm, {RufflePlayer: {config: {polyfills: false, publicPath: base}}});
  const script = frameWindow.document.createElement("script");
  script.src = new URL("ruffle.js", base).href;
  try {
    await new Promise<void>((resolve, reject) => {
      let timer = 0;
      const finish = (error?: Error) => {
        frameWindow.clearTimeout(timer); signal?.removeEventListener("abort", aborted);
        script.onload = null; script.onerror = null;
        if (error) {reject(error);} else {resolve();}
      };
      const aborted = () => finish(new DOMException("Aborted", "AbortError"));
      script.onload = () => finish(); script.onerror = () => finish(new Error("RUFFLE_CORE_LOAD_FAILED"));
      timer = frameWindow.setTimeout(() => finish(new Error("RUFFLE_CORE_LOAD_TIMEOUT")), 30_000);
      signal?.addEventListener("abort", aborted, {once: true});
      if (signal?.aborted) {aborted(); return;}
      frameWindow.document.head.append(script);
    });
    signal?.throwIfAborted();
    const loaded = (frameWindow as Window & {RufflePlayer?: RuffleGlobal}).RufflePlayer;
    if (typeof loaded?.newest !== "function") {throw new Error("RUFFLE_CORE_ABI_MISMATCH");}
    return loaded.newest().createPlayer();
  } finally {script.remove();}
};

export async function waitReady(api: RuffleAPI, signal?: AbortSignal) {
  const deadline = performance.now() + 45_000;
  while (api.readyState !== 2) {
    signal?.throwIfAborted();
    if (performance.now() >= deadline) {throw new Error("RUFFLE_START_TIMEOUT");}
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  signal?.throwIfAborted();
}

export async function boundedLoad(load: Promise<void>, signal?: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted: (() => void) | undefined;
  try {
    await Promise.race([load, new Promise<never>((_, reject) => {
      aborted = () => reject(new DOMException("Aborted", "AbortError"));
      timer = setTimeout(() => reject(new Error("RUFFLE_START_TIMEOUT")), 60_000);
      signal?.addEventListener("abort", aborted, {once: true});
      if (signal?.aborted) {aborted();}
    })]);
    signal?.throwIfAborted();
  } finally {
    clearTimeout(timer);
    if (aborted) {signal?.removeEventListener("abort", aborted);}
  }
}
