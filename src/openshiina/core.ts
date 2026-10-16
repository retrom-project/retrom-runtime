export type ShiinaParameters = {runtimeBaseUrl: string; projectIndexUrl: string; contentDigest: string};
export type CorePlayer = {
  info: {width: number; height: number};
  input(kind: number, a: number, b: number, c?: number): void;
  exportSaves(): Promise<Record<string, string>>;
  pause(paused: boolean): void;
  stop(): void;
};
export type CorePlayerOptions = {
  canvas: HTMLCanvasElement;
  files: {path: string; size: number}[];
  saves: Record<string, string>;
  read(path: string, offset: number, count: number, signal?: AbortSignal): Promise<Uint8Array>;
  signal: AbortSignal;
  audioContext: AudioContext;
  audioDestination: AudioNode;
  onSaveFile(name: string, bytes: Uint8Array, deleted: boolean): void;
  onError(error: Error): void;
  onStats(stats: {framesTotal: number}): void;
  onExit(): void;
};
export type CoreModule = {createPlayer(options: CorePlayerOptions): Promise<CorePlayer>};
export type CoreLoader = (url: string) => Promise<CoreModule>;
export const loadCore: CoreLoader = url => import(/* webpackIgnore: true */ url) as Promise<CoreModule>;
