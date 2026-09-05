const statePath = "/game.state";
const stackMarker = Uint8Array.of(
  0x23, 0x0c, 0x45, 0x04, 0x40, 0x20, 0x01, 0x41, 0xc0, 0x02,
  0x6a, 0x24, 0x00, 0x20, 0x01, 0x41, 0x10, 0x6a, 0x0f,
);
const linkedStackHigh = Uint8Array.of(0xf0, 0xec, 0x80, 0x0e);
const compatibleStackHigh = Uint8Array.of(0xf0, 0xec, 0x80, 0x2c);

type DOSModule = {
  HEAPU8?: Uint8Array;
  UTF8ToString?: (pointer: number) => string;
  _free?: (pointer: number) => void;
  _save_state_info?: () => number;
};
type DOSManager = {
  Module?: DOSModule;
  FS?: {unlink: (path: string) => void; writeFile: (path: string, bytes: Uint8Array) => void};
  clearEJSResetTimer?: () => void;
  functions?: {loadState?: (path: string, slot: number) => unknown};
  getState?: () => Uint8Array;
  loadExplicitStateAndWait?: (state: Uint8Array, timeoutMs?: number) => Promise<void>;
  toggleMainLoop?: (running: boolean) => void;
};
type ManagerConstructor = {prototype?: DOSManager};
type RuntimeConfig = {
  postMainLoop?: (...args: unknown[]) => void;
  print?: (...args: unknown[]) => void;
  printErr?: (...args: unknown[]) => void;
  [name: string]: unknown;
};
type RuntimeFactory = ((config: RuntimeConfig) => unknown) & {retromDOSBoxStateHook?: boolean};
type DOSWindow = Window & {
  EJS_GameManager?: ManagerConstructor;
  EJS_Runtime?: RuntimeFactory;
  WebAssembly: typeof WebAssembly;
};
type Signal = {reject: (error: Error) => void; resolve: () => void; timer: number};

export function patchDOSBoxPureStateStack(source: BufferSource) {
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  const markers = matchingOffsets(view, stackMarker);
  if (!markers.length) {return null;}
  const highOffsets = matchingOffsets(view, linkedStackHigh);
  if (markers.length !== 1 || highOffsets.length !== 2) {
    throw new Error("PLAYER_DOS_STATE_COMPATIBILITY_UNAVAILABLE");
  }
  const patched = view.slice();
  for (const offset of highOffsets) {patched.set(compatibleStackHigh, offset);}
  if (!WebAssembly.validate(patched)) {throw new Error("PLAYER_DOS_STATE_COMPATIBILITY_UNAVAILABLE");}
  return patched;
}

export function readDOSBoxPureState(module: DOSModule) {
  const heap = module.HEAPU8;
  if (!heap || typeof module.UTF8ToString !== "function" || typeof module._free !== "function" ||
    typeof module._save_state_info !== "function") {
    throw new Error("PLAYER_DOS_STATE_COMPATIBILITY_UNAVAILABLE");
  }
  const info = module._save_state_info();
  if (!Number.isSafeInteger(info) || info <= 0 || info >= heap.byteLength) {
    throw new Error("PLAYER_STATE_UNAVAILABLE");
  }
  const [rawSize, rawStart, succeeded] = module.UTF8ToString(info).split("|");
  const size = Number.parseInt(rawSize ?? "", 10);
  const start = Number.parseInt(rawStart ?? "", 10);
  if (succeeded !== "1" || !Number.isSafeInteger(size) || size <= 0 ||
    !Number.isSafeInteger(start) || start < 0 || start + size > heap.byteLength) {
    throw new Error("PLAYER_STATE_UNAVAILABLE");
  }
  const state = heap.slice(start, start + size);
  module._free(start);
  return state;
}

export function installDOSBoxPureStateCompatibility(playerWindow: Window = window) {
  const target = playerWindow as DOSWindow;
  const instantiateDescriptor = target.WebAssembly.instantiate;
  const streamingDescriptor = target.WebAssembly.instantiateStreaming;
  const originalInstantiate = instantiateDescriptor.bind(target.WebAssembly);
  const originalStreaming = streamingDescriptor?.bind(target.WebAssembly);
  const managerDescriptor = Object.getOwnPropertyDescriptor(target, "EJS_GameManager");
  const runtimeDescriptor = Object.getOwnPropertyDescriptor(target, "EJS_Runtime");
  if (managerDescriptor && !managerDescriptor.configurable || runtimeDescriptor && !runtimeDescriptor.configurable) {
    throw new Error("PLAYER_DOS_STATE_COMPATIBILITY_UNAVAILABLE");
  }
  let active = true;
  let artifactPatched = false;
  let managerConstructor = target.EJS_GameManager;
  let runtimeFactory = target.EJS_Runtime;
  const loadSignals: Signal[] = [];
  const loopSignals: Signal[] = [];
  const delaySignals = new Set<Signal>();
  const patchedPrototypes = new Map<DOSManager, {
    getState?: PropertyDescriptor; loadExplicitStateAndWait?: PropertyDescriptor;
  }>();

  const signal = (collection: Signal[] | Set<Signal>, timeoutMs: number, code: string) => {
    let pending!: Signal;
    const promise = new Promise<void>((resolve, reject) => {
      pending = {reject, resolve, timer: target.setTimeout(() => finish(collection, pending, new Error(code)), timeoutMs)};
      if (Array.isArray(collection)) {collection.push(pending);} else {collection.add(pending);}
    });
    return {cancel: () => finish(collection, pending), promise};
  };
  const finish = (collection: Signal[] | Set<Signal>, pending: Signal, error?: Error) => {
    const present = Array.isArray(collection)
      ? (() => {const index = collection.indexOf(pending); if (index < 0) {return false;} collection.splice(index, 1); return true;})()
      : collection.delete(pending);
    if (!present) {return;}
    target.clearTimeout(pending.timer);
    if (error) {pending.reject(error);} else {pending.resolve();}
  };
  const delay = (milliseconds: number) => signal(delaySignals, milliseconds, "PLAYER_SESSION_ENDED").promise
    .catch((error: unknown) => {
      if (active) {return;}
      throw error;
    });
  const observeNativeLog = (args: unknown[]) => {
    const message = args.map(String).join(" ");
    if (!message.includes("[State]") || !message.includes("game.state")) {return;}
    const pending = loadSignals[0];
    if (!pending) {return;}
    if (/failed/iu.test(message)) {
      target.queueMicrotask(() => finish(loadSignals, pending, new Error("PLAYER_SAVE_STATE_RESTORE_FAILED")));
    } else if (/loading state/iu.test(message)) {
      target.queueMicrotask(() => finish(loadSignals, pending));
    }
  };
  const patchManager = (constructor: ManagerConstructor | undefined) => {
    const prototype = constructor?.prototype;
    if (!prototype || patchedPrototypes.has(prototype) || !artifactPatched) {return;}
    patchedPrototypes.set(prototype, {
      getState: Object.getOwnPropertyDescriptor(prototype, "getState"),
      loadExplicitStateAndWait: Object.getOwnPropertyDescriptor(prototype, "loadExplicitStateAndWait"),
    });
    prototype.getState = function () {return readDOSBoxPureState(this.Module ?? {});};
    prototype.loadExplicitStateAndWait = async function (state: Uint8Array, timeoutMs = 30_000) {
      coreStatePayload(state);
      const fileSystem = this.FS;
      const loadState = this.functions?.loadState;
      if (!fileSystem || !this.toggleMainLoop || typeof loadState !== "function") {
        throw new Error("PLAYER_DOS_STATE_COMPATIBILITY_UNAVAILABLE");
      }
      const deadline = target.performance.now() + timeoutMs;
      while (active) {
        try {if (this.getState?.().byteLength) {break;}} catch { /* not serializable yet */ }
        if (target.performance.now() >= deadline) {throw new Error("PLAYER_SAVE_STATE_RESTORE_TIMEOUT");}
        this.toggleMainLoop(true);
        await delay(Math.min(50, Math.max(1, deadline - target.performance.now())));
      }
      if (!active) {throw new Error("PLAYER_SESSION_ENDED");}
      this.toggleMainLoop(false);
      await delay(50);
      try {
        try {fileSystem.unlink(statePath);} catch { /* absent */ }
        fileSystem.writeFile(statePath, new Uint8Array(state));
        const remaining = () => Math.max(1, deadline - target.performance.now());
        const loaded = signal(loadSignals, remaining(), "PLAYER_SAVE_STATE_RESTORE_TIMEOUT");
        const looped = signal(loopSignals, remaining(), "PLAYER_SAVE_STATE_RESTORE_TIMEOUT");
        try {
          this.clearEJSResetTimer?.();
          loadState.call(this.functions, statePath, 0);
          this.toggleMainLoop(true);
          await Promise.all([loaded.promise, looped.promise]);
          this.toggleMainLoop(false);
          coreStatePayload(this.getState?.() ?? new Uint8Array());
        } finally {
          loaded.cancel(); looped.cancel(); this.toggleMainLoop(false);
        }
      } finally {
        this.toggleMainLoop(false);
        try {fileSystem.unlink(statePath);} catch { /* native code may remove it */ }
      }
    };
  };

  const wrapRuntime = (factory: RuntimeFactory | undefined) => {
    if (typeof factory !== "function") {throw new Error("PLAYER_DOS_STATE_COMPATIBILITY_UNAVAILABLE");}
    if (factory.retromDOSBoxStateHook) {return factory;}
    const wrapped = function (this: unknown, config: RuntimeConfig) {
      return Reflect.apply(factory, this, [{
        ...config,
        postMainLoop: (...args: unknown[]) => {
          config?.postMainLoop?.(...args);
          const pending = loopSignals[0];
          if (pending) {finish(loopSignals, pending);}
        },
        print: (...args: unknown[]) => {config?.print?.(...args); observeNativeLog(args);},
        printErr: (...args: unknown[]) => {config?.printErr?.(...args); observeNativeLog(args);},
      }]);
    } as RuntimeFactory;
    Object.defineProperty(wrapped, "retromDOSBoxStateHook", {value: true});
    return wrapped;
  };

  target.WebAssembly.instantiate = (async (source: BufferSource | WebAssembly.Module, imports?: WebAssembly.Imports) => {
    if (source instanceof target.WebAssembly.Module) {return originalInstantiate(source, imports);}
    const patched = patchDOSBoxPureStateStack(source);
    if (!patched) {return originalInstantiate(source, imports);}
    artifactPatched = true;
    patchManager(managerConstructor);
    return originalInstantiate(patched, imports);
  }) as typeof WebAssembly.instantiate;
  if (originalStreaming) {
    target.WebAssembly.instantiateStreaming = async (source, imports) => {
      const response = await source;
      const patched = patchDOSBoxPureStateStack(await response.clone().arrayBuffer());
      if (!patched) {return originalStreaming(response, imports);}
      artifactPatched = true;
      patchManager(managerConstructor);
      return originalInstantiate(patched, imports) as Promise<WebAssembly.WebAssemblyInstantiatedSource>;
    };
  }
  Object.defineProperty(target, "EJS_GameManager", {
    configurable: true,
    enumerable: managerDescriptor?.enumerable ?? true,
    get: () => managerConstructor,
    set: (constructor: ManagerConstructor | undefined) => {patchManager(constructor); managerConstructor = constructor;},
  });
  if (runtimeFactory) {runtimeFactory = wrapRuntime(runtimeFactory);}
  Object.defineProperty(target, "EJS_Runtime", {
    configurable: true,
    enumerable: runtimeDescriptor?.enumerable ?? true,
    get: () => runtimeFactory,
    set: (factory: RuntimeFactory | undefined) => {runtimeFactory = wrapRuntime(factory);},
  });

  const cleanup = () => {
    if (!active) {return;}
    active = false;
    target.WebAssembly.instantiate = instantiateDescriptor;
    if (streamingDescriptor) {target.WebAssembly.instantiateStreaming = streamingDescriptor;}
    for (const [prototype, descriptors] of patchedPrototypes) {
      restoreDescriptor(prototype, "getState", descriptors.getState);
      restoreDescriptor(prototype, "loadExplicitStateAndWait", descriptors.loadExplicitStateAndWait);
    }
    restoreDescriptor(target, "EJS_GameManager", managerDescriptor);
    restoreDescriptor(target, "EJS_Runtime", runtimeDescriptor);
    for (const pending of [...delaySignals]) {finish(delaySignals, pending, new Error("PLAYER_SESSION_ENDED"));}
    for (const pending of [...loadSignals]) {finish(loadSignals, pending, new Error("PLAYER_SESSION_ENDED"));}
    for (const pending of [...loopSignals]) {finish(loopSignals, pending, new Error("PLAYER_SESSION_ENDED"));}
  };
  return {
    cleanup,
    prepare(instance: {gameManager?: object}) {
      const manager = instance.gameManager;
      const prototype = manager ? Object.getPrototypeOf(manager) as DOSManager | null : null;
      if (!prototype) {throw new Error("PLAYER_DOS_STATE_COMPATIBILITY_UNAVAILABLE");}
      patchManager({prototype});
    },
  };
}

function matchingOffsets(bytes: Uint8Array, pattern: Uint8Array) {
  const offsets: number[] = [];
  for (let at = 0; at <= bytes.byteLength - pattern.byteLength; at += 1) {
    if (pattern.every((value, offset) => bytes[at + offset] === value)) {offsets.push(at);}
  }
  return offsets;
}

function coreStatePayload(state: Uint8Array) {
  if (new TextDecoder().decode(state.subarray(0, 7)) !== "RASTATE" || state[7] !== 1) {
    throw new Error("PLAYER_STATE_UNAVAILABLE");
  }
  const view = new DataView(state.buffer, state.byteOffset, state.byteLength);
  for (let offset = 8; offset + 8 <= state.byteLength;) {
    const marker = new TextDecoder().decode(state.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    if (end > state.byteLength) {break;}
    if (marker === "MEM ") {return state.subarray(start, end);}
    if (marker === "END ") {break;}
    offset = start + (size + 7 & ~7);
  }
  throw new Error("PLAYER_STATE_UNAVAILABLE");
}

function restoreDescriptor(target: object, key: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {Object.defineProperty(target, key, descriptor);} else {Reflect.deleteProperty(target, key);}
}
