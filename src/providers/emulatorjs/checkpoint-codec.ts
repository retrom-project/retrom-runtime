import {PlayerRuntimeError} from "../../provider/errors.js";

const rawFormat = "emulatorjs-state-v1";
const gzipFormat = "emulatorjs-state-gzip-v1";

export async function encodeEmulatorJsCheckpoint(
  bytes: Uint8Array, format: string, maximum: number, signal?: AbortSignal,
) {
  validateSize(bytes, maximum);
  if (format === rawFormat) {return bytes;}
  if (format !== gzipFormat) {throw invalidCheckpoint();}
  return transformCheckpoint(bytes, new CompressionStream("gzip"), maximum, signal);
}

export async function decodeEmulatorJsCheckpoint(
  bytes: Uint8Array, format: string, maximum: number, signal?: AbortSignal,
) {
  validateSize(bytes, maximum);
  if (format === rawFormat) {return bytes;}
  if (format !== gzipFormat) {throw invalidCheckpoint();}
  return transformCheckpoint(bytes, new DecompressionStream("gzip"), maximum, signal);
}

async function transformCheckpoint(
  bytes: Uint8Array, transform: CompressionStream | DecompressionStream, maximum: number, signal?: AbortSignal,
) {
  const input = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(bytes)); controller.close();}});
  const reader = input.pipeThrough(transform, {signal}).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) {break;}
      size += value.byteLength;
      if (size > maximum) {throw invalidCheckpoint();}
      chunks.push(value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {result.set(chunk, offset); offset += chunk.byteLength;}
    validateSize(result, maximum);
    return result;
  } catch (cause) {
    await reader.cancel().catch(() => undefined);
    throw invalidCheckpoint(cause);
  } finally {reader.releaseLock();}
}

function validateSize(bytes: Uint8Array, maximum: number) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || bytes.byteLength < 1 || bytes.byteLength > maximum) {
    throw invalidCheckpoint();
  }
}

function invalidCheckpoint(cause?: unknown) {
  return new PlayerRuntimeError("PLAYER_RUNTIME_CONTRACT_INVALID", {cause});
}
