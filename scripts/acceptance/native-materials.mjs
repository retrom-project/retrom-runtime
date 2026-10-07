import {cp, mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {basename, join, resolve} from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, all) =>
  value.startsWith("--") ? [...rows, [value.slice(2), all[index + 1]]] : rows, []));
for (const key of ["operator-root", "public-root", "sources-root", "output"]) {
  if (!args[key]) {throw new Error("NATIVE_MATERIAL_ROOT_REQUIRED");}
}
const roots = {OPERATOR: resolve(args["operator-root"]), PUBLIC_FIXTURE: resolve(args["public-root"])};
const selected = [
  ["fake08", "PUBLIC_FIXTURE", "fantasy-controls/controls.p8"],
  ["tic80", "PUBLIC_FIXTURE", "fantasy-controls/controls.tic"],
  ["wasm4", "PUBLIC_FIXTURE", "wasm4-controls/controls.wasm"],
  ...["2000", "2003", "xp", "vx", "vx-ace"].map(engine =>
    [`rpgmaker-${engine}`, "PUBLIC_FIXTURE", `rpgmaker-smoke/rpg${engine.replace("-", "")}`]),
  ["nxengine", "OPERATOR", "retrom-runtime/nxengine/CaveStory"],
  ["scummvm", "OPERATOR", "retrom-runtime/scummvm/BASS-Floppy-1.3.zip"],
  ["openbor", "OPERATOR", "retrom-runtime/openbor/8MAN.PAK"],
  ["msx-webmsx", "OPERATOR", "retrom-runtime/webmsx/Antarctic Adventure (1984) (Konami) (J).mx1"],
  ["px68k", "OPERATOR", "retrom-runtime/px68k/CH68_110.xdf"],
  ["gbe-pokemini", "OPERATOR", "retrom-runtime/pokemini/Pokemon Pinball Mini (USA, Europe).zip"],
  ["flash-ruffle", "OPERATOR", "retrom-runtime/ruffle/Canabalt.swf"],
  ["j2me", "OPERATOR", "retrom-runtime/J2ME/CS反恐特警真3D版2.jar"],
  ["butterscotch-gamemaker", "OPERATOR", "retrom-runtime/gamemaker/Undertale.zip"],
  ["mame-coleco", "OPERATOR", "emulatorjs/gearcoleco/240p-test-suite.rom"],
  ["mame-sg1000", "OPERATOR", "emulatorjs/sg1000/Bomb Jack.7z"],
];
const matrix = JSON.parse(await readFile(new URL("../../docs/acceptance/runtime-product-matrix.json", import.meta.url)));
const rows = [];
for (const [targetId, sourceRoot, sourcePath] of selected) {
  const row = matrix.rows.find(row => row.providerId === "retrom-runtime" && row.targetId === targetId);
  if (!row) {throw new Error("NATIVE_TARGET_UNKNOWN");}
  const slug = `${targetId}--${row.platformId}`, source = join(roots[sourceRoot], sourcePath);
  const directory = join(resolve(args["sources-root"]), slug), info = await stat(source);
  const file = info.isDirectory() ? "game" : basename(source);
  await mkdir(directory, {recursive: true});
  await cp(source, join(directory, file), {recursive: true, errorOnExist: true, force: false});
  const title = `Runtime ${targetId} · ${row.platformId}`;
  await writeFile(join(directory, "metadata.pegasus.txt"), `collection: ${slug}\nshortname: ${slug}\n\ngame: ${title}\nfile: ${file}\n`, {flag: "wx"});
  rows.push({rowId: row.id, coreId: row.coreId, platformId: row.platformId, contentKind: row.contentKind,
    slug, title, rootId: "acceptance", relativePath: `runtime-matrix/${slug}`, sourceRoot, sourcePath});
}
await writeFile(resolve(args.output), `${JSON.stringify(rows, null, 2)}\n`, {flag: "wx"});
process.stdout.write(`${JSON.stringify({prepared: rows.length, output: args.output})}\n`);
