// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {gzipSync} from "fflate";
import {mountApple2} from "./adapter.js";

afterEach(() => {vi.restoreAllMocks(); document.body.replaceChildren();});

it.each([
  ["apple2js-state-v1-storage-v1", false],
  ["apple2js-state-gzip-v1-storage-v1", true],
] as const)("writes raw state and restores %s", async (format, legacy) => {
  const outer = document.createElement("iframe"); document.body.append(outer);
  const frameWindow = outer.contentWindow!;
  const target = frameWindow.document.createElement("div"); frameWindow.document.body.append(target);
  const bios = [
    {logicalName: "AppleIIe.rom", virtualPath: "roms/AppleIIe.rom", sizeBytes: 16384},
    {logicalName: "apple2e-character.rom", virtualPath: "roms/apple2e-character.rom", sizeBytes: 4096},
    {logicalName: "AppleIIe_DiskII.rom", virtualPath: "roms/AppleIIe_DiskII.rom", sizeBytes: 256},
  ].map(file => ({...file, url: `https://example.test/${file.logicalName}`, sha256: "a".repeat(64)}));
  const session = {
    open: async (source: {url: string; sizeBytes: number}) => ({id: source.url,
      close: async () => undefined}),
    materialize: async (id: string) => ({kind: "BYTES" as const,
      bytes: new Uint8Array(bios.find(file => file.url === id)?.sizeBytes ?? 3)}),
  };
  const state = "{\"ram\":[1,2,3]}";
  const mounted = mountApple2({game: {url: "https://example.test/game.dsk", sha256: "b".repeat(64), sizeBytes: 3},
    bios, runtimeBaseUrl: "https://example.test/apple2js/site/"}, target, frameWindow,
    legacy ? gzipSync(new TextEncoder().encode(state)) : new TextEncoder().encode(state),
    () => undefined, session as never, undefined, format);
  await vi.waitFor(() => expect(target.querySelector("iframe")).not.toBeNull());
  const iframe = target.querySelector("iframe")!;
  const child = iframe.contentWindow as Window & {RetromApple2?: object};
  const canvas = child.document.createElement("canvas"); canvas.id = "screen";
  (child.document.body ?? child.document.documentElement ?? child.document).append(canvas);
  const restore = vi.fn(); const exit = vi.fn();
  child.RetromApple2 = {mount: async () => ({checkpoint: () => state, restore, exit,
    pause: () => undefined, resume: () => undefined})};
  const adapter = await mounted;
  expect(restore).toHaveBeenCalledWith(state);
  expect(await adapter.checkpoint()).toEqual({format: "apple2js-state-v1", bytes: new TextEncoder().encode(state)});
  const buttons = Array.from({length: 17}, () => ({pressed: false, value: 0}));
  const getGamepads = vi.fn(() => [{connected: true, index: 0, axes: [], buttons}]);
  Object.defineProperty(child.navigator, "getGamepads", {configurable: true, value: getGamepads});
  const diagnostics = adapter.startInputDiagnostics?.();
  expect(diagnostics?.read().gamepad).toBe(true);
  buttons[8] = {pressed: true, value: 1};
  child.navigator.getGamepads();
  expect(diagnostics?.read().events).toEqual(expect.arrayContaining([
    expect.objectContaining({device: "gamepad:0", control: "Button 8", value: 1, stage: "RUNTIME"}),
  ]));
  diagnostics?.stop();
  expect(child.navigator.getGamepads).toBe(getGamepads);
  await adapter.exit();
  expect(exit).toHaveBeenCalledOnce();
});
