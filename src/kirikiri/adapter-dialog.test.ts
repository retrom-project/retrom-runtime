import {afterEach, describe, expect, it, vi} from "vitest";
import {config, enableRuntimeFeatures, fakeVlfs, loadCore, loadVlfs, mockDownloads, runtimeScripts, type HostWindow} from "../../tests/kirikiri-adapter-fixture.js";
import {currentWindowHost} from "../../tests/provider-adapter-fixture.js";
import {createRuntime} from "../index.js";
import {KirikiriContent} from "./content.js";

type DialogModule = {onConfirmDialogChanged(active: boolean): void; retromDialogGamepads(): (Gamepad | null)[]; krkr2DisposeDialogs?: () => void};
function setup() {
  enableRuntimeFeatures(); mockDownloads();
  vi.spyOn(KirikiriContent.prototype, "assets").mockResolvedValue({vlfsUrl: "https://runtime.test/vlfs.js", scriptUrl: "https://runtime.test/index.js",
    wasmUrl: "blob:kirikiri-verified-wasm", archive: new Blob([Uint8Array.of(1)])});
  return fakeVlfs();
}
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, "getGamepads");
  delete (window as HostWindow).Module; delete (window as HostWindow).VLFS;
  document.body.replaceChildren(); document.head.querySelectorAll("script[data-runtime=kirikiri2]").forEach(script => script.remove());
});

describe("KiriKiri custom dialog input boundary", () => {
  it("lets a startup dialog receive keyboard input while ordinary startup keys stay blocked", async () => {
    const vlfs = setup(), runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
    await vi.waitFor(() => expect(runtimeScripts()).toHaveLength(2));
    const bridge = (window as HostWindow).Module as unknown as DialogModule;
    const button = document.createElement("button"); document.body.append(button);
    const key = vi.fn(); button.addEventListener("keydown", key);
    button.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    expect(key).not.toHaveBeenCalled();
    bridge.onConfirmDialogChanged(true);
    button.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    expect(key).toHaveBeenCalledOnce();
    bridge.onConfirmDialogChanged(false);
    await loadCore(vlfs); await mounting; await runtime.exit();
  });
  it("gives the modal gamepad input exclusively and respects the Host's input policy", async () => {
    const vlfs = setup();
    const pad = {id: "standard", index: 0, mapping: "standard", connected: true, axes: [0, 0],
      buttons: [{pressed: true, touched: true, value: 1}]} as unknown as Gamepad;
    Object.defineProperty(navigator, "getGamepads", {configurable: true, value: () => [pad]});
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
    const module = await loadCore(vlfs); await mounting;
    const bridge = module as unknown as DialogModule;
    try {
      bridge.onConfirmDialogChanged(true);
      expect(bridge.retromDialogGamepads()[0]?.buttons[0]?.pressed).toBe(true);
      expect((module.retromGamepadSamples as () => Gamepad[])()).toEqual([]);
      await runtime.setInputFilter({activeGamepadIndex: 0, suppressInput: true});
      expect(bridge.retromDialogGamepads()).toEqual([]);
      await runtime.setInputFilter({activeGamepadIndex: 9, suppressInput: false});
      expect(bridge.retromDialogGamepads()).toEqual([]);
      await runtime.setInputFilter(null);
      expect(bridge.retromDialogGamepads()).toHaveLength(1);
      bridge.onConfirmDialogChanged(false);
      expect((module.retromGamepadSamples as () => Gamepad[])()[0]?.buttons[0]?.pressed).toBe(false);
    } finally {await runtime.exit();}
  });
  it("dismisses outstanding dialogs after requesting stop and before waiting for the native stack", async () => {
    const vlfs = setup(), runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
    let release!: () => void;
    const stopping = new Promise<void>(resolve => {release = resolve;});
    const module = await loadCore(vlfs, {stopping}); await mounting;
    const dismiss = vi.fn(release);
    (module as unknown as DialogModule).krkr2DisposeDialogs = dismiss;
    const exiting = runtime.exit();
    await vi.waitFor(() => expect(dismiss).toHaveBeenCalledOnce());
    expect(dismiss).toHaveBeenCalledAfter(module.krkr2StopMainLoop);
    await exiting;
    expect((window as HostWindow).Module).toBeUndefined();
  });
  it("can exit while startup is waiting for the user's answer", async () => {
    const vlfs = setup(), runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div"));
    const rejected = expect(mounting).rejects.toThrow();
    await loadVlfs(vlfs);
    await vi.waitFor(() => expect(runtimeScripts()).toHaveLength(2));
    const options = (window as HostWindow).Module!;
    const postRun = options.postRun!; options.postRun = [];
    const module = await loadCore(vlfs);
    const dismiss = vi.fn(); (module as unknown as DialogModule).krkr2DisposeDialogs = dismiss;
    const exiting = runtime.exit();
    try {await vi.waitFor(() => expect(dismiss).toHaveBeenCalledOnce());}
    finally {for (const callback of postRun) {callback();}}
    await exiting; await rejected;
    expect((window as HostWindow).Module).toBeUndefined();
  });
});
