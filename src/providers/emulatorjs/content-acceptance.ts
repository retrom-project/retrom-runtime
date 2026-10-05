import {RuntimeFailureError} from "../../provider/failure.js";

type NativeModule = {_retrom_content_load_result?: () => number};
type Config = {print?: (...values: unknown[]) => void; printErr?: (...values: unknown[]) => void};
type Factory = (config: Config) => Promise<NativeModule>;
type NativeWindow = Window & {EJS_Runtime?: Factory};

/** CORE_RESULT_V1 is owned by the core. For hardware loaders its acceptance
 * occurs after graphics initialization, never merely after retro_load_game. */
export function installContentAcceptance(realm: Window) {
  const target = realm as NativeWindow;
  const previous = Object.getOwnPropertyDescriptor(target, "EJS_Runtime");
  const diagnostics: string[] = [];
  const pending = new Set<(error: Error) => void>();
  let module: NativeModule | undefined, active = true;
  const record = (values: unknown[]) => {
    if (!active) {return;}
    diagnostics.push(values.filter(value => typeof value === "string").join(" ").slice(-500));
    if (diagnostics.length > 8) {diagnostics.shift();}
  };
  const wrap = (factory: Factory | undefined): Factory | undefined => factory && async function (this: unknown, config) {
    const result = await factory.call(this, {...config,
      print: (...values) => {record(values); config.print?.(...values);},
      printErr: (...values) => {record(values); config.printErr?.(...values);},
    });
    if (active) {module = result;}
    return result;
  };
  let current = wrap(target.EJS_Runtime);
  Object.defineProperty(target, "EJS_Runtime", {configurable: true, enumerable: true,
    get: () => current, set: (factory: Factory | undefined) => {current = wrap(factory);},
  });
  return {
    wait(signal: AbortSignal): Promise<void> {
      return new Promise((resolve, reject) => {
        let timer: number | undefined, settled = false;
        const finish = (error?: Error) => {
          if (settled) {return;} settled = true;
          if (timer !== undefined) {target.clearTimeout(timer);}
          pending.delete(finish); signal.removeEventListener("abort", abort);
          if (error) {reject(error);} else {resolve();}
        };
        const abort = () => finish(new Error("PLAYER_SESSION_ENDED"));
        const poll = () => {
          if (!active || signal.aborted) {abort(); return;}
          const read = module?._retrom_content_load_result;
          if (!read) {finish(new RuntimeFailureError("PLAYER_CONTENT_RECEIPT_UNAVAILABLE", "CONFIGURATION")); return;}
          let value: number;
          try {value = read.call(module);} catch (error) {
            finish(new RuntimeFailureError("PLAYER_CONTENT_RECEIPT_UNAVAILABLE", "CORE", diagnostics, {cause: error})); return;
          }
          if (value === 1) {finish(); return;}
          if (value === -1 || value === -2) {
            finish(new RuntimeFailureError(value === -2 ? "PLAYER_CONTENT_ENCRYPTED" : "PLAYER_CONTENT_REJECTED", "CONTENT", [...diagnostics])); return;
          }
          if (value !== 0) {finish(new RuntimeFailureError("PLAYER_CONTENT_RECEIPT_INVALID", "CONFIGURATION")); return;}
          timer = target.setTimeout(poll, 20);
        };
        pending.add(finish); signal.addEventListener("abort", abort, {once: true}); poll();
      });
    },
    cleanup() {
      active = false;
      for (const finish of pending) {finish(new Error("PLAYER_SESSION_ENDED"));}
      module = undefined; diagnostics.length = 0;
      if (previous) {Object.defineProperty(target, "EJS_Runtime", previous);}
      else {Reflect.deleteProperty(target, "EJS_Runtime");}
    },
  };
}
