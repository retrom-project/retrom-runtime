import {expect, it, vi} from "vitest";
import {StartupTasks} from "../../provider/startup.js";
import {installStartupDownloads} from "./startup-downloads.js";
import {deferred} from "../../../tests/provider-adapter-fixture.js";
import type {RuntimeResourceV1} from "../../provider/module-api.js";

it.each(["4.2.3", "4.3.0-pre"])("observes %s preparation and restores upstream methods on cleanup", async release => {
  const pending = deferred<void>(), emit = vi.fn();
  const original = vi.fn((_path?: unknown, _type?: unknown) => pending.promise), instance = {downloadRom: original, downloadFile: original, startGame: original};
  const cleanup = installStartupDownloads(instance, release, new StartupTasks(emit, new AbortController().signal));
  const result = release === "4.2.3" ? instance.downloadRom() : instance.downloadFile("game", "rom");
  expect(emit.mock.calls.at(-1)?.[0].task).toMatchObject({kind: "GAME_CONTENT", state: "RUNNING"});
  expect(emit.mock.calls.at(-1)?.[0].task.summary).toBe(release === "4.2.3" ? true : undefined);
  pending.resolve(); await result;
  expect(emit.mock.calls.at(-1)?.[0].task.state).toBe("COMPLETED");
  cleanup(); expect(instance.downloadFile).toBe(original); expect(instance.startGame).toBe(original);
});

it.each(["4.2.3", "4.3.0-pre"])("marks %s startGame as a summary while keeping actual downloads independent", async release => {
  const emit = vi.fn(), instance = {startGame: vi.fn(async () => {}), downloadFile: vi.fn(async () => 1)};
  const cleanup = installStartupDownloads(instance, release, new StartupTasks(emit, new AbortController().signal));
  await instance.startGame(); await instance.downloadFile();
  expect(emit.mock.calls[0][0].task).toMatchObject({kind: "CORE_INITIALIZATION", summary: true});
  expect(emit.mock.calls[2][0].task.summary).toBeUndefined(); cleanup();
});

it("does not announce absent BIOS and parent files and classifies legacy ROM downloads", async () => {
  const emit = vi.fn(), download = vi.fn(async () => 1);
  const instance = {config: {gameUrl: "rom.bin"}, startGame: download, downloadFile: download, downloadBios: download, downloadGameParent: download};
  installStartupDownloads(instance, "4.2.3", new StartupTasks(emit, new AbortController().signal));
  await instance.downloadBios(); await instance.downloadGameParent();
  expect(emit).not.toHaveBeenCalled();
  await (instance.downloadFile as (...args: unknown[]) => Promise<unknown>)("rom.bin");
  expect(emit.mock.calls.at(-1)?.[0].task).toMatchObject({kind: "GAME_CONTENT", state: "COMPLETED"});
});

it("keeps the upstream error result but marks the task failed", async () => {
  const emit = vi.fn(), instance = {startGame: vi.fn(), downloadFile: vi.fn(async (_path: string, _type: string) => -1)};
  installStartupDownloads(instance, "4.3.0-pre", new StartupTasks(emit, new AbortController().signal));
  expect(await instance.downloadFile("parent.zip", "parent")).toBe(-1);
  expect(emit.mock.calls.at(-1)?.[0].task).toMatchObject({kind: "DEPENDENCIES", state: "FAILED"});
  expect(emit.mock.calls.some(([event]) => event.task.state === "COMPLETED")).toBe(false);
});

it("uses resource identity for external dependencies rather than treating them as core assets", async () => {
  const emit = vi.fn(), instance = {startGame: vi.fn(), downloadFile: vi.fn(async (_path: string, _type: string) => 1)};
  const external = {kind: "EXTERNAL_FILE_SET", files: [{url: "https://game.test/system.bin"}]} as RuntimeResourceV1;
  const cleanup = installStartupDownloads(instance, "4.3.0-pre", new StartupTasks(emit, new AbortController().signal), undefined, [external]);
  await instance.downloadFile("https://game.test/system.bin", "unknown");
  expect(emit.mock.calls.at(-1)?.[0].task).toMatchObject({kind: "DEPENDENCIES", state: "COMPLETED"}); cleanup();
});

it("observes exact 4.2.3 XHR bytes without turning 100 percent into completion", async () => {
  const emit = vi.fn(), pending = deferred<void>(), xhr = new XMLHttpRequest();
  const original = XMLHttpRequest.prototype.open;
  const download = vi.fn(async (_path: unknown) => {xhr.open("GET", "https://game.test/rom"); return pending.promise;});
  const instance = {startGame: vi.fn(), config: {gameUrl: "https://game.test/rom"}, downloadFile: download};
  const cleanup = installStartupDownloads(instance, "4.2.3", new StartupTasks(emit, new AbortController().signal), XMLHttpRequest);
  try {
    const result = instance.downloadFile("https://game.test/rom");
    xhr.dispatchEvent(new ProgressEvent("progress", {loaded: 80, total: 80, lengthComputable: true}));
    expect(emit.mock.calls.at(-1)?.[0].task).toMatchObject({state: "RUNNING", progress: {loadedBytes: 80, totalBytes: 80}});
    pending.resolve(); await result;
    expect(emit.mock.calls.at(-1)?.[0].task.state).toBe("COMPLETED");
  } finally {cleanup();}
  expect(XMLHttpRequest.prototype.open).toBe(original);
});

it("observes exact 4.3 transport bytes and preserves its original progress callback", async () => {
  const emit = vi.fn(), progress = vi.fn(), pending = deferred<void>();
  const downloader = {downloadFile: vi.fn((...args: unknown[]) => {
    (args[5] as (...values: unknown[]) => void)("downloading", 25, 20, 80); return pending.promise;
  })};
  const original = downloader.downloadFile;
  const instance = {startGame: vi.fn(), downloader, downloadFile: vi.fn(async (_path: string, _type: string) =>
    downloader.downloadFile("https://game.test/rom", "rom", "GET", {}, null, progress))};
  const cleanup = installStartupDownloads(instance, "4.3.0-pre", new StartupTasks(emit, new AbortController().signal));
  const result = instance.downloadFile("https://game.test/rom", "rom");
  expect(emit.mock.calls.at(-1)?.[0].task).toMatchObject({state: "RUNNING", progress: {loadedBytes: 20, totalBytes: 80}});
  expect(progress).toHaveBeenCalledWith("downloading", 25, 20, 80);
  pending.resolve(); await result; cleanup(); expect(downloader.downloadFile).toBe(original);
});
