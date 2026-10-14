import type {RPGEngine, RuntimeContentFile} from "./types.js";
import {logicalPath, utf8Compare} from "./validation.js";

const names: Record<RPGEngine, string> = {
  RPGMV: "index.html", RPGMZ: "index.html", RPGXP: "game.ini", RPGVX: "game.ini", RPGVXACE: "game.ini",
  RPG2000: "rpg_rt.ldb", RPG2003: "rpg_rt.ldb",
};

/** Entry paths remain relative to their project; unrelated HTML pages are not game entries. */
export function rpgEntryFiles(engine: RPGEngine, files: readonly RuntimeContentFile[]): string[] {
  const paths = new Set(files.map(file => file.logicalKey.toLowerCase()));
  return files.flatMap(file => {
    const path = file.logicalKey, lower = path.toLowerCase(), root = lower.slice(0, lower.lastIndexOf("/") + 1);
    if (!logicalPath(path) || lower.slice(root.length) !== names[engine]) {return [];}
    const script = engine === "RPGMV" ? "js/rpg_core.js" : engine === "RPGMZ" ? "js/rmmz_core.js" : null;
    return script && !paths.has(root + script) ? [] : [path];
  }).sort(utf8Compare);
}

