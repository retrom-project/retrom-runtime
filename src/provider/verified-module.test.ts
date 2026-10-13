import {afterEach, expect, it, vi} from "vitest";
import {importVerifiedFrameModule, importVerifiedModule} from "./verified-module.js";
import {deferred} from "../../tests/provider-adapter-fixture.js";
const source = new TextEncoder().encode("export const answer = 42;");
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();});
function urls() {
  let count = 0; const create = vi.fn(() => `blob:verified-${++count}`), revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL {static createObjectURL = create; static revokeObjectURL = revoke;});
  return {create, revoke};
}
it("imports verified bytes once and revokes executable handles on success or failure", async () => {
  const u = urls(), load = vi.fn(async () => ({answer: 42}));
  expect(await importVerifiedModule(source, load)).toEqual({answer: 42});
  expect(load).toHaveBeenCalledExactlyOnceWith("blob:verified-1");
  expect(u.create).toHaveBeenCalledWith(expect.objectContaining({size: source.length, type: "text/javascript"}));
  expect(u.revoke).toHaveBeenCalledExactlyOnceWith("blob:verified-1");
  await expect(importVerifiedModule(source, async () => {throw new Error("module invalid");})).rejects.toThrow("module invalid");
  expect(u.revoke).toHaveBeenCalledWith("blob:verified-2");
});
it("aborts a pending import without retaining its object URL", async () => {
  const u = urls(), abort = new AbortController(), pending = deferred<unknown>();
  const imported = importVerifiedModule(source, () => pending.promise, abort.signal);
  abort.abort(); await expect(imported).rejects.toThrow();
  expect(u.revoke).toHaveBeenCalledExactlyOnceWith("blob:verified-1");
  pending.resolve({});
});
it("cleans up both frame module handles when appending a script fails", async () => {
  const u = urls(), frame = document.createElement("iframe"); document.body.append(frame);
  vi.spyOn(frame.contentDocument!.head, "append").mockImplementation(() => {throw new Error("append failed");});
  await expect(importVerifiedFrameModule(frame.contentWindow!, source)).rejects.toThrow("append failed");
  expect(u.revoke.mock.calls.flat().sort()).toEqual(["blob:verified-1", "blob:verified-2"]);
  expect(Object.keys(frame.contentWindow!).filter(key => key.startsWith("__retromModule_"))).toEqual([]);
});
it("ignores late script events after cancellation", async () => {
  const u = urls(), frame = document.createElement("iframe"); document.body.append(frame);
  const abort = new AbortController(), imported = importVerifiedFrameModule(frame.contentWindow!, source, abort.signal);
  const script = frame.contentDocument!.querySelector("script")!;
  abort.abort(); await expect(imported).rejects.toThrow();
  script.dispatchEvent(new Event("load"));
  expect(u.revoke).toHaveBeenCalledTimes(2);
  expect(frame.contentDocument!.querySelector("script")).toBeNull();
});
