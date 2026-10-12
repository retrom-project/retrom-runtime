import {afterEach, expect, it, vi} from "vitest";
import {installEmulatorJsNativeDiagnostics} from "./native-diagnostics.js";

afterEach(() => {Reflect.deleteProperty(window, "EJS_Runtime");});
it("collects both native streams for a core without a content receipt while keeping the normal sinks", async () => {
  const original = vi.fn(async (config: {print(message: string): void; printErr(message: string): void}) => {
    config.print("Built for EmulatorJS");
    config.print("[ERROR] Required system.bin not found");
    config.printErr("Fatal error: Required files are missing");
    return {};
  });
  Reflect.set(window, "EJS_Runtime", original);
  const native = installEmulatorJsNativeDiagnostics(window);
  const print = vi.fn(), printErr = vi.fn();
  await Reflect.get(window, "EJS_Runtime")({print, printErr});
  expect(native.messages()).toEqual(["[ERROR] Required system.bin not found", "Fatal error: Required files are missing"]);
  expect(print).toHaveBeenCalledTimes(2); expect(printErr).toHaveBeenCalledOnce();
  native.cleanup(); expect(native.messages()).toEqual([]);
  expect(Reflect.get(window, "EJS_Runtime")).toBe(original);
});

it("never revives native state or evidence when an in-flight factory finishes after cleanup", async () => {
  let finish!: (value: object) => void;
  let print!: (value: string) => void;
  const native = installEmulatorJsNativeDiagnostics(window);
  Reflect.set(window, "EJS_Runtime", (config: {print(message: string): void}) => {
    print = config.print; return new Promise(resolve => {finish = resolve;});
  });
  const loading = Reflect.get(window, "EJS_Runtime")({});
  native.cleanup(); print("[ERROR] late failure"); finish({}); await loading;
  expect(native.module).toBeUndefined(); expect(native.messages()).toEqual([]);
});

it("retains callbacks installed by other native hooks after factory invocation", async () => {
  let received: object | undefined;
  const native = installEmulatorJsNativeDiagnostics(window);
  Reflect.set(window, "EJS_Runtime", async (config: object) => {received = config; return {};});
  const config: {postMainLoop?: () => void} = {};
  await Reflect.get(window, "EJS_Runtime")(config);
  config.postMainLoop = vi.fn();
  expect(received).toBe(config);
  expect(Reflect.get(received!, "postMainLoop")).toBe(config.postMainLoop);
  native.cleanup();
});

it("forwards late factories through an already installed native callback hook", async () => {
  type Factory = (config: {postMainLoop?: () => void}) => Promise<object>;
  let factory: Factory | undefined;
  const callback = vi.fn();
  Object.defineProperty(window, "EJS_Runtime", {configurable: true, get: () => factory, set: (next: Factory) => {
    factory = config => next({...config, postMainLoop: callback});
  }});
  const native = installEmulatorJsNativeDiagnostics(window);
  Reflect.set(window, "EJS_Runtime", async (config: {postMainLoop?: () => void}) => {config.postMainLoop?.(); return {};});
  await Reflect.get(window, "EJS_Runtime")({});
  expect(callback).toHaveBeenCalledOnce();
  native.cleanup();
});
