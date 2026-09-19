import {readExact} from "../bounded-stream.js";
import {fail} from "../errors.js";
import {integer} from "../source.js";
import {validLocation} from "./opfs.js";
import {namespace, type BlockReceipt, type DataStore} from "./types.js";
export class CacheBlockStore implements DataStore {
  readonly backend = "CACHE_BLOCKS" as const;
  constructor(private readonly cache: Cache, private readonly origin: string) {}
  static async open(origin: string): Promise<CacheBlockStore> {return new CacheBlockStore(await caches.open(namespace), origin);}
  location(key: string, generation: string, index: number): string {
    validLocation(key, generation); if (!integer(index)) {fail("CACHE_UNAVAILABLE");}
    return `${this.origin}/__retrom_content_io_v1__/block/${key}/${generation}/${index}`;
  }
  async read(receipt: BlockReceipt): Promise<Uint8Array<ArrayBuffer>> {
    const response = await this.cache.match(this.location(receipt.objectKey, receipt.generation, receipt.index));
    if (!response || response.status !== 200 || response.headers.get("x-content-io-version") !== "1" ||
      response.headers.get("x-content-io-sha256") !== receipt.localSha256 || response.headers.get("content-length") !== String(receipt.length)) {fail("CACHE_UNAVAILABLE");}
    return readExact(response.body, receipt.length);
  }
  async write(receipt: BlockReceipt, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    await this.cache.put(this.location(receipt.objectKey, receipt.generation, receipt.index), new Response(bytes, {status: 200, headers: {
      "content-type": "application/octet-stream", "content-length": String(bytes.length), "x-content-io-version": "1", "x-content-io-sha256": receipt.localSha256,
      "x-content-io-object": receipt.objectKey, "x-content-io-generation": receipt.generation}}));
  }
  async remove(key: string, generations: readonly string[]): Promise<void> {
    for (const generation of generations) {
      const prefix = this.location(key, generation, 0).replace(/0$/u, "");
      for (const request of await this.cache.keys()) {if (request.url.startsWith(prefix)) {await this.cache.delete(request);}}
    }
  }
  async probe(): Promise<void> {
    const url = `${this.origin}/__retrom_content_io_v1__/probe/${crypto.randomUUID()}`;
    try {
      await this.cache.put(url, new Response(new Uint8Array([17]), {status: 200}));
      const response = await this.cache.match(url);
      if (!response || (await readExact(response.body, 1))[0] !== 17) {fail("CACHE_UNAVAILABLE");}
    } finally {await this.cache.delete(url).catch(() => false);}
  }
}
