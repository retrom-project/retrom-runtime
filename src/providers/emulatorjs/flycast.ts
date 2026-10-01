type FrontendInstance = {
  config?: {gameUrl?: string};
  getCore?: () => string;
  localization?: (message: string) => string;
};
type Frontend = {prototype: FrontendInstance & {
  requiresWebGL2: (core: string) => boolean;
  checkCompression?: (data: Uint8Array, message: string,
    callback?: (name: string, bytes: Uint8Array) => void) => Promise<unknown>;
}};

/** The upstream frontend has no Flycast entry in its WebGL2 selection list. */
export function installFlycastCompatibility(runtimeWindow: Window) {
  const target = runtimeWindow as Window & {EmulatorJS?: Frontend};
  const previous = Object.getOwnPropertyDescriptor(target, "EmulatorJS");
  const restorations: Array<() => void> = [];
  let current = target.EmulatorJS;
  const configure = (frontend: Frontend | undefined) => {
    if (!frontend) {return;}
    const original = frontend.prototype.requiresWebGL2;
    frontend.prototype.requiresWebGL2 = function (core) {
      return core === "flycast" || original.call(this, core);
    };
    restorations.push(() => {frontend.prototype.requiresWebGL2 = original;});
    const originalCompression = frontend.prototype.checkCompression;
    if (originalCompression) {
      frontend.prototype.checkCompression = function (data, message, callback) {
        if (typeof callback === "function" && this.getCore?.() === "flycast" &&
          typeof this.config?.gameUrl === "string" && /\.zip$/iu.test(this.config.gameUrl) &&
          message === this.localization?.("Decompress Game Data")) {
          callback("!!notCompressedData", data);
          return Promise.resolve({});
        }
        return originalCompression.call(this, data, message, callback);
      };
      restorations.push(() => {frontend.prototype.checkCompression = originalCompression;});
    }
  };
  configure(current);
  Object.defineProperty(target, "EmulatorJS", {
    configurable: true, enumerable: true,
    get: () => current,
    set: (value: Frontend | undefined) => {current = value; configure(value);},
  });
  return () => {
    for (const restore of restorations.reverse()) {restore();}
    if (previous) {Object.defineProperty(target, "EmulatorJS", previous);}
    else if (current) {
      Object.defineProperty(target, "EmulatorJS", {configurable: true, writable: true, value: current});
    } else {Reflect.deleteProperty(target, "EmulatorJS");}
  };
}
