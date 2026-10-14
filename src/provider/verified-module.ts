import {abortable, checkSignal} from "../content-io/abort.js";

export type ModuleImporter = (url: string) => Promise<unknown>;
const importModule: ModuleImporter = url => import(/* webpackIgnore: true */ /* @vite-ignore */ url);

/** Self-contained modules consume the verified bytes, never their network URL a second time. */
export async function importVerifiedModule(bytes: Uint8Array, importer: ModuleImporter = importModule, signal?: AbortSignal) {
  checkSignal(signal);
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], {type: "text/javascript"}));
  try {return await abortable(importer(url), signal);}
  finally {URL.revokeObjectURL(url);}
}

/** Evaluate a self-contained module in its canvas/DOM realm without a relative-import registration shim. */
export async function importVerifiedFrameModule(win: Window, bytes: Uint8Array, signal?: AbortSignal): Promise<unknown> {
  if (win === window) {return importVerifiedModule(bytes, undefined, signal);}
  return importVerifiedModule(bytes, url => {
    const key = `__retromModule_${crypto.randomUUID().replaceAll("-", "")}`;
    const realm = win as unknown as Record<string, unknown>;
    const source = `import * as value from ${JSON.stringify(url)}; if (Object.hasOwn(globalThis, ${JSON.stringify(key)})) { globalThis[${JSON.stringify(key)}] = value; }`;
    const wrapper = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
    return new Promise((resolve, reject) => {
      const script = win.document.createElement("script"); script.type = "module"; script.src = wrapper;
      let finished = false;
      const finish = (error?: unknown) => {
        if (finished) {return;}
        finished = true;
        const value = realm[key];
        win.clearTimeout(timer); signal?.removeEventListener("abort", abort);
        script.removeEventListener("error", fail); script.removeEventListener("load", complete); script.remove();
        URL.revokeObjectURL(wrapper); Reflect.deleteProperty(realm, key);
        if (error) {reject(error);} else {resolve(value);}
      };
      const abort = () => finish(new DOMException("Aborted", "AbortError"));
      const fail = () => finish(new Error("PROVIDER_CORE_MODULE_LOAD_FAILED"));
      const complete = () => finish();
      const timer = win.setTimeout(fail, 30000);
      realm[key] = null;
      script.addEventListener("error", fail, {once: true});
      script.addEventListener("load", complete, {once: true});
      signal?.addEventListener("abort", abort, {once: true});
      try {checkSignal(signal); win.document.head.append(script);} catch (error) {finish(error);}
    });
  }, signal);
}
