import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

export function acceptanceArgs(required = []) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, all) =>
    value.startsWith("--") ? [...rows, [value.slice(2), all[index + 1]]] : rows, []));
  for (const key of ["base", "playwright", "browser", "storage-state", "output", ...required]) {
    if (!args[key]) {throw new Error(`ACCEPTANCE_ARGUMENT_REQUIRED:${key}`);}
  }
  return args;
}

/** Browser tools and the authenticated state belong to the caller's environment. */
export async function openAcceptanceBrowser(args) {
  const {chromium} = await import(pathToFileURL(resolve(args.playwright)).href);
  return chromium.launch({executablePath: resolve(args.browser), headless: true,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"]});
}
