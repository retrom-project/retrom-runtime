import type { CheckpointAvailability } from "../contract.js";
import type { MountedRuntimeAdapter, RuntimeProgressReporter } from "../internal-adapter.js";
import type {Wasm4Parameters} from "./parameters.js";

type Wasm4CoreInstance = {
  canvas: HTMLCanvasElement;
  checkpoint(): Uint8Array;
  frameCount(): number;
  pause(): Promise<void>;
  resume(): Promise<void>;
  screenshot(): Promise<Blob>;
  stop(): Promise<void>;
};

export type Wasm4CoreModule = {
  RETROM_WASM4_ADAPTER_ABI: string;
  RETROM_WASM4_CHECKPOINT_MAX_BYTES: number;
  createRetromWasm4(options: {
    cartBytes: Uint8Array;
    contentDigest: string;
    restorePayload: Uint8Array | null;
    target: HTMLElement;
  }): Promise<unknown>;
};

export type Wasm4ModuleLoader = (url: string, frameWindow: Window) => Promise<unknown>;
export type Wasm4CartHasher = (bytes: Uint8Array) => Promise<string>;

const adapterAbi = "wasm4-state-v1";
const checkpointFormat = "wasm4-state-v1";
const maximumCheckpointBytes = 132144;
const frameModuleRegistration = "__RETROM_WASM4_CORE_MODULE_V1__";

export async function mountWasm4(
  config: Wasm4Parameters,
  target: HTMLElement,
  frameWindow: Window,
  restorePayload: Uint8Array | null,
  reportProgress: RuntimeProgressReporter = () => undefined,
  loadModule: Wasm4ModuleLoader = defaultModuleLoader,
  hashCart: Wasm4CartHasher = sha256,
): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document || restorePayload &&
    (restorePayload.byteLength < 1 || restorePayload.byteLength > maximumCheckpointBytes)) {
    throw new Error("WASM4_RUNTIME_CONFIG_INVALID");
  }
  const cartBytes = await fetchCart(config, reportProgress, hashCart);
  const runtimeBaseUrl = new URL(normalizedBase(config.runtimeBaseUrl), window.location.href);
  const moduleUrl = new URL("wasm4-retrom.mjs", runtimeBaseUrl).href;
  let module: unknown;
  try {
    module = await loadModule(moduleUrl, frameWindow);
  } catch (error) {
    console.error("[wasm4] core module load failed", error);
    throw stableError(error);
  }
  if (!validCoreModule(module)) {throw new Error("WASM4_CORE_ABI_MISMATCH");}

  let instance: Wasm4CoreInstance;
  try {
    const created = await module.createRetromWasm4({
      cartBytes: cartBytes.slice(),
      contentDigest: config.contentDigest,
      restorePayload: restorePayload?.slice() ?? null,
      target,
    });
    if (!validCoreInstance(created, frameWindow)) {
      throw new Error("WASM4_CORE_ABI_MISMATCH");
    }
    instance = created;
  } catch (error) {
    target.replaceChildren();
    throw stableError(error);
  }

  let exited = false;
  return {
    checkpoint: async () => {
      if (exited) {throw new Error("WASM4_RUNTIME_INVALID_STATE");}
      const raw = instance.checkpoint();
      if (!isUint8Array(raw) || raw.byteLength < 1 || raw.byteLength > maximumCheckpointBytes) {
        throw new Error("WASM4_CHECKPOINT_CREATE_FAILED");
      }
      const bytes = new Uint8Array(raw.byteLength);
      bytes.set(raw);
      return {bytes, format: checkpointFormat};
    },
    exit: async () => {
      if (exited) {return;}
      exited = true;
      await instance.stop();
    },
    getCanvas: () => exited ? null : instance.canvas,
    getCheckpointAvailability: (): CheckpointAvailability => exited
      ? {available: false, blocker: "NOT_READY"}
      : {available: true, blocker: null},
    getFrameCount: () => {
      const value = instance.frameCount();
      return Number.isSafeInteger(value) && value >= 0 ? value : null;
    },
    pause: async () => {
      if (exited) {throw new Error("WASM4_RUNTIME_INVALID_STATE");}
      await instance.pause();
    },
    resume: async () => {
      if (exited) {throw new Error("WASM4_RUNTIME_INVALID_STATE");}
      await instance.resume();
    },
    screenshot: async () => {
      if (exited) {throw new Error("WASM4_RUNTIME_INVALID_STATE");}
      const blob = await instance.screenshot();
      if (!isBlob(blob) || !blob.size) {throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");}
      return new Blob([await blob.arrayBuffer()], {type: blob.type});
    },
    setVolume: null,
  };
}

async function fetchCart(
  config: Wasm4Parameters,
  reportProgress: RuntimeProgressReporter,
  hashCart: Wasm4CartHasher,
) {
  const response = await fetch(config.cartUrl, {credentials: "same-origin"});
  if (!response.ok) {throw new Error("WASM4_CART_FETCH_FAILED");}
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) !== config.cartSizeBytes) {
    throw new Error("WASM4_CART_SIZE_MISMATCH");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== config.cartSizeBytes || bytes.byteLength > 1 << 16) {
    throw new Error("WASM4_CART_SIZE_MISMATCH");
  }
  if (await hashCart(bytes) !== config.contentDigest) {throw new Error("WASM4_CART_DIGEST_MISMATCH");}
  reportProgress({loadedBytes: bytes.byteLength, phase: "PROJECT_CONTENT", totalBytes: bytes.byteLength});
  return bytes;
}

async function sha256(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function validCoreModule(value: unknown): value is Wasm4CoreModule {
  if (!value || typeof value !== "object") {return false;}
  const module = value as Partial<Wasm4CoreModule>;
  return module.RETROM_WASM4_ADAPTER_ABI === adapterAbi &&
    module.RETROM_WASM4_CHECKPOINT_MAX_BYTES === maximumCheckpointBytes &&
    typeof module.createRetromWasm4 === "function";
}

function validCoreInstance(value: unknown, frameWindow: Window): value is Wasm4CoreInstance {
  if (!value || typeof value !== "object") {return false;}
  const instance = value as Partial<Wasm4CoreInstance>;
  const CanvasConstructor = (frameWindow as unknown as typeof globalThis).HTMLCanvasElement;
  return instance.canvas instanceof CanvasConstructor && [
    instance.checkpoint, instance.frameCount, instance.pause, instance.resume,
    instance.screenshot, instance.stop,
  ].every((method) => typeof method === "function");
}

function normalizedBase(value: string) {return value.endsWith("/") ? value : `${value}/`;}

function defaultModuleLoader(url: string, frameWindow: Window) {
  if (frameWindow === window) {
    return import(/* webpackIgnore: true */ /* @vite-ignore */ url) as Promise<unknown>;
  }
  const frameGlobal = frameWindow as unknown as Record<string, unknown>;
  const registered = frameGlobal[frameModuleRegistration];
  if (registered) {return Promise.resolve(registered);}
  return new Promise<unknown>((resolve, reject) => {
    const script = frameWindow.document.createElement("script");
    script.type = "module";
    script.src = url;
    let timeout = 0;
    const finish = (error: Error | null) => {
      frameWindow.clearTimeout(timeout);
      script.remove();
      const module = frameGlobal[frameModuleRegistration];
      if (error) {reject(error); return;}
      if (!module) {reject(new Error("WASM4_CORE_ABI_MISMATCH")); return;}
      resolve(module);
    };
    timeout = frameWindow.setTimeout(() => finish(new Error("WASM4_CORE_LOAD_TIMEOUT")), 15_000);
    script.addEventListener("load", () => finish(null), {once: true});
    script.addEventListener("error", () => finish(new Error("WASM4_CORE_LOAD_FAILED")), {once: true});
    (frameWindow.document.head ?? frameWindow.document.documentElement).append(script);
  });
}

function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Uint8Array]";
}

function isBlob(value: unknown): value is Blob {
  if (!value || typeof value !== "object") {return false;}
  const blob = value as Partial<Blob>;
  return Number.isSafeInteger(blob.size) && (blob.size ?? -1) >= 0 && typeof blob.type === "string" &&
    typeof blob.arrayBuffer === "function";
}

function stableError(error: unknown) {
  const message = error && typeof error === "object" && "message" in error
    ? (error as {message?: unknown}).message
    : null;
  return typeof message === "string" && /^WASM4_[A-Z0-9_]+$/u.test(message)
    ? new Error(message)
    : new Error("WASM4_RUNTIME_FAILED");
}
