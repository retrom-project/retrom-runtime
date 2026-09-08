/** Indexes and core manifests are small metadata, never unbounded response bodies. */
export async function scummvmJson(url: string, maximum: number, signal: AbortSignal, code: string): Promise<unknown> {
  const response = await fetch(url, {signal});
  if (!response.ok || !response.body) {throw new Error(code);}
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) {break;}
      if (value.length > maximum - size) {throw new Error(code);}
      chunks.push(value); size += value.length;
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
    try {return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));} catch {throw new Error(code);}
  } finally {await reader.cancel().catch(() => undefined); reader.releaseLock();}
}
