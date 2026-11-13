import {afterEach, describe, expect, it, vi} from "vitest";
import {config, enableRuntimeFeatures, fakeVlfs, loadCore, loadVlfs, mockDownloads, type HostWindow} from "../../tests/kirikiri-adapter-fixture.js";
import {currentWindowHost} from "../../tests/provider-adapter-fixture.js";
import {createRuntime} from "../index.js";
import {KirikiriContent} from "./content.js";
import * as engineMode from "./engine-mode.js";

function setup() {
  enableRuntimeFeatures(); mockDownloads();
  vi.spyOn(KirikiriContent.prototype, "assets").mockResolvedValue({vlfsUrl: "https://runtime.test/vlfs.js", scriptUrl: "https://runtime.test/index.js",
    wasmUrl: "blob:kirikiri-verified-wasm", archive: new Blob([Uint8Array.of(1)])});
  return fakeVlfs();
}
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete (window as HostWindow).Module; delete (window as HostWindow).VLFS;
  document.body.replaceChildren(); document.head.querySelectorAll("script[data-runtime=kirikiri2]").forEach(script => script.remove());
});
describe("automatic KiriKiri mode at native startup", () => {
  it.each([undefined, "AUTO"])("automatically selects Z before scripts start with mode %s", async mode => {
    const vlfs = setup();
    const detect = vi.spyOn(engineMode, "resolveKirikiriEngineMode").mockResolvedValue("KIRIKIRI_Z");
    const envelope = config(); if (mode) {envelope.targetOptions.engineMode = mode;}
    const runtime = await createRuntime(envelope, currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
    const module = await loadCore(vlfs); await mounting;
    try {
      expect(detect).toHaveBeenCalledWith("AUTO", expect.arrayContaining([expect.objectContaining({path: "data.xp3"})]), expect.objectContaining({aborted: false}));
      expect(module._krkr2_host_set_engine_mode).toHaveBeenCalledExactlyOnceWith(1);
    } finally {await runtime.exit();}
  });
  it("falls back to the original native mode if the automatically detected mode cannot be applied", async () => {
    const vlfs = setup();
    vi.spyOn(engineMode, "resolveKirikiriEngineMode").mockResolvedValue("KIRIKIRI_Z");
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
    const module = await loadCore(vlfs, {engineModeResult: mode => mode === 1 ? -1 : 0}); await mounting;
    try {expect(module._krkr2_host_set_engine_mode.mock.calls).toEqual([[1], [0]]);}
    finally {await runtime.exit();}
  });
  it("retains the original native mode if auto detection finds Z but the core has no setter", async () => {
    const vlfs = setup();
    vi.spyOn(engineMode, "resolveKirikiriEngineMode").mockResolvedValue("KIRIKIRI_Z");
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
    await loadCore(vlfs, {engineModeSupported: false}); await mounting;
    await runtime.exit();
  });
});
