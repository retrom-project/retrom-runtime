import {loadDisc, type DiscCacheOptions} from "./disc-cache.js";

export function loadFlycastDisc(disc: {url: string; sizeBytes: number; sha256: string}, signal: AbortSignal,
  progress: (loaded: number, total: number) => void, options: DiscCacheOptions = {
    directory: async () => (await navigator.storage.getDirectory()).getDirectoryHandle("retrom-flycast-chd-v1", {create: true}),
    fetchBytes: fetch,
  }) {
  return loadDisc(disc, signal, progress, options, "FLYCAST");
}
