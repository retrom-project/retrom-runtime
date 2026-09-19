import {createContentSession} from "../../src/content-io/client.js";
import {createNeoCDRange} from "../../src/providers/emulatorjs/neocd-range.js";
import {ScummvmFiles} from "../../src/scummvm/files.js";
import {byteAt} from "./fixture-bytes.mjs";
import type {ContentSourceV1} from "../../contracts/content-io/v1/content-io.js";
import type {ContentSessionService} from "../../src/content-io/service.js";
type Stats = ContentSessionService["stats"];

export async function facadeTrace(kind: "neocd" | "scummvm", source: ContentSourceV1) {
  const worker = new Worker("/__test__/worker.mjs", {type: "module"});
  const session = await createContentSession(worker, {storageOrigin: location.origin, allowedOrigins: [location.origin]});
  const snapshots: {read: number; l1: number; service: Stats}[] = [];
  const stats = () => new Promise<Stats>((resolve, reject) => {
    const id = crypto.randomUUID(), timer = setTimeout(() => {worker.removeEventListener("message", listener); reject(new Error("TRACE_STATS_TIMEOUT"));}, 5000);
    const listener = ({data}: MessageEvent) => {if (data.id === id) {clearTimeout(timer); worker.removeEventListener("message", listener); resolve(data.stats);}};
    worker.addEventListener("message", listener); worker.postMessage({type: "TEST_STATS", id});
  });
  try {
    const facade = kind === "neocd" ? createNeoCDRange({sizeBytes: source.sizeBytes, sha256: "a".repeat(64)},
      await session.open(source, {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: 2147483647,
        contentLengthPolicy: "EXACT_IF_PRESENT", workspace: "NONE", writes: "DENY"}), error => {throw error;}) :
      new ScummvmFiles({schemaVersion: 1, files: [{path: "game.bin", sizeBytes: source.sizeBytes, url: source.url}]}, "a".repeat(64), session);
    const read = (offset: number, length: number) => facade instanceof ScummvmFiles ? facade.read("/game/game.bin", offset, length) : facade.read(offset, length);
    snapshots.push({read: 0, l1: session.stats.lruBytes, service: await stats()});
    if (facade instanceof ScummvmFiles && (facade.stat("/game/game.bin") !== source.sizeBytes || facade.list("/game")[0] !== "game.bin")) {throw new Error("TRACE_STAT");}
    let seed = 0x1234abcd, synchronousHits = 0;
    const next = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed;};
    for (let index = 0; index < 10000; index++) {
      const length = 1 + next() % 8192;
      // Every 16th read crosses the 16 MiB cache working set; others revisit a hot 1 MiB region.
      const offset = next() % Math.min(source.sizeBytes - length, index % 16 === 0 ? source.sizeBytes : 1048576);
      const pending = read(offset, length); if (pending instanceof Uint8Array) {synchronousHits++;}
      const bytes = await pending;
      if (bytes.length !== length || bytes.some((value, position) => value !== byteAt(offset + position, 17))) {throw new Error(`TRACE_BYTES:${index}`);}
      bytes.fill(255); // Consumer ownership: mutation must not poison the next read.
      if ((index + 1) % 250 === 0) {snapshots.push({read: index + 1, l1: session.stats.lruBytes, service: await stats()});}
    }
    if (facade instanceof ScummvmFiles) {await facade.close();} else {await facade.dispose();}
    // Separate MessagePorts may deliver the last READ_ACK after CLOSE_FILE.
    let closed = await stats();
    for (let retry = 0; retry < 100 && (closed.pending || closed.temporaryBytes); retry++) {await new Promise(resolve => setTimeout(resolve, 10)); closed = await stats();}
    return {snapshots, synchronousHits, closed, l1Peak: session.blocks.cache.peakByteLength};
  } finally {await session.close();}
}
