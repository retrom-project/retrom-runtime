import {afterEach, expect, it, vi} from "vitest";
import {adapterFixture, deferred, hostFixture} from "../../../tests/provider-adapter-fixture.js";
import {rpgMvEnvelope} from "../../../tests/provider-fixtures.js";
import {ProviderContentOwner} from "../../provider/content-owner.js";
import {createRuntime} from "./module.js";
import {mountTargetAdapter} from "./target-adapter.js";
vi.mock("./target-adapter.js", () => ({mountTargetAdapter: vi.fn()}));
afterEach(() => {document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers();});
it("consumes a short-lived native ticket before a long preload without starting game code", async () => {
  const frame = document.createElement("iframe"); document.body.append(frame);
  const realm = frame.contentWindow!;
  vi.spyOn(window, "focus").mockImplementation(() => {});
  const post = vi.spyOn(realm, "postMessage").mockImplementation(() => {});
  const prepared = deferred<null>();
  const prepare = vi.spyOn(ProviderContentOwner.prototype, "start").mockReturnValue(prepared.promise);
  vi.mocked(mountTargetAdapter).mockResolvedValue(adapterFixture());
  const player = await createRuntime(rpgMvEnvelope(), hostFixture({contentLoading: "PRELOAD",
    mountFrame: async () => ({element: frame, contentWindow: realm, origin: "https://runtime.test"})}));
  const mounting = player.mount(document.createElement("div"));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(prepare).not.toHaveBeenCalled();
  const send = (type: string) => window.dispatchEvent(new MessageEvent("message", {
    source: realm, origin: "https://runtime.test", data: {type, protocolVersion: 1, v: 1},
  }));
  send("RPG_RUNTIME_NATIVE_BOOTSTRAP_READY");
  expect(post).toHaveBeenCalledWith({type: "RPG_RUNTIME_NATIVE_BOOTSTRAP", protocolVersion: 1, ticket: "t".repeat(48)}, "https://runtime.test");
  send("RETROM_WEB_CONTENT_WAITING");
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  vi.useFakeTimers(); await vi.advanceTimersByTimeAsync(90000);
  expect(mountTargetAdapter).not.toHaveBeenCalled();
  prepared.resolve(null); await mounting; await player.exit();
});
