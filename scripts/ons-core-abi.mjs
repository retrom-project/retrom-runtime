/** The stable-wait checkpoint is a required native interface, not an optional fallback. */
export function assertONSCheckpointCore(javascript, wasm) {
  const glue = Buffer.from(javascript).toString("utf8");
  const binding = /Module\[["']_onsyuri_host_checkpoint_ready["']\]\s*=\s*wasmExports\[["']([^"']+)["']\]/u.exec(glue);
  if (!binding) {invalid();}
  let exports;
  try {exports = globalThis.WebAssembly.Module.exports(new globalThis.WebAssembly.Module(wasm));}
  catch {invalid();}
  if (!exports.some(value => value.name === binding[1] && value.kind === "function")) {invalid();}
}
function invalid() {throw new Error("ONS_CHECKPOINT_NATIVE_ABI_REQUIRED");}
