import type {SaveFs} from "./bridge.js";

export type ScummvmModule = {FS: SaveFs & {mkdirTree(path: string): void; writeFile(path: string, bytes: Uint8Array | string): void};
  callMain(args: string[]): unknown};
export type ScummvmModuleLoader = (url: string, frameWindow: Window) => Promise<unknown>;
export type ScummvmFactory = {adapterAbi: string; createScummVM(options: Record<string, unknown>): Promise<ScummvmModule>};

export function validFactory(value: unknown): value is ScummvmFactory {
  return Boolean(value && typeof value === "object" && (value as ScummvmFactory).adapterAbi === "scummvm-host-v1" &&
    typeof (value as ScummvmFactory).createScummVM === "function");
}

export const loadScummvmModule: ScummvmModuleLoader = (url, frameWindow) => {
  if (frameWindow === window) {return import(/* webpackIgnore: true */ /* @vite-ignore */ url);}
  const registered = () => (frameWindow as unknown as {__RETROM_SCUMMVM_MODULE_V1__?: unknown}).__RETROM_SCUMMVM_MODULE_V1__;
  if (registered()) {return Promise.resolve(registered());}
  return new Promise((resolve, reject) => {
    const script = frameWindow.document.createElement("script");
    script.type = "module"; script.src = url;
    const timer = frameWindow.setTimeout(() => finish(new Error("SCUMMVM_CORE_LOAD_TIMEOUT")), 30_000);
    const finish = (error?: Error) => {
      frameWindow.clearTimeout(timer); script.remove();
      if (error) {reject(error);} else if (!registered()) {reject(new Error("SCUMMVM_CORE_ABI_MISMATCH"));}
      else {resolve(registered());}
    };
    script.addEventListener("load", () => finish(), {once: true});
    script.addEventListener("error", () => finish(new Error("SCUMMVM_CORE_LOAD_FAILED")), {once: true});
    frameWindow.document.head.append(script);
  });
};
