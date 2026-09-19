import ts from "typescript";
import {boundaryResolver} from "./boundary-resolver.mjs";
import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {absolutePath, argumentsFor, atomicJSON, main} from "./cli.mjs";

const classifications = new Set(["COMMON_CONTENT_IO", "CORE_BRIDGE", "FIXED_ASSET", "METADATA",
  "SAVE_OR_OVERLAY", "DERIVED_FORMAT_STORAGE", "BROWSER_NATIVE", "UPSTREAM_LOADER"]);
function operation(callee) {
  if (/(?:^|\.)(?:fetch|originalFetch|XMLHttpRequest)$/u.test(callee) || /(?:fetch|originalFetch)\.(?:call|apply)$/u.test(callee)) return "NETWORK";
  if (/(?:^|\.)(?:caches|indexedDB)\.open$/u.test(callee) || /(?:getDirectory|getDirectoryHandle)$/u.test(callee)) return "STORAGE";
  if (/\.(?:arrayBuffer|blob|getReader)$/u.test(callee)) return "BODY";
  return null;
}
function owner(node, source) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) {
      const name = parent.name?.getText(source);
      if (name) return ts.isClassDeclaration(parent.parent) ? `${parent.parent.name?.text}.${name}` : name;
    }
    if (ts.isVariableDeclaration(parent) && (ts.isArrowFunction(parent.initializer ?? parent) || ts.isFunctionExpression(parent.initializer ?? parent))) return parent.name.getText(source);
    if (ts.isPropertyAssignment(parent) && (ts.isArrowFunction(parent.initializer) || ts.isFunctionExpression(parent.initializer))) return parent.name.getText(source);
  }
  return "<module>";
}
export function scanBoundaries(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), sites = [];
  const resolve = boundaryResolver(source);
  const visit = node => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      const callee = expression.getText(source);
      for (const kind of new Set([callee, ...resolve(expression)].map(operation).filter(Boolean))) {
        sites.push({symbol: owner(node, source), kind, callee,
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1});
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source); return sites;
}
export function auditSource(repository, path, text, entries) {
  const sites = scanBoundaries(path, text);
  for (const site of sites) {
    const matches = entries.filter(entry => entry.repository === repository && entry.path === path && entry.symbol === site.symbol);
    if (matches.length !== 1) throw new Error(`CONTENT_IO_BOUNDARY_UNCLASSIFIED:${repository}:${path}:${site.symbol}`);
    const entry = matches[0];
    if (!classifications.has(entry.classification) || !entry.reason || !entry.tests?.length || !/^S\d\d$/u.test(entry.ownerStage)) throw new Error("CONTENT_IO_BOUNDARY_DECLARATION_INVALID");
    if (site.kind === "NETWORK" && ["CORE_BRIDGE", "DERIVED_FORMAT_STORAGE"].includes(entry.classification)) throw new Error("CONTENT_IO_PRIVATE_TRANSPORT");
  }
  return sites;
}
export async function repositorySources(root, directories) {
  const paths = execFileSync("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...directories], {encoding: "utf8"}).split("\0");
  const sources = [];
  for (const path of [...new Set(paths)].sort()) {
    if (!/\.(?:ts|mjs|js)$/u.test(path) || /(?:\.test\.|\/tests?\/|\/test-[^/]+$)/u.test(path)) continue;
    try {sources.push({path, text: await readFile(join(root, path), "utf8")});}
    catch (error) {if (error.code !== "ENOENT") throw error;}
  }
  return sources;
}
export async function audit(environment, entries) {
  const result = [];
  const repositories = {runtime: environment.repositories.runtime, ...environment.repositories.cores};
  for (const [repository, repo] of Object.entries(repositories)) {
    if (!repo.root) throw new Error(`CONTENT_IO_BOUNDARY_REPOSITORY_UNAVAILABLE:${repository}`);
    const directories = repository === "runtime" ? ["src", "assets"] : ["libretro/retrom", "js/retrom", "platforms/web", ".github/rpg-runtime"];
    for (const source of await repositorySources(repo.root, directories)) {
      const sites = auditSource(repository, source.path, source.text, entries);
      if (sites.length) result.push({repository, path: source.path, sites});
    }
  }
  return result;
}
async function cli() {
  const args = argumentsFor({env: {type: "string"}}, ["env"]);
  if (args.help) {console.log("boundaries --env <absolute environment.json>"); return;}
  const environment = JSON.parse(await readFile(await absolutePath(args.env), "utf8"));
  const catalog = JSON.parse(await readFile(new URL("../../tests/content-io/boundaries.json", import.meta.url), "utf8"));
  const result = await audit(environment, catalog.entries);
  await atomicJSON(join(environment.paths.evidenceRoot, "boundaries.json"), {schemaVersion: 1, result});
  console.log(`Audited ${result.length} source files`);
}
main(import.meta.url, cli);
