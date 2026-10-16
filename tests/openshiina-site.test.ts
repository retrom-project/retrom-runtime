// @vitest-environment node
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {gzipSync} from "node:zlib";
import {afterEach, expect, it} from "vitest";
import siteAssets from "../src/openshiina/site-assets.json" with {type: "json"};
import {expandShiinaSite} from "../scripts/openshiina-site.mjs";
const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
it("expands the complete fixed .NET layout and refuses missing or additional files", async () => {
  const root = await mkdtemp(join(tmpdir(), "shiina-site-")); roots.push(root);
  await mkdir(join(root, "runtime/openshiina"), {recursive: true});
  for (const names of [siteAssets, siteAssets.slice(1), [...siteAssets, "../escape"]]) {
    const parts = names.map(name => {
      const header = Buffer.alloc(512); header.write(name); header.write("00000000001\0", 124, "ascii"); header[156] = 48; header.write("ustar\0", 257, "ascii");
      return Buffer.concat([header, Buffer.from("x"), Buffer.alloc(511)]);
    });
    await writeFile(join(root, "runtime/openshiina/openshiina-web.tar.gz"), gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)])));
    if (names.length === siteAssets.length) {
      await expandShiinaSite(root);
      expect((await readFile(join(root, "runtime/openshiina/web/_framework/dotnet.native.wasm"))).toString()).toBe("x");
    } else {await expect(expandShiinaSite(root)).rejects.toThrow("SHIINA_SITE_INVALID");}
  }
});
