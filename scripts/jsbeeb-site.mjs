import {gunzipSync} from "node:zlib";
import {lstat, mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import siteAssets from "../src/jsbeeb/site-assets.json" with {type: "json"};

export async function expandJsbeebSite(stageRoot) {
  return expandVerifiedArchive(stageRoot, "runtime/jsbeeb/jsbeeb-site.tar.gz", "runtime/jsbeeb/site",
    new Set(siteAssets), 8 * 1024 * 1024, 16 * 1024 * 1024, "JSBEEB_SITE_INVALID");
}

export async function expandVerifiedArchive(stageRoot, archivePath, sitePrefix, expected,
  maxArchiveBytes, maxTarBytes, errorCode) {
  const invalid = () => {throw new Error(errorCode);};
  const archive = join(stageRoot, archivePath);
  const stat = await lstat(archive);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxArchiveBytes) {invalid();}
  const tar = gunzipSync(await readFile(archive), {maxOutputLength: maxTarBytes});
  const seen = new Set();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {break;}
    if (!["ustar\0", "ustar "].includes(header.toString("ascii", 257, 263)) ||
      header.subarray(345, 500).some((byte) => byte !== 0) ||
      ![0, 48].includes(header[156])) {invalid();}
    const name = field(header, 0, 100);
    const path = name.startsWith("./") ? name.slice(2) : name;
    if (!expected.has(path) || seen.has(path)) {invalid();}
    const sizeField = field(header, 124, 12).trim();
    if (!/^[0-7]+$/u.test(sizeField)) {invalid();}
    const size = Number.parseInt(sizeField, 8);
    const start = offset + 512;
    if (!Number.isSafeInteger(size) || size < 1 || start + size > tar.length) {invalid();}
    const output = join(stageRoot, sitePrefix, path);
    await mkdir(join(output, ".."), {recursive: true});
    await writeFile(output, tar.subarray(start, start + size));
    seen.add(path);
    offset = start + Math.ceil(size / 512) * 512;
  }
  if (seen.size !== expected.size || tar.subarray(offset).some((byte) => byte !== 0)) {invalid();}
}

function field(header, start, length) {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return bytes.toString("ascii", 0, end < 0 ? bytes.length : end);
}
