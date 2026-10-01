/** Keep the presented frame readable when screenshot capture runs after pause. */
export function retainEmulatorJsDisplayedFrame(runtimeWindow: Window) {
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
