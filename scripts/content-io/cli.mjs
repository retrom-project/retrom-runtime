import {parseArgs} from "node:util";
import {isAbsolute, dirname, resolve, relative} from "node:path";
import {realpath, mkdir, writeFile, rename} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {pathToFileURL} from "node:url";

export function argumentsFor(options, required, args = process.argv.slice(2)) {
  let values;
  try {({values} = parseArgs({args, options: {...options, help: {type: "boolean"}}, strict: true}));}
  catch (cause) {throw Object.assign(new Error("CONTENT_IO_ARGUMENT_INVALID", {cause}), {exitCode: 2});}
  if (!values.help && required.some((name) => typeof values[name] !== "string" || !values[name])) {
    throw Object.assign(new Error("CONTENT_IO_ARGUMENT_MISSING"), {exitCode: 2});
  }
  return values;
}
export async function absolutePath(path, parentOnly = false) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path) {
    throw Object.assign(new Error("CONTENT_IO_ABSOLUTE_PATH_REQUIRED"), {exitCode: 2});
  }
  const checked = parentOnly ? dirname(path) : path;
  if (await realpath(checked) !== checked) {throw new Error("CONTENT_IO_SYMLINK_PATH_REJECTED");}
  return path;
}
export function within(root, path) {
  const local = relative(root, path);
  if (local === ".." || local.startsWith("../") || isAbsolute(local)) {throw new Error("CONTENT_IO_PATH_ESCAPE");}
  return path;
}
export async function atomicJSON(path, value) {
  await mkdir(dirname(path), {recursive: true});
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {flag: "wx", mode: 0o600});
  await rename(temporary, path);
}
export function main(moduleUrl, action) {
  if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === moduleUrl) {
    action().catch((error) => {console.error(error.message); process.exitCode = error.exitCode ?? 1;});
  }
}
