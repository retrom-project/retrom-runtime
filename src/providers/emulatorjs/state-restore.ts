const versionUrl = "https://cdn.emulatorjs.org/stable/data/version.json";
const statePath = "/game.state";

type FileSystem = {
  unlink: (path: string) => void;
  writeFile: (path: string, bytes: Uint8Array) => void;
};
type StateManager = {
  FS?: FileSystem;
  clearEJSResetTimer?: () => void;
  functions?: {loadState?: (path: string, slot: number) => unknown; saveStateInfo?: () => unknown};
  getFrameNum?: () => number;
  loadExplicitStateAndWait?: (state: Uint8Array, timeoutMs?: number) => Promise<void>;
  toggleMainLoop?: (running: boolean) => void;
};
type ManagerConstructor = {prototype?: StateManager};
type RuntimeConfig = {
  print?: (...args: unknown[]) => void;
  printErr?: (...args: unknown[]) => void;
  [name: string]: unknown;
};
type RuntimeFactory = ((config: RuntimeConfig) => unknown) & {retromStateRestoreHook?: boolean};
type RestoreWindow = Window & {EJS_GameManager?: ManagerConstructor; EJS_Runtime?: RuntimeFactory};
type PendingLoad = {
  reject: (error: Error) => void;
  resolve: () => void;
  timer: number;
};
type PendingDelay = {reject: (error: Error) => void; timer: number};

async function waitForSerializable(
  manager: StateManager,
  deadline: number,
  target: RestoreWindow,
  isActive: () => boolean,
  delay: (milliseconds: number) => Promise<void>,
) {
  while (isActive()) {
    let serializable = false;
    try {
      const [size, , succeeded] = String(manager.functions?.saveStateInfo?.()).split("|");
      // The core's successful serialization is the readiness signal. The
      // diagnostic frame counter can still be zero in a serializable core.
      serializable = succeeded === "1" && Number.isSafeInteger(Number(size)) && Number(size) > 0;
    } catch { /* Some cores reject serialization until their GPU exists. */ }
    if (serializable) {return;}
    if (target.performance.now() >= deadline) {throw new Error("PLAYER_SAVE_STATE_RESTORE_TIMEOUT");}
    manager.toggleMainLoop?.(true);
    await delay(Math.min(50, Math.max(1, deadline - target.performance.now())));
  }
  throw new Error("PLAYER_SESSION_ENDED");
}

function createStateLoader(dependencies: {
  target: RestoreWindow;
  isActive: () => boolean;
  delay: (milliseconds: number) => Promise<void>;
  registerLoad: (milliseconds: number) => {cancel: () => void; promise: Promise<void>};
}) {
  return async function loadExplicitStateAndWait(
    this: StateManager,
    state: Uint8Array,
    timeoutMs = 15_000,
  ) {
    const fileSystem = this.FS;
    const loadState = this.functions?.loadState;
    if (!(state instanceof Uint8Array) || !state.byteLength || !fileSystem || !this.toggleMainLoop ||
      typeof loadState !== "function" || typeof this.functions?.saveStateInfo !== "function") {
      throw new Error("PLAYER_STATE_RESTORE_COMPATIBILITY_UNAVAILABLE");
    }
    const deadline = dependencies.target.performance.now() + timeoutMs;
    await waitForSerializable(this, deadline, dependencies.target, dependencies.isActive, dependencies.delay);
    const completion = dependencies.registerLoad(Math.max(1, deadline - dependencies.target.performance.now()));
    try {
      try {fileSystem.unlink(statePath);} catch { /* absent before the first load */ }
      fileSystem.writeFile(statePath, new Uint8Array(state));
      this.clearEJSResetTimer?.();
      loadState.call(this.functions, "game.state", 0);
      this.toggleMainLoop(true);
      await completion.promise;
    } finally {
      completion.cancel();
      this.toggleMainLoop(false);
      try {fileSystem.unlink(statePath);} catch { /* native code may already remove it */ }
    }
  };
}

export function installEmulatorJs423StateRestoreCompatibility(playerWindow: Window = window) {
  const target = playerWindow as RestoreWindow;
  const pendingLoads: PendingLoad[] = [];
  const pendingDelays = new Set<PendingDelay>();
  const restorePrototypes: Array<() => void> = [];
  let active = true;

  const delay = (milliseconds: number) => new Promise<void>((resolve, reject) => {
    const pending: PendingDelay = {
      reject,
      timer: target.setTimeout(() => {pendingDelays.delete(pending); resolve();}, milliseconds),
    };
    pendingDelays.add(pending);
  });
  const registerLoad = (milliseconds: number) => {
    let pending!: PendingLoad;
    const promise = new Promise<void>((resolve, reject) => {
      pending = {
        reject,
        resolve,
        timer: target.setTimeout(() => finishLoad(pending,
          new Error("PLAYER_SAVE_STATE_RESTORE_TIMEOUT")), milliseconds),
      };
      pendingLoads.push(pending);
    });
    return {cancel: () => finishLoad(pending), promise};
  };
  const finishLoad = (pending: PendingLoad, error?: Error) => {
    const index = pendingLoads.indexOf(pending);
    if (index < 0) {return;}
    pendingLoads.splice(index, 1);
    target.clearTimeout(pending.timer);
    if (error) {pending.reject(error);} else {pending.resolve();}
  };
  const observeNativeLog = (args: unknown[]) => {
    const message = args.map(String).join(" ");
    if (!message.includes("[State]") || !message.includes("game.state")) {return;}
    const pending = pendingLoads[0];
    if (!pending) {return;}
    if (/failed/iu.test(message)) {
      target.queueMicrotask(() => finishLoad(pending, new Error("PLAYER_SAVE_STATE_RESTORE_FAILED")));
    } else if (/loading state/iu.test(message)) {
      target.queueMicrotask(() => finishLoad(pending));
    }
  };
  const patchManager = (constructor: ManagerConstructor | undefined) => {
    const prototype = constructor?.prototype;
    if (!prototype || prototype.loadExplicitStateAndWait) {
      throw new Error("PLAYER_STATE_RESTORE_COMPATIBILITY_UNAVAILABLE");
    }
    prototype.loadExplicitStateAndWait = createStateLoader({
      delay,
      isActive: () => active,
      registerLoad,
      target,
    });
    restorePrototypes.push(() => Reflect.deleteProperty(prototype, "loadExplicitStateAndWait"));
  };

  const managerDescriptor = Object.getOwnPropertyDescriptor(target, "EJS_GameManager");
  if (managerDescriptor && !managerDescriptor.configurable) {
    throw new Error("PLAYER_STATE_RESTORE_COMPATIBILITY_UNAVAILABLE");
  }
  let managerConstructor = target.EJS_GameManager;
  if (managerConstructor) {patchManager(managerConstructor);}
  Object.defineProperty(target, "EJS_GameManager", {
    configurable: true,
    enumerable: managerDescriptor?.enumerable ?? true,
    get: () => managerConstructor,
    set: (constructor: ManagerConstructor | undefined) => {patchManager(constructor); managerConstructor = constructor;},
  });

  const wrapRuntime = (factory: RuntimeFactory | undefined) => {
    if (typeof factory !== "function") {throw new Error("PLAYER_STATE_RESTORE_COMPATIBILITY_UNAVAILABLE");}
    if (factory.retromStateRestoreHook) {return factory;}
    const wrapped = function (this: unknown, config: RuntimeConfig) {
      return Reflect.apply(factory, this, [{
        ...config,
        print: (...args: unknown[]) => {config?.print?.(...args); observeNativeLog(args);},
        printErr: (...args: unknown[]) => {config?.printErr?.(...args); observeNativeLog(args);},
      }]);
    } as RuntimeFactory;
    Object.defineProperty(wrapped, "retromStateRestoreHook", {value: true});
    return wrapped;
  };
  const runtimeDescriptor = Object.getOwnPropertyDescriptor(target, "EJS_Runtime");
  if (runtimeDescriptor && !runtimeDescriptor.configurable) {
    throw new Error("PLAYER_STATE_RESTORE_COMPATIBILITY_UNAVAILABLE");
  }
  let runtimeFactory = target.EJS_Runtime ? wrapRuntime(target.EJS_Runtime) : undefined;
  Object.defineProperty(target, "EJS_Runtime", {
    configurable: true,
    enumerable: runtimeDescriptor?.enumerable ?? true,
    get: () => runtimeFactory,
    set: (factory: RuntimeFactory | undefined) => {runtimeFactory = wrapRuntime(factory);},
  });

  const originalFetch = target.fetch.bind(target);
  target.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    if (url === versionUrl) {
      return Promise.resolve(new Response(JSON.stringify({current_version: "4.2.3", version: "4.2.3"}), {
        headers: {"Content-Type": "application/json"}, status: 200,
      }));
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  return () => {
    if (!active) {return;}
    active = false;
    target.fetch = originalFetch;
    for (const restore of restorePrototypes.reverse()) {restore();}
    if (managerDescriptor) {Object.defineProperty(target, "EJS_GameManager", managerDescriptor);}
    else {Reflect.deleteProperty(target, "EJS_GameManager");}
    if (runtimeDescriptor) {Object.defineProperty(target, "EJS_Runtime", runtimeDescriptor);}
    else {Reflect.deleteProperty(target, "EJS_Runtime");}
    for (const pending of pendingDelays) {
      target.clearTimeout(pending.timer);
      pending.reject(new Error("PLAYER_SESSION_ENDED"));
    }
    pendingDelays.clear();
    for (const pending of pendingLoads.splice(0)) {
      target.clearTimeout(pending.timer);
      pending.reject(new Error("PLAYER_SESSION_ENDED"));
    }
  };
}
