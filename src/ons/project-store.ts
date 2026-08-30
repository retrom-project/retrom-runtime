const projectStoreName = "retrom-runtime-ons-project-v1";

export type OnsProjectStore = {
  delete(url: string): Promise<void>;
  match(url: string): Promise<Response | null>;
  put(url: string, bytes: Uint8Array): Promise<void>;
};

export async function openOnsProjectStore(frameWindow: Window): Promise<OnsProjectStore | null> {
  const opfs = await openOriginPrivateStore(frameWindow);
  if (opfs) {return opfs;}
  try {
    if (!frameWindow.caches) {return null;}
    return new CacheProjectStore(await frameWindow.caches.open(projectStoreName));
  } catch {return null;}
}

class CacheProjectStore implements OnsProjectStore {
  constructor(private readonly cache: Cache) {}

  async delete(url: string) {await this.cache.delete(url);}
  async match(url: string) {
    const response = await this.cache.match(url);
    return response?.ok ? response : null;
  }
  async put(url: string, bytes: Uint8Array) {
    await this.cache.put(url, new Response(bytes.slice()));
  }
}

class OriginPrivateProjectStore implements OnsProjectStore {
  constructor(private readonly directory: FileSystemDirectoryHandle, private readonly crypto: Crypto) {}

  async delete(url: string) {
    try {await this.directory.removeEntry(await cacheKey(url, this.crypto));} catch {return;}
  }

  async match(url: string) {
    try {
      const handle = await this.directory.getFileHandle(await cacheKey(url, this.crypto));
      return new Response(await handle.getFile());
    } catch {return null;}
  }

  async put(url: string, bytes: Uint8Array) {
    const key = await cacheKey(url, this.crypto);
    const handle = await this.directory.getFileHandle(key, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(arrayBufferView(bytes));
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      await this.directory.removeEntry(key).catch(() => undefined);
      throw error;
    }
  }
}

async function openOriginPrivateStore(frameWindow: Window) {
  const storage = frameWindow.navigator.storage;
  if (typeof storage?.getDirectory !== "function" || !frameWindow.crypto?.subtle) {return null;}
  try {
    const root = await storage.getDirectory();
    const directory = await root.getDirectoryHandle(projectStoreName, { create: true });
    return new OriginPrivateProjectStore(directory, frameWindow.crypto);
  } catch {return null;}
}

async function cacheKey(url: string, crypto: Crypto) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url)));
  return `${Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("")}.bin`;
}

function arrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}
