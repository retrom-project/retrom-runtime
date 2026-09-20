import {readFile, readdir} from "node:fs/promises";
import {createHash} from "node:crypto";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function contractHash() {
  const root = new URL("../../contracts/content-io/v1/", import.meta.url);
  const paths = (await readdir(root)).sort();
  if (paths.join() !== ["CONTRACT.sha256", "content-io.d.ts", "errors.json", "protocol.schema.json", "vectors.json"].join()) {
    throw new Error("CONTENT_IO_CONTRACT_FILES_INVALID");
  }
  let listing = "";
  for (const path of paths.filter((path) => path !== "CONTRACT.sha256")) {
    listing += `${path}\n${hash(await readFile(new URL(path, root)))}\n`;
  }
  const actual = hash(listing), expected = (await readFile(new URL("CONTRACT.sha256", root), "utf8")).trim();
  if (actual !== expected) {throw new Error("CONTENT_IO_CONTRACT_HASH_INVALID");}
  return actual;
}
