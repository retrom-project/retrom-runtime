import {byteAt} from "./fixture-bytes.mjs";
type Reader = {readInto(offset: number, output: Uint8Array): number; close(): void; readonly stats: {lruBytes: number; peakLruBytes: number}};
type Source = {sha256: string; sizeBytes: number};
let resume: (() => void) | undefined, reader: Reader | undefined;
async function trace(source: Source, content: unknown) {
  const contentUrl = "/__test__/ppsspp-content.mjs", discUrl = "/__test__/ppsspp-disc.mjs";
  const {loadContentReader} = await import(contentUrl) as {loadContentReader(source: Source, content: unknown): Promise<Reader>};
  const {discReader} = await import(discUrl) as {discReader(source: Source, reader: Reader): (output: Uint8Array, offset: number, length: number, position: number) => number};
  reader = await loadContentReader(source, content);
  const read = discReader(source, reader);
  let seed = 0x1234abcd;
  const next = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed;};
  for (let index = 0; index < 10000; index++) {
    const length = 1 + next() % 8192, offset = next() % Math.min(source.sizeBytes - length, index % 16 === 0 ? source.sizeBytes : 1048576);
    const bytes = new Uint8Array(length);
    if (read(bytes, 0, length, offset) !== length || bytes.some((value, position) => value !== byteAt(offset + position, 17))) {throw new Error(`TRACE_BYTES:${index}`);}
    bytes.fill(255);
    if ((index + 1) % 250 === 0) {
      const continued = new Promise<void>(resolve => {resume = resolve;});
      postMessage({kind: "snapshot", read: index + 1, l1: reader.stats.lruBytes}); await continued;
    }
  }
  postMessage({kind: "done"});
}
globalThis.onmessage = ({data}) => {
  if (data.kind === "continue") {resume?.(); resume = undefined; return;}
  if (data.kind === "close") {
    let failure = "";
    try {reader!.readInto(0, new Uint8Array(0));} catch (error) {failure = (error as Error).message;}
    reader!.close(); reader!.close(); postMessage({kind: "closed", failure, l1: reader!.stats.lruBytes, l1Peak: reader!.stats.peakLruBytes}); return;
  }
  void trace(data.source, data.content).catch(error => postMessage({kind: "error", message: error.message}));
};
