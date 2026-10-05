type Manager = {
  Module?: {_retrom_state_load_begin?: () => void; _retrom_state_load_result?: () => number};
  FS?: {writeFile(path: string, bytes: Uint8Array): void; unlink(path: string): void};
  functions?: {loadState(path: string, slot: number): unknown};
  getFrameNum?: () => number;
  toggleMainLoop?: (running: boolean) => void;
  loadExplicitStateAndWait?: (bytes: Uint8Array, timeoutMs?: number) => Promise<void>;
};
type Constructor = {prototype: Manager};
type Realm = Window & {EJS_GameManager?: Constructor};

/** The owned core reports completion from retro_unserialize, including failures
 * after the frontend has emitted its asynchronous "Loading state" message. */
export function installAzaharStateRestore(realm: Window) {
  const target = realm as Realm, controller = new AbortController();
  const descriptor = Object.getOwnPropertyDescriptor(target, "EJS_GameManager");
  const patched = new Map<Manager, PropertyDescriptor | undefined>();
  const wait = (ready: () => boolean, deadline: number) => new Promise<void>((resolve, reject) => {
    let timer: number | undefined;
    const finish = (error?: Error) => {
      if (timer !== undefined) {target.clearTimeout(timer);}
      controller.signal.removeEventListener("abort", abort);
      if (error) {reject(error);} else {resolve();}
    };
    const abort = () => finish(new Error("PLAYER_SESSION_ENDED"));
    const poll = () => {
      if (controller.signal.aborted) {abort(); return;}
      try {if (ready()) {finish(); return;}} catch (error) {finish(error as Error); return;}
      if (target.performance.now() >= deadline) {finish(new Error("PLAYER_SAVE_STATE_RESTORE_TIMEOUT")); return;}
      timer = target.setTimeout(poll, 20);
    };
    controller.signal.addEventListener("abort", abort, {once: true}); poll();
  });
  const patch = (constructor: Constructor | undefined) => {
    const prototype = constructor?.prototype;
    if (!prototype || patched.has(prototype)) {return;}
    patched.set(prototype, Object.getOwnPropertyDescriptor(prototype, "loadExplicitStateAndWait"));
    prototype.loadExplicitStateAndWait = async function (bytes, timeoutMs = 30_000) {
      const module = this.Module, fs = this.FS, load = this.functions?.loadState;
      if (!module?._retrom_state_load_begin || !module._retrom_state_load_result || !fs ||
        !load || !this.toggleMainLoop || !this.getFrameNum || !bytes.byteLength) {
        throw new Error("PLAYER_STATE_RESTORE_COMPATIBILITY_UNAVAILABLE");
      }
      const deadline = target.performance.now() + timeoutMs;
      try {
        this.toggleMainLoop(true);
        await wait(() => this.getFrameNum!() > 0, deadline);
        this.toggleMainLoop(false);
        fs.writeFile("/game.state", new Uint8Array(bytes));
        module._retrom_state_load_begin();
        load.call(this.functions, "game.state", 0);
        this.toggleMainLoop(true);
        await wait(() => {
          const result = module._retrom_state_load_result!();
          if (result === 1) {return true;}
          if (result !== 0) {throw new Error("PLAYER_SAVE_STATE_RESTORE_FAILED");}
          return false;
        }, deadline);
      } finally {
        this.toggleMainLoop(false);
        try {fs.unlink("/game.state");} catch { /* Native loading may already have removed it. */ }
      }
    };
  };
  let current = target.EJS_GameManager; patch(current);
  Object.defineProperty(target, "EJS_GameManager", {configurable: true, enumerable: true,
    get: () => current, set: (constructor: Constructor | undefined) => {
      descriptor?.set?.call(target, constructor);
      current = descriptor?.get ? descriptor.get.call(target) : constructor; patch(current);
    },
  });
  return () => {
    controller.abort();
    for (const [prototype, original] of patched) {
      if (original) {Object.defineProperty(prototype, "loadExplicitStateAndWait", original);}
      else {Reflect.deleteProperty(prototype, "loadExplicitStateAndWait");}
    }
    if (descriptor) {Object.defineProperty(target, "EJS_GameManager", descriptor);}
    else {Reflect.deleteProperty(target, "EJS_GameManager");}
  };
}
