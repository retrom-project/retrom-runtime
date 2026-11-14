import type {createRpgPluginFiles} from "./plugin-files.js";
import {isRpgPluginTextPath} from "../runtime/rpg-plugin-paths.js";

/** Chrome bypasses service workers for synchronous XHR; reuse verified, bounded plugin text. */
export function installRpgPluginTextXhr(realm: Window & typeof globalThis, href: string,
  files: () => ReturnType<typeof createRpgPluginFiles> | null): () => void {
  if (!realm.XMLHttpRequest) {return () => {};}
  const prototype = realm.XMLHttpRequest.prototype, {open, send, abort} = prototype;
  const root = new URL(".", href), active = new Set<string>(), pending = new WeakMap<XMLHttpRequest, string>();
  const responses = new WeakMap<XMLHttpRequest, PropertyDescriptor | undefined>();
  const release = (xhr: XMLHttpRequest) => {
    const url = pending.get(xhr);
    if (url) {realm.URL.revokeObjectURL(url); active.delete(url); pending.delete(xhr);}
  };
  function text(input: string | URL) {
    const url = new URL(input, href);
    if (url.origin !== root.origin || url.username || url.password || !url.pathname.startsWith(root.pathname)) {return null;}
    let path;
    try {path = decodeURIComponent(url.pathname.slice(root.pathname.length));} catch {return null;}
    if (!isRpgPluginTextPath(path)) {return null;}
    const content = files();
    if (!content) {throw new Error("RPG_PLUGIN_FILES_NOT_READY");}
    if (!content.fs.existsSync(path)) {return null;}
    url.hash = "";
    return {url: url.href, bytes: content.fs.readFileSync(path) as Uint8Array<ArrayBuffer>,
      type: /\.json$/iu.test(path) ? "application/json" : "text/plain;charset=utf-8"};
  }
  const wrappedOpen: typeof open = function(this: XMLHttpRequest, method: string, url: string | URL,
    async: boolean = true, username?: string | null, password?: string | null) {
    release(this);
    if (responses.has(this)) {
      const previous = responses.get(this);
      if (previous) {Object.defineProperty(this, "responseURL", previous);} else {Reflect.deleteProperty(this, "responseURL");}
      responses.delete(this);
    }
    const content = !async && method.toUpperCase() === "GET" ? text(url) : null;
    if (!content) {return open.call(this, method, url, async, username, password);}
    const blob = realm.URL.createObjectURL(new realm.Blob([content.bytes], {type: content.type}));
    active.add(blob); pending.set(this, blob);
    try {
      open.call(this, method, blob, false, username, password);
      responses.set(this, Object.getOwnPropertyDescriptor(this, "responseURL"));
      Object.defineProperty(this, "responseURL", {configurable: true, get: () => content.url});
    } catch (error) {release(this); throw error;}
  };
  const wrappedSend: typeof send = function(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    try {return send.call(this, body);} finally {release(this);}
  };
  const wrappedAbort: typeof abort = function(this: XMLHttpRequest) {try {return abort.call(this);} finally {release(this);}};
  prototype.open = wrappedOpen; prototype.send = wrappedSend; prototype.abort = wrappedAbort;
  return () => {
    for (const url of active) {realm.URL.revokeObjectURL(url);} active.clear();
    if (prototype.open === wrappedOpen) {prototype.open = open;}
    if (prototype.send === wrappedSend) {prototype.send = send;}
    if (prototype.abort === wrappedAbort) {prototype.abort = abort;}
  };
}
