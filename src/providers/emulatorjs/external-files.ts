type ManagerPrototype = {writeFile?: (path: string, data: unknown) => unknown; loadExternalFiles?: () => Promise<void>};
type MountFiles = (write: (path: string, bytes: Uint8Array) => unknown) => Promise<void>;
type ManagerConstructor = {prototype?: ManagerPrototype};
type ExternalFileWindow = Window & {EJS_GameManager?: ManagerConstructor};

export function installExternalFileCompatibility(playerWindow: Window = window, mount?: MountFiles) {
  const target = playerWindow as ExternalFileWindow;
  const descriptor = Object.getOwnPropertyDescriptor(target, "EJS_GameManager");
  if (descriptor && !descriptor.configurable) {
    throw new Error("PLAYER_EXTERNAL_FILES_COMPATIBILITY_UNAVAILABLE");
  }
  const patched = new Map<ManagerPrototype, {write: PropertyDescriptor; load?: PropertyDescriptor}>();
  const patch = (constructor: ManagerConstructor | undefined) => {
    const prototype = constructor?.prototype;
    const original = prototype?.writeFile;
    if (!prototype) {throw new Error("PLAYER_EXTERNAL_FILES_COMPATIBILITY_UNAVAILABLE");}
    if (patched.has(prototype)) {return;}
    if (typeof original !== "function") {throw new Error("PLAYER_EXTERNAL_FILES_COMPATIBILITY_UNAVAILABLE");}
    const originalDescriptor = Object.getOwnPropertyDescriptor(prototype, "writeFile");
    if (!originalDescriptor) {throw new Error("PLAYER_EXTERNAL_FILES_COMPATIBILITY_UNAVAILABLE");}
    const load = Object.getOwnPropertyDescriptor(prototype, "loadExternalFiles");
    if (mount && typeof load?.value !== "function") {throw new Error("PLAYER_EXTERNAL_FILES_COMPATIBILITY_UNAVAILABLE");}
    patched.set(prototype, {write: originalDescriptor, load});
    if (mount) {
      // Both pinned releases call this hook before starting RetroArch. Their
      // downloaders disagree about ZIP extraction and swallow write failures.
      prototype.loadExternalFiles = function () {return mount((path, bytes) => original.call(this, path, bytes));};
    }
    prototype.writeFile = function (path: string, data: unknown) {
      const normalized = Object.prototype.toString.call(data) === "[object ArrayBuffer]"
        ? new Uint8Array(data as ArrayBuffer)
        : data;
      return original.call(this, path, normalized);
    };
  };
  let current = target.EJS_GameManager;
  if (current) {patch(current);}
  Object.defineProperty(target, "EJS_GameManager", {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get: () => current,
    set: (value: ManagerConstructor | undefined) => {
      descriptor?.set?.call(target, value);
      patch(value);
      current = value;
    },
  });
  return () => {
    for (const [prototype, original] of patched) {
      Object.defineProperty(prototype, "writeFile", original.write);
      if (mount && original.load) {Object.defineProperty(prototype, "loadExternalFiles", original.load);}
    }
    if (descriptor) {Object.defineProperty(target, "EJS_GameManager", descriptor);}
    else {Reflect.deleteProperty(target, "EJS_GameManager");}
  };
}
