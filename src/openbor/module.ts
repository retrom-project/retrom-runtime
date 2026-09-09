export type SaveFS = {
  mkdirTree(path: string): void;
  writeFile(path: string, bytes: Uint8Array): void;
  readFile(path: string): Uint8Array;
  readdir(path: string): string[];
  stat(path: string): {size: number; mode: number};
  isFile(mode: number): boolean;
};
export type OpenBOR = {
  FS: SaveFS; retromAbi: string; retromFrames: number; retromKeys: number[]; retromStopped: boolean;
  retromStop(): void; retromDispose(): Promise<void>;
  retromSetPaused(paused: boolean): Promise<void>;
  callMain(args: string[]): unknown;
};
export type Factory = (options: Record<string, unknown>) => Promise<OpenBOR>;
export async function loadModule(url: string, realm: Window, signal?: AbortSignal): Promise<Factory> {
  const registered = () => (realm as Window & {__RETROM_OPENBOR_MODULE_V1__?: Factory}).__RETROM_OPENBOR_MODULE_V1__;
  await new Promise<void>((resolve, reject) => {
    const script = realm.document.createElement("script");
    script.type = "module"; script.src = url;
    const finish = (error?: Error) => {
      realm.clearTimeout(timer); signal?.removeEventListener("abort", aborted); script.remove();
      if (error) {reject(error);} else {resolve();}
    };
    const aborted = () => finish(new DOMException("Aborted", "AbortError"));
    const timer = realm.setTimeout(() => finish(new Error("OPENBOR_CORE_LOAD_TIMEOUT")), 30_000);
    script.onload = () => finish(); script.onerror = () => finish(new Error("OPENBOR_CORE_LOAD_FAILED"));
    signal?.addEventListener("abort", aborted, {once: true});
    if (signal?.aborted) {aborted();} else {realm.document.head.append(script);}
  });
  const factory = registered();
  if (typeof factory !== "function") {throw new Error("OPENBOR_CORE_ABI_MISMATCH");}
  return factory;
}
