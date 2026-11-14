import {afterEach, expect, it, vi} from "vitest";
import {createRpgPluginFiles} from "./plugin-files.js";
import {installRpgPluginTextXhr} from "./plugin-text-xhr.js";

const href = new URL("/run/id/Game/www/index.html", location.href).href;
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});
function fixture() {
  const nativeOpen = XMLHttpRequest.prototype.open;
  const open = vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(function(this: XMLHttpRequest, method, url) {
    nativeOpen.call(this, method, url, true);
  });
  const send = vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => {});
  const revoke = vi.fn(), create = vi.fn((_blob: Blob) => "blob:http://localhost/plugin-text");
  vi.stubGlobal("URL", class extends URL {static createObjectURL = create; static revokeObjectURL = revoke;});
  const files = createRpgPluginFiles(href, [{path: "js/plugins/Menu.json", data: new Uint8Array(new TextEncoder().encode('{"title":"开始"}')).buffer}]);
  const cleanup = installRpgPluginTextXhr(window, href, () => files);
  return {open, send, create, revoke, cleanup};
}
it("serves synchronous GET text from verified plugin bytes through native XHR, preserving response URLs", async () => {
  const f = fixture();
  try {
    const xhr = new XMLHttpRequest(), url = new URL("js/plugins/Menu.json?v=1", href).href;
    xhr.open("GET", url, false); xhr.overrideMimeType("application/json"); xhr.send();
    expect(f.open.mock.calls[0].slice(0, 3)).toEqual(["GET", "blob:http://localhost/plugin-text", false]);
    expect(xhr.responseURL).toBe(url);
    const text = await new Promise(resolve => {const reader = new FileReader(); reader.onload = () => resolve(reader.result);
      reader.readAsText(f.create.mock.calls[0][0]);});
    expect(text).toBe('{"title":"开始"}');
    expect(f.send).toHaveBeenCalledOnce(); expect(f.revoke).toHaveBeenCalledOnce();
  } finally {f.cleanup();}
});
it("passes asynchronous, external, missing, engine database and non-GET requests to the native loader", () => {
  const f = fixture();
  try {
    for (const [method, path, async] of [
      ["GET", "js/plugins/Menu.json", true], ["POST", "js/plugins/Menu.json", false],
      ["GET", "https://other.test/js/plugins/Menu.json", false], ["GET", "../js/plugins/Menu.json", false],
      ["GET", "data/System.json", false], ["GET", "js/plugins/missing.json", false],
    ] as const) {
      const url = new URL(path, href).href; new XMLHttpRequest().open(method, url, async);
      expect(f.open.mock.calls.at(-1)?.slice(0, 3)).toEqual([method, url, async]);
    }
    expect(f.create).not.toHaveBeenCalled();
  } finally {f.cleanup();}
});
it("releases text URLs on reopen, abort, failed send and cleanup without changing later asynchronous requests", () => {
  const f = fixture(), prototype = XMLHttpRequest.prototype;
  const url = new URL("js/plugins/Menu.json", href).href, xhr = new XMLHttpRequest();
  xhr.open("GET", url, false); xhr.open("GET", url, true);
  expect(xhr.responseURL).toBe(""); expect(f.revoke).toHaveBeenCalledTimes(1);
  xhr.open("GET", url, false); xhr.abort(); expect(f.revoke).toHaveBeenCalledTimes(2);
  xhr.open("GET", url, false); f.send.mockImplementationOnce(() => {throw new Error("SEND_FAILED");});
  expect(() => xhr.send()).toThrow("SEND_FAILED"); expect(f.revoke).toHaveBeenCalledTimes(3);
  xhr.open("GET", url, false); f.cleanup(); expect(f.revoke).toHaveBeenCalledTimes(4);
  expect(prototype.open).toBe(f.open); expect(prototype.send).toBe(f.send);
});
