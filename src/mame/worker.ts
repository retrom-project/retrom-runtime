import type {MameWorkerState} from "./worker-state.js";
import type {MameCore} from "./core.js";
import type {ContentSessionClient} from "../content-io/client.js";
import type {MameMediaFS, mountMameMedia} from "./media-fs.js";

export type MameWorkerBoot = {code: Uint8Array; wasm: Uint8Array; family: Uint8Array; build: string; assetBaseURL: string;
  files: {path: string; bytes: Uint8Array}[]; canvas: OffscreenCanvas; syncClientURL: string;
  media: {path: string; size: number; channel: Awaited<ReturnType<ContentSessionClient["createSyncChannel"]>>}[];
  restore: MameWorkerState | null; maxStateBytes: number};
export type MameFrame = {audio: Int16Array[]; fps: number; rate: number; aspect: number; checkpointSize: number};
export type MameInputEvent = ["_retrom_mame_key" | "_retrom_mame_button" | "_retrom_mame_axis", number, number];

/** Only this self-contained function is serialized into the worker; it has no network or Host API access. */
export function runMameWorker(mountMedia: typeof mountMameMedia) {
  const scope = globalThis as unknown as {onmessage: (event: MessageEvent) => void; postMessage(value: unknown, transfer?: Transferable[]): void};
  let core: MameCore | undefined, canvas: OffscreenCanvas, graphics: OffscreenCanvasRenderingContext2D,
    bitmap: ImageData | undefined, maxState = 0;
  const readers: {close(): void}[] = [], messages: string[] = [];
  const record = (message: string) => {messages.push(message.slice(0, 512)); if (messages.length > 20) {messages.shift();}};
  const memory = <T>(size: number, use: (pointer: number) => T): T => {
    const native = core!, pointer = native._malloc(size);
    if (!pointer || pointer + size > native.HEAPU8.length) {throw new Error("MAME_ALLOCATION_FAILED");}
    try {return use(pointer);} finally {native._free(pointer);}
  };
  const draw = () => {
    const native = core!, width = native._retrom_mame_width(), height = native._retrom_mame_height(), pointer = native._retrom_mame_pixels();
    if (!width || !height) {return;}
    if (![width, height, pointer].every(Number.isInteger) || width < 1 || height < 1 || width > 4096 || height > 4096 ||
      pointer < 1 || pointer + width * height * 4 > native.HEAPU8.length) {throw new Error("MAME_FRAME_INVALID");}
    if (!bitmap || canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height; bitmap = graphics.createImageData(width, height);
    }
    for (let index = 0; index < bitmap.data.length; index += 4) {
      bitmap.data[index] = native.HEAPU8[pointer + index + 2]; bitmap.data[index + 1] = native.HEAPU8[pointer + index + 1];
      bitmap.data[index + 2] = native.HEAPU8[pointer + index]; bitmap.data[index + 3] = 255;
    }
    graphics.putImageData(bitmap, 0, 0);
  };
  const sessionFiles = () => {
    const fs = core!.FS as MameCore["FS"] & {readdir(path: string): string[]; stat(path: string): {mode: number; size: number};
      isDir(mode: number): boolean; isFile(mode: number): boolean; readFile(path: string): Uint8Array};
    const files: {path: string; size: number}[] = []; let total = 256;
    const visit = (path: string, depth: number) => {
      if (depth > 8) {throw new Error("MAME_CHECKPOINT_UNAVAILABLE");}
      for (const name of fs.readdir(`/content/session/${path}`)) {
        if (name === "." || name === "..") {continue;}
        const relative = `${path}/${name}`, info = fs.stat(`/content/session/${relative}`);
        if (fs.isDir(info.mode)) {visit(relative, depth + 1);}
        else {
          total += info.size + relative.length * 2 + 128;
          if (!fs.isFile(info.mode) || files.length >= 128 || total > maxState) {throw new Error("MAME_CHECKPOINT_UNAVAILABLE");}
          files.push({path: relative, size: info.size});
        }
      }
    };
    visit("diff", 0); visit("nvram", 0); return {fs, files, total};
  };
  const saveSize = () => {
    const native = core!._retrom_mame_save_size();
    if (!native) {return 0;}
    try {const size = native + sessionFiles().total; return size <= maxState ? size : 0;} catch {return 0;}
  };
  const frame = (audio: Int16Array[] = []): MameFrame => ({audio, fps: core!._retrom_mame_fps(), rate: core!._retrom_mame_sample_rate(),
    aspect: core!._retrom_mame_aspect_ratio(), checkpointSize: saveSize()});
  const boot = async (input: MameWorkerBoot) => {
    const codeURL = URL.createObjectURL(new Blob([Uint8Array.from(input.code)], {type: "text/javascript"}));
    const familyURL = URL.createObjectURL(new Blob([Uint8Array.from(input.family)], {type: "application/wasm"}));
    try {
      const module = await import(/* webpackIgnore: true */ /* @vite-ignore */ codeURL);
      core = await module.default({wasmBinary: input.wasm, locateFile: (name: string) => new URL(name, input.assetBaseURL).href,
        print: record, printErr: record}) as MameCore;
      if (core._retrom_mame_abi() !== 1 || core.UTF8ToString(core._retrom_mame_build_id()) !== input.build) {throw new Error("MAME_CORE_ABI_MISMATCH");}
      await core.loadDynamicLibrary(familyURL, {global: true, nodelete: true, loadAsync: true});
      if (core._retrom_mame_attach() !== 0) {throw new Error("MAME_CORE_ABI_MISMATCH");}
      for (const file of input.files) {
        core.FS.mkdirTree(file.path.slice(0, file.path.lastIndexOf("/"))); core.FS.writeFile(file.path, file.bytes);
      }
      for (const directory of ["diff", "nvram"]) {core.FS.mkdirTree(`/content/session/${directory}`);}
      for (const file of input.restore?.files ?? []) {
        const path = `/content/session/${file.path}`;
        core.FS.mkdirTree(path.slice(0, path.lastIndexOf("/"))); core.FS.writeFile(path, file.bytes);
      }
      const sync = await import(/* webpackIgnore: true */ /* @vite-ignore */ input.syncClientURL);
      for (const media of input.media) {
        const reader = sync.createSyncContentReader(media.channel) as {readInto(offset: number, bytes: Uint8Array): number; close(): void};
        readers.push(reader); mountMedia(core.FS as unknown as MameMediaFS, media.path, media.size, reader);
      }
      canvas = input.canvas;
      const context = canvas.getContext("2d", {alpha: false});
      if (!context) {throw new Error("MAME_CANVAS_UNAVAILABLE");} graphics = context; maxState = input.maxStateBytes;
      const command = new TextEncoder().encode("/content/boot.cmd\0");
      const started = memory(command.length, pointer => {core!.HEAPU8.set(command, pointer); return core!._retrom_mame_start(pointer);});
      if (started !== 1) {throw new Error("MAME_BOOT_FAILED");}
      if (input.restore) {
        const restored = memory(input.restore.native.length, pointer => {
          core!.HEAPU8.set(input.restore!.native, pointer); return core!._retrom_mame_restore(pointer, input.restore!.native.length);
        });
        if (restored !== 1) {throw new Error("MAME_CHECKPOINT_RESTORE_FAILED");}
      }
      draw(); return frame();
    } finally {URL.revokeObjectURL(codeURL); URL.revokeObjectURL(familyURL);}
  };
  const step = (input: {events: MameInputEvent[]; count: number}) => {
    if (!Number.isInteger(input.count) || input.count < 0 || input.count > 6 || input.events.length > 256) {throw new Error("MAME_INPUT_INVALID");}
    for (const [method, id, value] of input.events) {core![method](id, value);}
    const audio: Int16Array[] = [];
    for (let index = 0; index < input.count; index++) {
      if (core!._retrom_mame_step() !== 1) {throw new Error("MAME_EXECUTION_STOPPED");}
      const length = core!._retrom_mame_audio_count(), offset = core!._retrom_mame_audio() / 2;
      if (!Number.isInteger(length) || length < 0 || length > 8192 || length % 2 || !Number.isInteger(offset) ||
        offset < 0 || offset + length > core!.HEAP16.length) {throw new Error("MAME_AUDIO_INVALID");}
      if (length) {audio.push(core!.HEAP16.slice(offset, offset + length));}
    }
    draw(); return frame(audio);
  };
  const save = () => {
    const size = core!._retrom_mame_save_size();
    if (size < 1 || size > maxState) {throw new Error("MAME_CHECKPOINT_UNAVAILABLE");}
    const native = memory(size, pointer => {
      if (core!._retrom_mame_save(pointer, size) !== 1) {throw new Error("MAME_CHECKPOINT_UNAVAILABLE");}
      return core!.HEAPU8.slice(pointer, pointer + size);
    });
    const snapshot = sessionFiles();
    if (size + snapshot.total > maxState) {throw new Error("MAME_CHECKPOINT_UNAVAILABLE");}
    return {native, files: snapshot.files.map(file => ({path: file.path, bytes: snapshot.fs.readFile(`/content/session/${file.path}`)}))};
  };
  const stop = () => {core?._retrom_mame_stop(); for (const reader of readers.splice(0)) {reader.close();} core = undefined;};
  let pending = Promise.resolve();
  scope.onmessage = ({data}: MessageEvent<{id: number; command: string; payload: unknown}>) => {
    pending = pending.then(async () => {
      try {
        const result = data.command === "BOOT" ? await boot(data.payload as MameWorkerBoot) : data.command === "STEP"
          ? step(data.payload as {events: MameInputEvent[]; count: number}) : data.command === "SAVE" ? save() : stop();
        const transfer = result && "native" in result ? [result.native.buffer, ...result.files.map(file => file.bytes.buffer)] :
          result ? result.audio.map(bytes => bytes.buffer) : [];
        scope.postMessage({id: data.id, result}, transfer as ArrayBuffer[]);
      } catch (error) {
        scope.postMessage({id: data.id, error: error instanceof Error ? error.message : "MAME_WORKER_FAILED", messages});
      }
    });
  };
}
