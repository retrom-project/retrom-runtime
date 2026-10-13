/** Checkpoint readiness and stopping pending Asyncify work are required native interfaces. */
export function assertONSCheckpointCore(javascript, wasm) {
  const glue = Buffer.from(javascript).toString("utf8");
  let exports;
  try {exports = globalThis.WebAssembly.Module.exports(new globalThis.WebAssembly.Module(wasm));}
  catch {invalid();}
  for (const [name, code] of [["checkpoint_ready", "ONS_CHECKPOINT_NATIVE_ABI_REQUIRED"],
    ["stop", "ONS_STOP_NATIVE_ABI_REQUIRED"]]) {
    const binding = new RegExp(`Module\\[["']_onsyuri_host_${name}["']\\]\\s*=\\s*wasmExports\\[["']([^"']+)["']\\]`, "u").exec(glue);
    if (!binding || !exports.some(value => value.name === binding[1] && value.kind === "function")) {invalid(code);}
  }
}
function invalid(code = "ONS_CHECKPOINT_NATIVE_ABI_REQUIRED") {throw new Error(code);}
