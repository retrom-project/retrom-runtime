import {CoreDiagnostics} from "../../provider/core-diagnostics.js";

type NativeModule = {_retrom_content_load_result?: () => number};
type Config = {print?: (...values: unknown[]) => void; printErr?: (...values: unknown[]) => void};
type Factory = (config: Config) => Promise<NativeModule>;
type NativeWindow = Window & {EJS_Runtime?: Factory};

/** Capture factory output before EmulatorJS suppresses console logging in ordinary launches. */
export function installEmulatorJsNativeDiagnostics(realm: Window) {
  const target = realm as NativeWindow;
  const previous = Object.getOwnPropertyDescriptor(target, "EJS_Runtime");
  const diagnostics = new CoreDiagnostics();
  let module: NativeModule | undefined, active = true;
  const record = (values: unknown[]) => {
    if (active) {diagnostics.record(values.filter(value => typeof value === "string").join(" "));}
  };
  const wrap = (factory: Factory | undefined): Factory | undefined => factory && async function (this: unknown, config) {
    // Other native hooks add callbacks after calling the factory. Preserve their
    // shared config object rather than isolating them in a shallow copy.
    const print = config.print, printErr = config.printErr;
    config.print = (...values) => {record(values); print?.apply(config, values);};
    config.printErr = (...values) => {record(values); printErr?.apply(config, values);};
    const result = await factory.call(this, config);
    if (active) {module = result;}
    return result;
  };
  let current = wrap(target.EJS_Runtime);
  Object.defineProperty(target, "EJS_Runtime", {configurable: true, enumerable: true,
    get: () => current, set: (factory: Factory | undefined) => {
      previous?.set?.call(target, factory);
      current = wrap(previous?.get ? previous.get.call(target) : factory);
    },
  });
  return {
    get module() {return module;},
    messages: () => diagnostics.messages(),
    cleanup() {
      active = false; module = undefined; diagnostics.clear();
      if (previous) {Object.defineProperty(target, "EJS_Runtime", previous);}
      else {Reflect.deleteProperty(target, "EJS_Runtime");}
    },
  };
}
