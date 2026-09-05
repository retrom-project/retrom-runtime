// @vitest-environment node
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("rejects a ZIP64 sentinel without its extra field instead of looping forever", () => {
  // Run the dependency boundary in a bounded child: the vulnerable version
  // blocks synchronously, so an in-process test timeout cannot interrupt it.
  // This archive is generated entirely from our own one-byte test payload.
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { zipSync, unzipSync } from "fflate";
    const ordinary = zipSync({ a: new Uint8Array([7]) }, { level: 0 });
    const end = ordinary.length - 22;
    const central = new DataView(ordinary.buffer).getUint32(end + 16, true);
    const zip = new Uint8Array(ordinary.length + 76);
    zip.set(ordinary.subarray(0, end));
    zip.set(ordinary.subarray(end), end + 76);
    const view = new DataView(zip.buffer);
    view.setUint32(central + 20, 0xffffffff, true);
    view.setUint32(end, 0x06064b50, true);
    view.setUint32(end + 4, 44, true);
    view.setUint32(end + 24, 1, true);
    view.setUint32(end + 32, 1, true);
    view.setUint32(end + 40, end - central, true);
    view.setUint32(end + 48, central, true);
    view.setUint32(end + 56, 0x07064b50, true);
    view.setUint32(end + 64, end, true);
    view.setUint32(end + 72, 1, true);
    view.setUint32(end + 76 + 16, 0xffffffff, true);
    try { unzipSync(zip); process.exitCode = 1; }
    catch (error) { if (error.code !== 13) throw error; }
  `], { cwd: process.cwd(), timeout: 2_000, encoding: "utf8" });

  expect(result.error, "malformed ZIP64 must not exhaust the child timeout").toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});
