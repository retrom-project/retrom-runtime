import {ActiveTimeBudget} from "./active-time-budget.js";

type NetplayCompatibilityManager = {
  FS?: {unlink?: (path: string) => void; writeFile?: (path: string, bytes: Uint8Array) => void};
  clearEJSResetTimer?: () => void;
  functions?: {loadState?: (...args: unknown[]) => unknown};
  getFrameNum?: () => number;
  getState?: () => Uint8Array;
  toggleMainLoop?: (running: boolean) => void;
};

const VERSION_URL = "https://cdn.emulatorjs.org/stable/data/version.json";

type RuntimeModuleConfig = {
  postMainLoop?: () => void;
  print?: (...args: unknown[]) => void;
  printErr?: (...args: unknown[]) => void;
  [name: string]: unknown;
};
type RuntimeFactory = ((config: RuntimeModuleConfig) => unknown) & { retromNetplayFrameHook?: boolean };
type GameManagerPrototype = {
  mountFileSystems?: () => Promise<void>;
  loadStateAndWait?: (state: Uint8Array, timeoutMs?: number) => Promise<{ byteExact: boolean }>;
  runNetplayFrame?: (timeoutMs?: number) => Promise<number>;
  cancelNetplayOperations?: () => void;
};
type GameManagerConstructor = { prototype?: GameManagerPrototype };
type NetplayPatchWindow = Window & {
  console: Console;
  EJS_Runtime?: RuntimeFactory;
  EJS_GameManager?: GameManagerConstructor;
  __RETROM_POST_MAIN_LOOP__?: () => void;
};
type LoadSignal = { reject: (error: Error) => void; resolve: () => void };
type RuntimeFileSystem = {
  unlink?: (path: string) => void;
  writeFile?: (path: string, bytes: Uint8Array) => void;
};
function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) {return false;}
  for (let index = 0; index < left.byteLength; index += 1) {if (left[index] !== right[index]) {return false;}}
  return true;
}

/** Install the v4.2.3 hooks before loader.js assigns either constructor. */
export function installEmulatorJs423NetplayCompatibility(playerWindow: Window = window) {
  const target = playerWindow as NetplayPatchWindow;
  const loadSignals: LoadSignal[] = [];
  const activeBudgets = new Set<ActiveTimeBudget>();
  const prototypeRestores: Array<() => void> = [];
  let active = true;

  const registerLoadSignal = () => {
    let signal!: LoadSignal;
    const promise = new Promise<void>((resolve, reject) => { signal = { resolve, reject }; });
    loadSignals.push(signal);
    return {
      promise,
      complete: () => {
        const index = loadSignals.indexOf(signal);
        if (index < 0) {return;}
        loadSignals.splice(index, 1);
        signal.resolve();
      },
      cancel: () => {
        const index = loadSignals.indexOf(signal);
        if (index >= 0) {loadSignals.splice(index, 1);}
      },
    };
  };
  const observeNativeLog = (args: unknown[]) => {
    const message = args.map(String).join(" ");
    if (!message.includes("[State]") || !message.includes("game.state")) {return;}
    const signal = loadSignals.shift();
    if (!signal) {return;}
    if (/failed/i.test(message)) {target.queueMicrotask(() => signal.reject(new Error("STATE_INVALID")));}
    else if (/loading state/i.test(message)) {target.queueMicrotask(signal.resolve);}
    else {loadSignals.unshift(signal);}
  };
  const patchManager = (constructor: GameManagerConstructor | undefined) => {
    const prototype = constructor?.prototype;
    if (!prototype || typeof prototype.mountFileSystems !== "function") {throw new Error("NETPLAY_RUNTIME_COMPATIBILITY_UNAVAILABLE");}
    if (prototype.loadStateAndWait || prototype.runNetplayFrame || prototype.cancelNetplayOperations) {
      throw new Error("NETPLAY_RUNTIME_COMPATIBILITY_UNAVAILABLE");
    }
    const originalMount = prototype.mountFileSystems;
    const mountInMemory = async function (this: { mkdir?: (path: string) => void }) {
      if (typeof this.mkdir !== "function") {throw new Error("NETPLAY_RUNTIME_COMPATIBILITY_UNAVAILABLE");}
      this.mkdir("/data");
      this.mkdir("/data/saves");
    };
    const activeBudget = (timeoutMS: number) => new ActiveTimeBudget(timeoutMS, {
      now: () => target.performance.now(),
      visibility: target.document,
      setTimer: (callback, delayMS) => target.setTimeout(callback, delayMS),
      clearTimer: (timer) => target.clearTimeout(timer),
    });
    const raceWithActiveBudget = async <T>(operation: Promise<T>, timeoutMS: number, timeoutReason: string) => {
      const budget = activeBudget(timeoutMS);
      activeBudgets.add(budget);
      try {
        return await budget.race(operation, timeoutReason);
      } finally {
        activeBudgets.delete(budget);
      }
    };
    const loadStateAndWait = async function (this: NetplayCompatibilityManager, state: Uint8Array, timeoutMs = 15_000) {
      const fileSystem = this.FS as RuntimeFileSystem | undefined;
      const functions = (this as { functions?: { loadState?: (...args: unknown[]) => unknown } }).functions;
      if (!this.getState || !this.toggleMainLoop || !fileSystem?.writeFile || !fileSystem.unlink ||
        typeof functions?.loadState !== "function") {throw new Error("NETPLAY_RUNTIME_COMPATIBILITY_UNAVAILABLE");}
      const expected = new Uint8Array(state);
      const completion = registerLoadSignal();
      try {
        try { fileSystem.unlink("/game.state"); } catch { /* absent before the first load */ }
        fileSystem.writeFile("/game.state", expected);
        (this as { clearEJSResetTimer?: () => void }).clearEJSResetTimer?.();
        functions.loadState("game.state", 0);
        this.toggleMainLoop(true);
        await raceWithActiveBudget(completion.promise, timeoutMs, "STATE_LOAD_TIMEOUT");
        this.toggleMainLoop(false);
        const byteExact = equalBytes(new Uint8Array(this.getState()), expected);
        return { byteExact };
      } finally {
        this.toggleMainLoop(false);
        completion.cancel();
        try { fileSystem.unlink("/game.state"); } catch { /* native code may already remove it */ }
      }
    };
    const runNetplayFrame = async function (this: NetplayCompatibilityManager, timeoutMs = 5_000) {
      if (!this.getFrameNum || !this.toggleMainLoop) {return Promise.reject(new Error("NETPLAY_RUNTIME_COMPATIBILITY_UNAVAILABLE"));}
      const original = target.__RETROM_POST_MAIN_LOOP__;
      const startFrame = this.getFrameNum();
      let resolveFrame!: (frame: number) => void;
      let rejectFrame!: (error: Error) => void;
      const completion = new Promise<number>((resolve, reject) => {
        resolveFrame = resolve; rejectFrame = reject;
      });
      const wrapper = () => {
        original?.();
        const completedFrame = this.getFrameNum!();
        if (completedFrame <= startFrame) {return;}
        // Stop synchronously inside postMainLoop. Waiting for the Promise
        // continuation leaves a task-sized window in which Emscripten can
        // schedule another native frame, making one canonical input advance
        // different peers by different amounts under load.
        this.toggleMainLoop!(false);
        if (completedFrame === startFrame + 1) {resolveFrame(completedFrame);}
        else {rejectFrame(new Error("NETPLAY_FRAME_STEP_INVALID"));}
      };
      target.__RETROM_POST_MAIN_LOOP__ = wrapper;
      try {
        this.toggleMainLoop(true);
        return await raceWithActiveBudget(completion, timeoutMs, "NETPLAY_FRAME_STEP_TIMEOUT");
      } finally {
        this.toggleMainLoop(false);
        if (target.__RETROM_POST_MAIN_LOOP__ === wrapper) {target.__RETROM_POST_MAIN_LOOP__ = original;}
      }
    };
    prototype.mountFileSystems = mountInMemory;
    prototype.loadStateAndWait = loadStateAndWait;
    prototype.runNetplayFrame = runNetplayFrame;
    prototype.cancelNetplayOperations = () => {
      for (const budget of [...activeBudgets]) {budget.cancel("NETPLAY_SESSION_ENDED");}
    };
    prototypeRestores.push(() => {
      prototype.mountFileSystems = originalMount;
      Reflect.deleteProperty(prototype, "loadStateAndWait");
      Reflect.deleteProperty(prototype, "runNetplayFrame");
      Reflect.deleteProperty(prototype, "cancelNetplayOperations");
    });
  };

  const managerDescriptor = Object.getOwnPropertyDescriptor(target, "EJS_GameManager");
  if (managerDescriptor && !managerDescriptor.configurable) {throw new Error("NETPLAY_RUNTIME_COMPATIBILITY_UNAVAILABLE");}
  let managerConstructor = target.EJS_GameManager;
  if (managerConstructor) {patchManager(managerConstructor);}
  Object.defineProperty(target, "EJS_GameManager", {
    configurable: true,
    enumerable: managerDescriptor?.enumerable ?? true,
    get: () => managerConstructor,
    set: (constructor: GameManagerConstructor | undefined) => {
      patchManager(constructor);
      managerConstructor = constructor;
    },
  });

  const wrapRuntime = (factory: RuntimeFactory | undefined) => {
    if (typeof factory !== "function") {throw new Error("NETPLAY_RUNTIME_COMPATIBILITY_UNAVAILABLE");}
    if (factory.retromNetplayFrameHook) {return factory;}
    const wrapped = function (this: unknown, moduleConfig: RuntimeModuleConfig) {
      const originalPostMainLoop = moduleConfig?.postMainLoop;
      const patchedConfig: RuntimeModuleConfig = {
        ...moduleConfig,
        print: (...args: unknown[]) => { moduleConfig?.print?.(...args); observeNativeLog(args); },
        printErr: (...args: unknown[]) => { moduleConfig?.printErr?.(...args); observeNativeLog(args); },
        postMainLoop: () => { originalPostMainLoop?.(); target.__RETROM_POST_MAIN_LOOP__?.(); },
      };
      const originalLog = target.console.log;
      const originalError = target.console.error;
      target.console.log = function observeStateLoad(...args: unknown[]) {
        originalLog.apply(this, args);
        observeNativeLog(args);
      };
      target.console.error = function observeStateLoadError(...args: unknown[]) {
        originalError.apply(this, args);
        observeNativeLog(args);
      };
      try {
        return Reflect.apply(factory, this, [patchedConfig]);
      } finally {
        target.console.log = originalLog;
        target.console.error = originalError;
      }
    } as RuntimeFactory;
    Object.defineProperty(wrapped, "retromNetplayFrameHook", { value: true });
    return wrapped;
  };
  const runtimeDescriptor = Object.getOwnPropertyDescriptor(target, "EJS_Runtime");
  if (runtimeDescriptor && !runtimeDescriptor.configurable) {throw new Error("NETPLAY_RUNTIME_COMPATIBILITY_UNAVAILABLE");}
  let runtimeFactory = target.EJS_Runtime ? wrapRuntime(target.EJS_Runtime) : undefined;
  Object.defineProperty(target, "EJS_Runtime", {
    configurable: true,
    enumerable: runtimeDescriptor?.enumerable ?? true,
    get: () => runtimeFactory,
    set: (factory: RuntimeFactory | undefined) => { runtimeFactory = wrapRuntime(factory); },
  });

  const originalFetch = target.fetch.bind(target);
  target.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    if (url === VERSION_URL) {return Promise.resolve(new Response(JSON.stringify({ version: "4.2.3", current_version: "4.2.3" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));}
    return originalFetch(input, init);
  }) as typeof fetch;

  return () => {
    if (!active) {return;}
    active = false;
    target.fetch = originalFetch;
    for (const restore of prototypeRestores.reverse()) {restore();}
    if (managerDescriptor) {Object.defineProperty(target, "EJS_GameManager", managerDescriptor);}
    else {Reflect.deleteProperty(target, "EJS_GameManager");}
    if (runtimeDescriptor) {Object.defineProperty(target, "EJS_Runtime", runtimeDescriptor);}
    else {Reflect.deleteProperty(target, "EJS_Runtime");}
    Reflect.deleteProperty(target, "__RETROM_POST_MAIN_LOOP__");
    for (const budget of [...activeBudgets]) {budget.cancel("NETPLAY_SESSION_ENDED");}
    for (const signal of loadSignals.splice(0)) {signal.reject(new Error("NETPLAY_SESSION_ENDED"));}
  };
}
