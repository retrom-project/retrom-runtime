type Frontend = {prototype: {requiresWebGL2: (core: string) => boolean}};

/** The upstream frontend has no Flycast entry in its WebGL2 selection list. */
export function installFlycastCompatibility(runtimeWindow: Window) {
  const target = runtimeWindow as Window & {EmulatorJS?: Frontend};
  const previous = Object.getOwnPropertyDescriptor(target, "EmulatorJS");
  const restorations: Array<() => void> = [retainDisplayedFrame(runtimeWindow)];
  let current = target.EmulatorJS;
  const configure = (frontend: Frontend | undefined) => {
    if (!frontend) {return;}
    const original = frontend.prototype.requiresWebGL2;
    frontend.prototype.requiresWebGL2 = function (core) {
      return core === "flycast" || original.call(this, core);
    };
    restorations.push(() => {frontend.prototype.requiresWebGL2 = original;});
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

// Capture can run after pause and after the browser has presented the last frame.
// Retain this iframe's drawing buffer so the canvas fallback reads that frame.
function retainDisplayedFrame(runtimeWindow: Window) {
  const prototype = (runtimeWindow as Window & typeof globalThis).HTMLCanvasElement.prototype;
  const previous = Object.getOwnPropertyDescriptor(prototype, "getContext")!;
  const getContext = prototype.getContext;
  Object.defineProperty(prototype, "getContext", {
    ...previous,
    value(this: HTMLCanvasElement, kind: string, options?: unknown) {
      const webgl = kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl";
      const attributes = options && typeof options === "object" ? options : {};
      return Reflect.apply(getContext, this, [kind, webgl ? {...attributes, preserveDrawingBuffer: true} : options]);
    },
  });
  return () => Object.defineProperty(prototype, "getContext", previous);
}
