type FileSystem = {unlink?: (path: string) => void; writeFile?: (path: string, bytes: Uint8Array) => void};
type Manager = {
  FS?: FileSystem;
  Module?: {cwrap?: (name: string, result: "string", args: string[]) => () => string};
  clearEJSResetTimer?: () => void;
  functions?: {loadState?: (path: string, slot: number) => unknown};
  getFrameNum?: () => number;
  toggleMainLoop?: (running: boolean) => void;
  loadExplicitStateAndWait?: (state: Uint8Array, timeoutMs?: number) => Promise<void>;
};
type RuntimeConfig = {
  print?: (...args: unknown[]) => void;
  printErr?: (...args: unknown[]) => void;
  postMainLoop?: (...args: unknown[]) => void;
  [key: string]: unknown;
};
type RuntimeFactory = (config: RuntimeConfig) => unknown;
type RuntimeWindow = Window & {EJS_Runtime?: RuntimeFactory};
type PendingRestore = {observed: boolean; finish: (error?: Error) => void};

async function waitForNativeReady(manager: Manager, serialize: () => string, target: RuntimeWindow,
  deadline: number, isActive: () => boolean, toggleMainLoop: (running: boolean) => void) {
  // A core may accept a game before its first GPU frame. Wait for a frame
  // and a successful native serialization before loading its snapshot.
  while (isActive()) {
    try {
      const [length, , success] = String(serialize()).split("|");
      if (success === "1" && Number(length) > 0 && (manager.getFrameNum?.() ?? 0) > 0) {return;}
    } catch { /* GPU and native serializer may still be initializing. */ }
    if (target.performance.now() >= deadline) {throw new Error("PLAYER_SAVE_STATE_RESTORE_TIMEOUT");}
    toggleMainLoop(true);
    await new Promise(resolve => target.setTimeout(resolve, 50));
  }
  throw new Error("PLAYER_SESSION_ENDED");
}

// EmulatorJS 4.3 exposes loadState() as a fire-and-forget call. The pinned
// RetroArch runtime queues the actual unserialize task for a later main loop.
// A new Launch must wait for that task before resuming or claiming success.
export function installSupermodelRestore(playerWindow: Window) {
  const target = playerWindow as RuntimeWindow;
  const descriptor = Object.getOwnPropertyDescriptor(target, "EJS_Runtime");
  if (descriptor && !descriptor.configurable) {throw new Error("PLAYER_STATE_RESTORE_COMPATIBILITY_UNAVAILABLE");}
  let active = true;
  let pending: PendingRestore | null = null;
  const observe = (args: unknown[]) => {
    const message = args.map(String).join(" ");
    if (!message.includes("[State]") || !message.includes("game.state")) {return;}
    if (/fail|error/iu.test(message)) {pending?.finish(new Error("PLAYER_SAVE_STATE_RESTORE_FAILED"));}
    else if (/loading state/iu.test(message) && pending) {pending.observed = true;}
  };
  const wrap = (factory: RuntimeFactory | undefined): RuntimeFactory | undefined => {
    if (!factory) {return undefined;}
    return (config: RuntimeConfig) => factory({
      ...config,
      print: (...args) => {observe(args); config.print?.(...args);},
      printErr: (...args) => {observe(args); config.printErr?.(...args);},
      postMainLoop: (...args) => {
        config.postMainLoop?.(...args);
        if (pending?.observed) {pending.finish();}
      },
    });
  };
  let runtime = wrap(target.EJS_Runtime);
  Object.defineProperty(target, "EJS_Runtime", {
    configurable: true, enumerable: descriptor?.enumerable ?? true,
    get: () => runtime,
    set: (factory: RuntimeFactory | undefined) => {runtime = wrap(factory);},
  });

  const attach = (manager: Manager) => {
    const {FS, functions, Module} = manager;
    const serialize = Module?.cwrap?.("save_state_info", "string", []);
    const loadState = functions?.loadState?.bind(functions);
    const toggleMainLoop = manager.toggleMainLoop?.bind(manager);
    const writeFile = FS?.writeFile?.bind(FS);
    if (!FS || !writeFile || !loadState || !toggleMainLoop || !serialize) {
      throw new Error("PLAYER_STATE_RESTORE_COMPATIBILITY_UNAVAILABLE");
    }
    const original = manager.loadExplicitStateAndWait;
    manager.loadExplicitStateAndWait = async (state: Uint8Array, timeoutMs = 30_000) => {
      if (!active) {throw new Error("PLAYER_SESSION_ENDED");}
      if (!(state instanceof Uint8Array) || !state.byteLength || pending) {
        throw new Error("PLAYER_STATE_RESTORE_COMPATIBILITY_UNAVAILABLE");
      }
      const deadline = target.performance.now() + timeoutMs;
      await waitForNativeReady(manager, serialize, target, deadline, () => active, toggleMainLoop);
      toggleMainLoop(false);
      let timer = 0;
      const completion = new Promise<void>((resolve, reject) => {
        timer = target.setTimeout(() => pending?.finish(new Error("PLAYER_SAVE_STATE_RESTORE_TIMEOUT")),
          Math.max(1, deadline - target.performance.now()));
        pending = {observed: false, finish: error => {
          target.clearTimeout(timer);
          pending = null;
          if (error) {reject(error);} else {resolve();}
        }};
      });
      try {
        try {FS.unlink?.("/game.state");} catch { /* First restore. */ }
        writeFile("/game.state", new Uint8Array(state));
        manager.clearEJSResetTimer?.();
        loadState("game.state", 0);
        toggleMainLoop(true);
        await completion;
      } finally {
        (pending as PendingRestore | null)?.finish(new Error("PLAYER_SESSION_ENDED"));
        toggleMainLoop(false);
        try {FS.unlink?.("/game.state");} catch { /* Native code may remove it. */ }
      }
    };
    return () => {manager.loadExplicitStateAndWait = original;};
  };
  const cleanup = () => {
    active = false;
    pending?.finish(new Error("PLAYER_SESSION_ENDED"));
    if (descriptor) {Object.defineProperty(target, "EJS_Runtime", descriptor);}
    else {Reflect.deleteProperty(target, "EJS_Runtime");}
  };
  return {attach, cleanup};
}
