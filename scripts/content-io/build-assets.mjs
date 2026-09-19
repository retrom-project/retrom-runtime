import {build} from "esbuild";
import ts from "typescript";
import {mkdir, readFile, writeFile, realpath} from "node:fs/promises";
import {dirname, isAbsolute, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {argumentsFor, atomicJSON, main} from "./cli.mjs";
import {contractHash} from "./contract.mjs";
import {hash} from "./evidence.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
export function verifyGraph(name, metafile, text) {
  if (Object.values(metafile.outputs).some((output) => output.imports.length)) {throw new Error("CONTENT_IO_ASSET_EXTERNAL_IMPORT");}
  if (name === "sync-client" && Object.keys(metafile.inputs).some((path) => /(?:^|\/)content-io\/(?:http\.ts|store\/)/u.test(path))) {
    throw new Error("CONTENT_IO_SYNC_DEPENDENCY_INVALID");
  }
  const tree = ts.createSourceFile(`${name}.mjs`, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let imports = 0;
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) && node.moduleSpecifier ||
      ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {imports++;}
    ts.forEachChild(node, visit);
  };
  visit(tree); if (imports) {throw new Error("CONTENT_IO_ASSET_EXTERNAL_IMPORT");}
}
export async function buildContentAssets(outputRoot) {
  if (!isAbsolute(outputRoot)) {throw new Error("CONTENT_IO_ABSOLUTE_PATH_REQUIRED");}
  await mkdir(outputRoot, {recursive: true});
  if (await realpath(outputRoot) !== outputRoot) {throw new Error("CONTENT_IO_SYMLINK_PATH_REJECTED");}
  const contractSha256 = await contractHash(), files = [];
  const identity = await readFile(new URL("../../src/content-io/identity.ts", import.meta.url), "utf8");
  if (!identity.includes(`contractSha256 = "${contractSha256}"`)) {throw new Error("CONTENT_IO_CONTRACT_HASH_INVALID");}
  for (const name of ["worker", "sync-client"]) {
    const result = await build({absWorkingDir: root, entryPoints: [`src/content-io/${name}.ts`], bundle: true,
      format: "esm", platform: "browser", target: "es2022", write: false, metafile: true, legalComments: "inline"});
    const text = result.outputFiles[0].text;
    verifyGraph(name, result.metafile, text);
    const path = `assets/content-io/${name}.mjs`, bytes = result.outputFiles[0].contents;
    await writeFile(join(outputRoot, `${name}.mjs`), bytes);
    await atomicJSON(join(outputRoot, `${name}.metafile.json`), result.metafile);
    files.push({path, sha256: hash(bytes), sizeBytes: bytes.length});
  }
  const manifest = {abi: "content-io-v1", contractSha256, files};
  await atomicJSON(join(outputRoot, "manifest.json"), manifest); return manifest;
}
async function cli() {
  const args = argumentsFor({output: {type: "string"}}, ["output"]);
  if (args.help) {console.log("build-assets --output <absolute build output directory>"); return;}
  const output = resolve(args.output);
  const allowed = [join(root, ".artifacts"), join(root, "release"), join(root, "dist"), join(dirname(root.replace(/\/$/u, "")), "retrom/.pfb")];
  if (output !== args.output || !allowed.some((directory) => {const path = relative(directory, output); return path && path !== ".." && !path.startsWith("../") && !isAbsolute(path);})) {
    throw new Error("CONTENT_IO_BUILD_OUTPUT_INVALID");
  }
  console.log(JSON.stringify(await buildContentAssets(output)));
}
main(import.meta.url, cli);
