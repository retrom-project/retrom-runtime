import {readdir, mkdir, readFile, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve, join, relative, dirname} from "node:path";
import {runtimeCatalog} from "../../dist/runtime/index.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, all) => {
  if (value.startsWith("--")) {rows.push([value.slice(2), all[index + 1]]);} return rows;
}, []));
if (!args["materials-root"] || !args["public-fixtures-root"] || !args.output) {throw new Error("MATRIX_EXPLICIT_ROOTS_REQUIRED");}
const roots = {OPERATOR: resolve(args["materials-root"]), PUBLIC_FIXTURE: resolve(args["public-fixtures-root"])};
const inventory = {};
for (const [kind, root] of Object.entries(roots)) {inventory[kind] = await walk(root, root);}

const directories = {
  "3do": "emulatorjs/3do", nintendo3ds: "emulatorjs/3ds", zx81: "emulatorjs/81",
  amstradcpc: "emulatorjs/cap32", gx4000: "emulatorjs/gx4000", dos: "emulatorjs/dos",
  nes: "emulatorjs/fc", dreamcast: "emulatorjs/flycast", zxspectrum: "emulatorjs/fuse",
  gamegear: "emulatorjs/gamegear", gba: "emulatorjs/gba", colecovision: "emulatorjs/gearcoleco",
  intellivision: "emulatorjs/intellivision", lynx: "emulatorjs/lync", multivision: "emulatorjs/multivision",
  nds: "emulatorjs/nds", pce: "emulatorjs/pce", pcecd: "emulatorjs/mednafen_pce",
  neogeocd: "retrom-runtime/neogeocd", pico: "emulatorjs/pico", doom: "emulatorjs/prboom",
  psp: "retrom-runtime/psp", amiga: "emulatorjs/puae", cdi: "emulatorjs/same_cdi",
  sega32x: "emulatorjs/sega32x", sg1000: "emulatorjs/sg1000", snes: "emulatorjs/snes",
  saturn: "emulatorjs/ss", supergrafx: "emulatorjs/supergrafx", uzebox: "emulatorjs/uzebox",
  vectrex: "emulatorjs/vectrex", c128: "emulatorjs/vice_x128", c64: "emulatorjs/vice_x64",
  pet: "emulatorjs/vice_xpet", plus4: "emulatorjs/vice_xplus4", vic20: "emulatorjs/vice_xvic",
  atarijaguar: "emulatorjs/virtualjaguar", bbkrpg: "retrom-runtime/bbk", msx: "retrom-runtime/webmsx",
  pc88: "emulatorjs/pc88",
  pc98: "retrom-runtime/pc98", x68000: "retrom-runtime/px68k", pico8: "retrom-runtime/fake08",
  flash: "retrom-runtime/ruffle", pokemini: "retrom-runtime/pokemini", j2me: "retrom-runtime/J2ME",
  kirikiri: "retrom-runtime/krkr", butterscotch: "retrom-runtime/gamemaker", ons: "retrom-runtime/ons",
  openbor: "retrom-runtime/openbor", cavestory: "retrom-runtime/nxengine/CaveStory", scummvm: "retrom-runtime/scummvm",
  tic80: "retrom-runtime/tic80", tyranoscript: "retrom-runtime/typranoscript", wasm4: "retrom-runtime/wasm4",
  megadrive: "gamelist-import/megadrive", ps2: "retrom-runtime/PS2 - Ridge Racer V",
};
const coreDirectories = {crocods: "emulatorjs/crocods", vice_x64sc: "emulatorjs/vice_x64sc",
  fbalpha2012_cps1: "emulatorjs/fbneo", fbalpha2012_cps2: "emulatorjs/fbneo", fbneo: "emulatorjs/fbneo",
  mame2003: "emulatorjs/neogeo", mame2003_plus: "emulatorjs/neogeo", mame_arcade: "emulatorjs/mame"};
const fixtureDirectories = {nes: "nes-smoke", gba: "gba-smoke", snes: "snes-smoke", dos: "dos-cache", lutro: "lutro-smoke",
  wasm4: "wasm4-controls", pico8: "fantasy-controls", tic80: "fantasy-controls"};
const archiveOrROM = /\.(?:zip|7z|chd|iso|cue|bin|rom|nes|sfc|smc|gba|gbc?|fds|nds|3ds|cci|cso|dsk|ssd|tap|tzx|adf|dim|xdf|gam|mx[12]|tic|p8|swf|wasm|jar|pak|wad|pce|md|gen|sms|gg|sg|a26|a52|a78|j64|jag|lnx|vec|uze|sv|cpr|scl|z81|p|exe|d64|d71|d81|t64|prg|crt|d88|hdi|fdi|lutro)$/iu;
const catalog = runtimeCatalog(), rows = [];
for (const binding of catalog.bindings) {
  const target = catalog.providers.find(item => item.providerId === binding.providerId).targets.find(item => item.id === binding.targetId);
  for (const platformId of binding.platformIds) {
    for (const contentKind of binding.contentKinds) {
      const material = candidates(binding, platformId);
      rows.push({id: `${binding.providerId}/${binding.targetId}/${platformId}`, providerId: binding.providerId,
        targetId: binding.targetId, coreId: binding.coreId, platformId, contentKind, engine: binding.engine ?? null,
        checkpointSemantics: target.checkpoint?.semantics ?? (target.checkpoint ? "INSTANT" : "NO_SAVE"),
        materialStatus: material.length ? material[0].root === "OPERATOR" ? "OPERATOR_MATERIAL_CANDIDATE" : "REDISTRIBUTABLE_FIXTURE_CANDIDATE" : "MATERIAL_GAP",
        materialCandidates: material, notes: notes(binding, platformId), productStatus: "PENDING",
        checks: {configuration: "PENDING", prepare: "PENDING", review: "PENDING", launch: "PENDING", frame: "PENDING",
          direction: "PENDING", confirm: "PENDING", screenshot: "PENDING", checkpoint: target.checkpoint ? "PENDING" : "NOT_DECLARED",
          differentRunRestore: target.checkpoint ? "PENDING" : "NOT_DECLARED", restoredInput: target.checkpoint ? "PENDING" : "NOT_DECLARED", cleanup: "PENDING"},
        evidence: []});
    }
  }
}
const bound = new Set(catalog.bindings.map(binding => `${binding.providerId}/${binding.targetId}`));
const unboundTargets = catalog.providers.flatMap(provider => provider.targets.filter(target => !bound.has(`${provider.providerId}/${target.id}`))
  .map(target => ({providerId: provider.providerId, targetId: target.id, productEntry: false, componentStatus: "DECLARATION_AND_ADAPTER_TESTED", productStatus: "NO_EXISTING_PRODUCT_BINDING"})));
const matrix = {schemaVersion: 1, declarationCount: 110, bindingCount: 109, platformCount: 95, productRowCount: rows.length,
  roots, materialInventoryOnly: true, productPassed: 0, rows, unboundTargets};
const output = resolve(args.output); await mkdir(dirname(output), {recursive: true});
if (args["inventory-output"]) {await writeFile(resolve(args["inventory-output"]), `${JSON.stringify(matrix, null, 2)}\n`);}
let previous;
try {previous = JSON.parse(await readFile(output, "utf8"));} catch (error) {if (error.code !== "ENOENT") {throw error;}}
delete matrix.roots; matrix.materialInventoryOnly = false;
for (const row of rows) {
  row.materialCandidates = row.materialCandidates.map(candidate => ({
    id: `material-${createHash("sha256").update(`${candidate.root}\0${candidate.path}`).digest("hex").slice(0, 16)}`,
    sourceKind: candidate.root, use: candidate.use,
  }));
  const old = previous?.rows.find(value => value.id === row.id);
  if (!old) {continue;}
  row.materialCandidates = [...new Map([...old.materialCandidates, ...row.materialCandidates].map(value => [value.id, value])).values()];
  if (old.materialCandidates.length) {row.materialStatus = old.materialStatus;}
  for (const key of ["productStatus", "checks", "evidence", "attempts", "currentEvidenceFingerprint"]) {
    if (old[key] !== undefined) {row[key] = old[key];}
  }
}
matrix.productPassed = rows.filter(row => row.productStatus === "PASS").length;
await writeFile(output, `${JSON.stringify(matrix, null, 2)}\n`);
const counts = Object.fromEntries(["OPERATOR_MATERIAL_CANDIDATE", "REDISTRIBUTABLE_FIXTURE_CANDIDATE", "MATERIAL_GAP"].map(kind => [kind, rows.filter(row => row.materialStatus === kind).length]));
process.stdout.write(`${JSON.stringify({output, rows: rows.length, counts, missingPlatforms: [...new Set(rows.filter(row => row.materialStatus === "MATERIAL_GAP").map(row => row.platformId))].sort()})}\n`);

function candidates(binding, platformId) {
  let folder = coreDirectories[binding.coreId] ?? directories[platformId];
  let fixture = fixtureDirectories[platformId];
  if (binding.engine) {
    folder = binding.engine === "RPGMV" ? "retrom-runtime/rpgmaker/mv" : binding.engine === "RPGMZ" ? "retrom-runtime/rpgmaker/mz"
      : binding.engine === "RPG2003" ? "retrom-runtime/rpgmaker/easyrpg" : undefined;
    fixture = `rpgmaker-smoke/${{RPG2000: "rpg2000", RPG2003: "rpg2003", RPGXP: "rpgxp", RPGVX: "rpgvx", RPGVXACE: "rpgvxace", RPGMV: "rpgmv", RPGMZ: "rpgmz"}[binding.engine]}`;
  }
  if (platformId === "arcade") {
    fixture = `arcade-smoke/${{fbneo: "fbneo", mame2003: "", mame2003_plus: "mame2003_plus", fbalpha2012_cps1: "fbalpha2012_cps1", fbalpha2012_cps2: "fbalpha2012_cps2"}[binding.coreId] ?? "none"}`.replace(/\/$/u, "");
  }
  const project = !["SINGLE_FILE", "ARCADE", "DOS_BUNDLE"].includes(binding.contentKinds[0]);
  const select = (root, prefix) => prefix ? inventory[root].filter(path => path.startsWith(`${prefix}/`) &&
    !/(?:^|\/)(?:README|LICENSE|SOURCE|source)\.[^.]+$/u.test(path) && !path.includes("/bios/") &&
    (project || archiveOrROM.test(path)) && !path.endsWith(".m3u")).slice(0, 3).map(path => ({root,
      path: project && !/\.(?:zip|7z)$/iu.test(path) ? prefix : path,
      use: project && !/\.(?:zip|7z)$/iu.test(path) ? "PROJECT_ROOT" : "FILE_OR_ARCHIVE"})) : [];
  return [...select("OPERATOR", folder), ...select("PUBLIC_FIXTURE", fixture)];
}
function notes(binding, platformId) {
  const value = [];
  if (platformId === "arcade") {value.push("Actual core DAT/member/Parent/BIOS match must be verified; filename availability is not a playable set.");}
  if (platformId === "saturn") {value.push("Inventory contains multi-disc titles; use one CHD only. M3U/disc switching are outside the product contract.");}
  if (binding.engine && ["RPGXP", "RPGVX", "RPGVXACE", "RPG2000"].includes(binding.engine)) {value.push("No operator game found; existing project-owned MIT fixture supplies semantic product evidence after real execution.");}
  if (binding.coreId === "daphne") {value.push("A complete framefile/ROM/video project is required; no blank canvas or unrelated disc substitutes.");}
  return value;
}
async function walk(root, path) {
  const files = [];
  for (const entry of await readdir(path, {withFileTypes: true})) {
    const absolute = join(path, entry.name);
    if (entry.isDirectory()) {files.push(...await walk(root, absolute));}
    else if (entry.isFile()) {files.push(relative(root, absolute));}
  }
  return files.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}
