// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {mountSamCoupe} from "./adapter.js";
import {decodeSamDisk, encodeSamDisk, saveFormat} from "./state.js";

afterEach(() => {vi.restoreAllMocks(); document.body.replaceChildren();});

it("loads the supplied ROM and restored disk, then checkpoints flushed disk writes", async () => {
  const gameSha256 = "a".repeat(64);
  const restored = new Uint8Array([1, 2, 3]);
  const files = new Map<string, Uint8Array>();
  let modified = true;
  const calls: string[] = [];
  const target = document.createElement("div"); document.body.append(target);
  const replace = target.replaceChildren.bind(target);
  vi.spyOn(target, "replaceChildren").mockImplementation((...nodes) => {
    replace(...nodes);
    const child = (nodes[0] as HTMLIFrameElement).contentWindow! as Window & {
      Module?: {FS?: object; ccall?: object; preRun: (() => void)[]; print: (message: string) => void};
    };
    const append = child.document.head.append.bind(child.document.head);
    vi.spyOn(child.document.head, "append").mockImplementation((...nodes) => {
      const fs = {
        mkdir: vi.fn(),
        writeFile: (path: string, bytes: Uint8Array) => {files.set(path, new Uint8Array(bytes));},
        readFile: (path: string) => files.get(path)!,
      };
      const ccall = (name: string) => {
        calls.push(name);
        if (name === "EMS_InsertDisk" || name === "EMS_GetFPS") {return 1;}
        if (name === "EMS_IsDiskModified") {return Number(modified);}
        if (name === "EMS_ClearDiskModified") {modified = false;}
        return 0;
      };
      Object.assign(child.Module!, {FS: fs, ccall});
      child.Module!.preRun[0]();
      child.Module!.print("Main::Init: Success!");
      return append(...nodes);
    });
  });
  const session = {
    open: async (source: {url: string}) => ({id: source.url, close: async () => undefined}),
    materialize: async (id: string) => ({kind: "BYTES" as const,
      bytes: id.endsWith("samcoupe.rom") ? new Uint8Array(32768) : new Uint8Array([9, 9, 9])}),
    closeFile: async () => undefined,
  };
  const adapter = await mountSamCoupe({
    game: {url: "http://localhost/game.mgt", sha256: gameSha256, sizeBytes: 3},
    bios: [{url: "http://localhost/samcoupe.rom", sha256: "b".repeat(64), sizeBytes: 32768,
      logicalName: "samcoupe.rom", virtualPath: "Resource/samcoupe.rom"}],
    runtimeBaseUrl: "http://localhost/assets/samcoupeweb/",
  }, target, window, encodeSamDisk(gameSha256, restored), () => undefined, session as never,
    () => undefined);
  expect(files.get("/Resource/samcoupe.rom")?.byteLength).toBe(32768);
  expect(files.get("/media/game.mgt")).toEqual(restored);
  expect(target.querySelector("iframe")?.contentDocument?.querySelector("canvas")?.id).toBe("canvas");
  expect(calls).toContain("EMS_InsertDisk");
  files.set("/media/game.mgt", new Uint8Array([4, 5, 6]));
  const checkpoint = await adapter.checkpoint();
  expect(checkpoint.format).toBe(saveFormat);
  expect(decodeSamDisk(gameSha256, checkpoint.bytes)).toEqual(new Uint8Array([4, 5, 6]));
  expect(calls).toContain("EMS_FlushDisk");
  await adapter.acknowledgeCheckpoint!(checkpoint);
  expect(adapter.getCheckpointAvailability().available).toBe(false);
  await adapter.exit();
  expect(target.querySelector("iframe")).toBeNull();
});
