import {PlayerRuntimeError} from "./errors.js";

export function checkpointSize(bytes: Uint8Array, maximum: number) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || bytes.byteLength < 1 || bytes.byteLength > maximum) {
    throw checkpointError();
  }
}
export function checkpointError(cause?: unknown) {
  return new PlayerRuntimeError("PLAYER_RUNTIME_CONTRACT_INVALID", {cause});
}
export async function transformCheckpoint(bytes: Uint8Array, decompress: boolean, maximum: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const transform = decompress ? new DecompressionStream("gzip") : new CompressionStream("gzip");
  const input = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(bytes)); controller.close();}});
  const reader = input.pipeThrough(transform, {signal}).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) {break;}
      size += value.byteLength;
      if (size > maximum) {throw checkpointError();}
      chunks.push(value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {result.set(chunk, offset); offset += chunk.byteLength;}
    checkpointSize(result, maximum); signal?.throwIfAborted();
    return result;
  } catch (cause) {
    await reader.cancel().catch(() => undefined);
    signal?.throwIfAborted();
    throw checkpointError(cause);
  } finally {reader.releaseLock();}
}
