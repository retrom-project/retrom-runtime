import "../../../tests/emulatorjs-content-fixture.js";
import {afterEach, expect, it, vi} from "vitest";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {contentBootstrap, hostFixture} from "../../../tests/provider-adapter-fixture.js";

afterEach(() => {vi.unstubAllGlobals(); document.body.replaceChildren();});
it.each(["fbalpha", "fceumm", "bsnes", "mame2003", "mame2003-plus", "azahar"])("%s hands verified cached archive bytes to the pinned loader", async id => {
  const target = emulatorJsProviderDefinition.targets.find(target => target.id === id)!;
  const {coreAssetPath, coreSha256, coreSizeBytes} = target.implementation;
  const frame = document.createElement("iframe"); document.body.append(frame);
  const win = frame.contentWindow as Window & Record<string, unknown>;
  win.fetch = fetch;
  const revoke = vi.fn(), blob = vi.fn(() => "blob:verified-core");
  vi.stubGlobal("URL", class extends URL {static createObjectURL = blob; static revokeObjectURL = revoke;});
  const envelope = launchEnvelope(); envelope.runtime.targetId = id;
  const player = await createEmulatorJsPlayer(envelope, hostFixture({
    mountFrame: async () => ({contentWindow: win, element: frame, origin: location.origin}),
  }), {[coreAssetPath]: {sha256: coreSha256, sizeBytes: coreSizeBytes}});
  const mounting = player.mount(document.createElement("div")).catch(error => error);
  try {
    await vi.waitFor(() => expect(win.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    const resolved = (win.EJS_paths as Record<string, string>)[coreAssetPath.split("/").at(-1)!];
    if (target.implementation.release === "4.3.0-pre") {
      // This loader treats a Blob as an already extracted file. It needs its HTTP
      // archive name so the ordinary decompression path still runs.
      expect(resolved).toBe(new URL(coreAssetPath, new URL(envelope.runtime.runtimeBaseUrl, location.href)).href);
      expect((await (await win.fetch(resolved)).arrayBuffer()).byteLength).toBe(coreSizeBytes);
    } else {expect(resolved).toBe("blob:verified-core");}
    const session = await contentBootstrap.mock.results.at(-1)!.value;
    expect(session.open).toHaveBeenCalledWith(expect.objectContaining({purpose: "CORE_ASSET",
      identity: {kind: "FILE_SHA256", sha256: coreSha256}, sizeBytes: coreSizeBytes}), expect.anything(), expect.anything());
    if (target.implementation.release === "4.2.3") {expect(blob).toHaveBeenCalledWith(expect.objectContaining({size: coreSizeBytes}));}
  } finally {await player.exit(); await mounting;}
  if (target.implementation.release === "4.2.3") {expect(revoke).toHaveBeenCalledWith("blob:verified-core");}
});
