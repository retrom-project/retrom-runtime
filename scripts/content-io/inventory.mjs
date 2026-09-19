import ts from "typescript";
import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {absolutePath, argumentsFor, atomicJSON, main} from "./cli.mjs";

export function scanText(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const operations = [], declarations = [];
  function visit(node) {
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      declarations.push({symbol: node.name?.getText(source) ?? "anonymous", line,
        async: Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)),
        signature: node.getText(source).split("{")[0].trim()});
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(source);
      if (/fetch|XMLHttpRequest|\.arrayBuffer$|\.blob$|\.getReader$|\.open$|\.getDirectory|indexedDB|createLazyFile|sha256|\.digest$/iu.test(callee)) {
        operations.push({line, callee, expression: node.getText(source)});
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const literals = [...text.matchAll(/['"]([A-Z][A-Z0-9_]{5,})['"]/gu)].map((match) => match[1]);
  return {path, sha256: createHash("sha256").update(text).digest("hex"), declarations, operations,
    errorIdentifiers: [...new Set(literals.filter((value) => /INVALID|FAILED|UNAVAILABLE|MISMATCH|TIMEOUT|CLOSED|BOUNDS/u.test(value)))].sort()};
}
export async function scanRepository(root, directories) {
  const files = execFileSync("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...directories], {encoding: "utf8"}).split("\0")
    .filter((path) => /\.(?:ts|mjs|js|py|sh)$/u.test(path) && !/\.test\.|\/tests?\//u.test(path));
  const result = [];
  for (const path of [...new Set(files)].sort()) {
    let text;
    try {text = await readFile(join(root, path), "utf8");}
    catch (error) {if (error.code === "ENOENT") {continue;} throw error;}
    if (/\.(?:py|sh)$/u.test(path)) {
      if (/fetch|wasmfs|content|emscripten|--core-id/iu.test(text)) {
        result.push({path, sha256: createHash("sha256").update(text).digest("hex"), source: text});
      }
    } else {
      const record = scanText(path, text);
      if (record.operations.length) {result.push(record);}
    }
  }
  return result;
}
export async function inventory() {
  const args = argumentsFor({env: {type: "string"}}, ["env"]);
  if (args.help) {console.log("inventory --env <absolute environment.json>"); return;}
  const environment = JSON.parse(await readFile(await absolutePath(args.env), "utf8"));
  const repositories = {runtime: environment.repositories.runtime, ...environment.repositories.cores};
  const scans = {};
  for (const [id, repo] of Object.entries(repositories)) {
    scans[id] = repo.root ? await scanRepository(repo.root, id === "runtime" ? ["src", "assets"] :
      ["libretro/retrom", "js/retrom", "platforms/web", ".github/rpg-runtime"]) : {availability: repo.availability};
  }
  const catalog = JSON.parse(await readFile(new URL("../../tests/content-io/entrypoints.json", import.meta.url), "utf8"));
  for (const entry of catalog.entries) {
    const repo = repositories[entry.repository];
    if (!repo) {throw new Error(`CONTENT_IO_ENTRY_REPOSITORY_MISSING:${entry.id}`);}
    if (!repo.root) {continue;}
    const source = await readFile(join(repo.root, entry.path), "utf8");
    if (!source.includes(entry.symbol)) {throw new Error(`CONTENT_IO_ENTRY_SYMBOL_MISSING:${entry.id}`);}
    entry.sourceSha256 = createHash("sha256").update(source).digest("hex");
  }
  await atomicJSON(join(environment.paths.evidenceRoot, "entrypoints.json"), {schemaVersion: 1, entries: catalog.entries, scans});
  console.log(`Recorded ${catalog.entries.length} entrypoints and ${Object.values(scans).flat().length} source files`);
}
main(import.meta.url, inventory);
