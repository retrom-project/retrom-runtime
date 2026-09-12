import {configureSameCdiInput, type SameCdiConfigurationIO} from "./same-cdi-config.js";

type NativeModule = {callMain?: (args: string[]) => unknown};
type Manager = SameCdiConfigurationIO & {getRetroArchCfg?: () => string; Module?: NativeModule};
type Constructor = {prototype?: Manager};
type ConfigWindow = Window & {EJS_GameManager?: Constructor};

export function installEmulatorJsRetroArchConfig(playerWindow: Window, core: string, restoring: boolean) {
  const settings = [
    ...(core === "quasi88" ? ['system_directory = "/retroarch/userdata/system"'] : []),
    ...(core === "fuse" ? ['input_libretro_device_p1 = "513"', 'input_libretro_device_p2 = "0"'] : []),
    ...(core === "81" ? ['input_libretro_device_p1 = "257"', 'input_libretro_device_p2 = "259"'] : []),
    ...(restoring ? ["log_verbosity = true"] : []),
  ];
  if (!settings.length && core !== "same_cdi") {return () => undefined;}
  const target = playerWindow as ConfigWindow;
  const descriptor = Object.getOwnPropertyDescriptor(target, "EJS_GameManager");
  if (descriptor && !descriptor.configurable) {throw new Error("PLAYER_RUNTIME_CONFIG_UNAVAILABLE");}
  const patched = new Map<Manager, PropertyDescriptor>();
  const nativeEntries = new Map<NativeModule, NonNullable<NativeModule["callMain"]>>();
  const configureNativeEntry = (manager: Manager) => {
    const module = manager.Module;
    if (!module?.callMain) {throw new Error("PLAYER_RUNTIME_CONFIG_UNAVAILABLE");}
    if (nativeEntries.has(module)) {return;}
    const callMain = module.callMain;
    nativeEntries.set(module, callMain);
    module.callMain = function (args) {
      // The saved-files mount is ready before native startup reads its config.
      if (core === "same_cdi") {configureSameCdiInput(manager);}
      // RetroArch resets device types from its remapping cache unless they are
      // command-line overrides; retroarch.cfg alone cannot preserve these ports.
      const devices = core === "81" ? ["--device", "1:257", "--device", "2:259"] : [];
      // Logging is initialized before retroarch.cfg in some 4.2.3 cores.
      const logging = restoring && !args.includes("-v") ? ["-v"] : [];
      return callMain.call(this, [...devices, ...logging, ...args]);
    };
  };
  const patch = (constructor: Constructor | undefined) => {
    const prototype = constructor?.prototype;
    if (!prototype || typeof prototype.getRetroArchCfg !== "function") {
      throw new Error("PLAYER_RUNTIME_CONFIG_UNAVAILABLE");
    }
    if (patched.has(prototype)) {return;}
    const original = Object.getOwnPropertyDescriptor(prototype, "getRetroArchCfg");
    if (!original) {throw new Error("PLAYER_RUNTIME_CONFIG_UNAVAILABLE");}
    const getConfig = prototype.getRetroArchCfg;
    patched.set(prototype, original);
    prototype.getRetroArchCfg = function () {
      if (restoring || core === "81" || core === "same_cdi") {configureNativeEntry(this);}
      return `${getConfig.call(this)}\n${settings.join("\n")}\n`;
    };
  };
  let current = target.EJS_GameManager;
  if (current) {patch(current);}
  Object.defineProperty(target, "EJS_GameManager", {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get: () => current,
    set: (value: Constructor | undefined) => {patch(value); current = value;},
  });
  return () => {
    for (const [module, callMain] of nativeEntries) {module.callMain = callMain;}
    for (const [prototype, original] of patched) {Object.defineProperty(prototype, "getRetroArchCfg", original);}
    if (descriptor) {Object.defineProperty(target, "EJS_GameManager", descriptor);}
    else {Reflect.deleteProperty(target, "EJS_GameManager");}
  };
}
