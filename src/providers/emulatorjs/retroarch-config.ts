type Manager = {getRetroArchCfg?: () => string};
type Constructor = {prototype?: Manager};
type ConfigWindow = Window & {EJS_GameManager?: Constructor};

export function installEmulatorJsRetroArchConfig(playerWindow: Window, core: string, restoring: boolean) {
  const settings = [
    ...(core === "fuse" ? ['input_libretro_device_p1 = "513"', 'input_libretro_device_p2 = "0"'] : []),
    ...(restoring ? ["log_verbosity = true"] : []),
  ];
  if (!settings.length) {return () => undefined;}
  const target = playerWindow as ConfigWindow;
  const descriptor = Object.getOwnPropertyDescriptor(target, "EJS_GameManager");
  if (descriptor && !descriptor.configurable) {throw new Error("PLAYER_RUNTIME_CONFIG_UNAVAILABLE");}
  const patched = new Map<Manager, PropertyDescriptor>();
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
    for (const [prototype, original] of patched) {Object.defineProperty(prototype, "getRetroArchCfg", original);}
    if (descriptor) {Object.defineProperty(target, "EJS_GameManager", descriptor);}
    else {Reflect.deleteProperty(target, "EJS_GameManager");}
  };
}
