type RuntimeConfig = {print?: (...args: unknown[]) => void; printErr?: (...args: unknown[]) => void; postMainLoop?: () => void};
type RuntimeFactory = (config: RuntimeConfig) => unknown;
type Pending = {finish: (error?: Error) => void; loops: number | null};

export function installPspRestoreObserver(runtimeWindow: Window) {
  const target = runtimeWindow as Window & {EJS_Runtime?: RuntimeFactory};
  const previous = Object.getOwnPropertyDescriptor(target, "EJS_Runtime");
  const pending = new Set<Pending>();
  let active = true;
  const observe = (args: unknown[]) => {
    const message = args.map(String).join(" ");
    if (!message.includes("[State]") || !message.includes("game.state")) {return;}
    for (const load of pending) {
      if (/failed/iu.test(message)) {load.finish(new Error("PLAYER_SAVE_STATE_RESTORE_FAILED"));}
      else if (/loading state/iu.test(message)) {load.loops = 0;}
    }
  };
  const wrap = (factory: RuntimeFactory | undefined): RuntimeFactory | undefined => factory && function (this: unknown, config) {
    return factory.call(this, {...config,
      print: (...args) => {config.print?.(...args); observe(args);},
      printErr: (...args) => {config.printErr?.(...args); observe(args);},
      postMainLoop: () => {
        config.postMainLoop?.();
        // The first callback can be the Asyncify unwind. The next native loop
        // must run after rewind finishes and the queued load task has returned.
        for (const load of pending) {if (load.loops !== null && ++load.loops >= 2) {load.finish();}}
      },
    });
  };
  let current = wrap(target.EJS_Runtime);
  Object.defineProperty(target, "EJS_Runtime", {configurable: true, enumerable: true,
    get: () => current, set: (factory: RuntimeFactory | undefined) => {current = wrap(factory);},
  });
  return {
    wait(signal?: AbortSignal) {
      let load!: Pending;
      const promise = new Promise<void>((resolve, reject) => {
        const abort = () => load.finish(new Error("PLAYER_SESSION_ENDED"));
        const timer = target.setTimeout(() => load.finish(new Error("PLAYER_SAVE_STATE_RESTORE_TIMEOUT")), 10_000);
        load = {loops: null, finish(error) {
          if (!pending.delete(load)) {return;}
          target.clearTimeout(timer); signal?.removeEventListener("abort", abort);
          if (error) {reject(error);} else {resolve();}
        }};
        pending.add(load); signal?.addEventListener("abort", abort, {once: true});
        if (!active || signal?.aborted) {abort();}
      });
      return {promise, cancel: () => load.finish()};
    },
    cleanup() {
      active = false;
      for (const load of pending) {load.finish(new Error("PLAYER_SESSION_ENDED"));}
      if (previous) {Object.defineProperty(target, "EJS_Runtime", previous);}
      else {Reflect.deleteProperty(target, "EJS_Runtime");}
    },
  };
}
