export type KirikiriJspi = typeof WebAssembly & {
  Suspending: new (implementation: () => unknown) => WebAssembly.ImportValue;
  promising: (operation: (slot: number) => number) => (slot: number) => Promise<number>;
};

// (import "host" "read" (func))
// (func (export "save") (param i32) (result i32) call 0 i32.const result)
// A real Wasm export is necessary: a JS function cannot test JSPI's stack entry.
export function suspendingBookmark(wasm: KirikiriJspi, read: () => unknown, result = 0) {
  const bytes = Uint8Array.of(
    0, 97, 115, 109, 1, 0, 0, 0,
    1, 9, 2, 96, 0, 0, 96, 1, 127, 1, 127,
    2, 13, 1, 4, 104, 111, 115, 116, 4, 114, 101, 97, 100, 0, 0,
    3, 2, 1, 1,
    7, 8, 1, 4, 115, 97, 118, 101, 0, 1,
    10, 8, 1, 6, 0, 16, 0, 65, result & 127, 11,
  );
  return new wasm.Instance(new wasm.Module(bytes), {host: {read: new wasm.Suspending(read)}})
    .exports.save as (slot: number) => number;
}
