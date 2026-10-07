import {cp, mkdtemp, writeFile, mkdir, rm, readFile, readdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {join, resolve} from "node:path";
import {tmpdir} from "node:os";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {copyProductionDependencies} from "./runtime-host-tool.mjs";
const execute = promisify(execFile);

/** Exercise the packed host tool with copied production dependencies and no source checkout resolution. */
export async function verifyRuntimePackage(repositoryRoot, packageJson) {
  const temporary = await mkdtemp(join(tmpdir(), "retrom-package-check-"));
  try {
    const stage = join(temporary, "stage"); await mkdir(stage);
    for (const file of packageJson.files) {await cp(join(repositoryRoot, file), join(stage, file), {recursive: true});}
    await writeFile(join(stage, "package.json"), JSON.stringify({...packageJson, version: "0.0.0-dev"}));
    const {stdout} = await execute("npm", ["pack", "--ignore-scripts", "--json"], {cwd: stage, timeout: 30000, maxBuffer: 4 * 1024 * 1024});
    const pack = JSON.parse(stdout)[0];
    for (const path of ["scripts/runtime-cli.mjs", "scripts/runtime-host-input.mjs", "scripts/runtime-normalize-content.mjs", "dist/runtime/index.js", "dist/runtime/platforms.json", "assets/facts/arcade-catalog.json.gz"]) {
      if (!pack.files.some(file => file.path === path)) {throw new Error(`RUNTIME_PACKAGE_FILE_MISSING:${path}`);}
    }
    const unpack = join(temporary, "unpack"); await mkdir(unpack);
    await execute("tar", ["-xzf", join(stage, pack.filename), "-C", unpack]);
    const tool = join(unpack, "package");
    await copyProductionDependencies(repositoryRoot, join(tool, "node_modules"), packageJson.dependencies);
    const run = async (command, input) => {
      const child = execFile(process.execPath, [join(tool, "scripts/runtime-cli.mjs"), command], {
        cwd: temporary, timeout: 45000, maxBuffer: 16 * 1024 * 1024,
        env: {PATH: process.env.PATH, LANG: "C.UTF-8"},
      });
      const result = new Promise((resolveResult, reject) => {
        let output = ""; child.stdout.on("data", bytes => {output += bytes;});
        let error = ""; child.stderr.on("data", bytes => {error += bytes;});
        child.on("error", reject); child.on("close", code => {
          try {const value = JSON.parse(output); if (code || value.error) {reject(new Error(value.error ?? error));} else {resolveResult(value);}}
          catch (failure) {reject(failure);}
        });
      });
      child.stdin.end(JSON.stringify(input)); return result;
    };
    const catalog = await run("catalog", {});
    if (catalog.bindings.length !== 109 || catalog.platforms.length !== 95 || catalog.providers.reduce((sum, item) => sum + item.targets.length, 0) !== 110) {throw new Error("RUNTIME_PACKAGE_CATALOG_INVALID");}
    const files = [{logicalKey: "game.nes", name: "game.nes", sha256: "a".repeat(64), sizeBytes: 1}];
    const config = await run("configure", {platformId: "nes", coreIds: ["fceumm"], files});
    if ((await run("normalize-content", {platformId: "nes", files})).files[0].sha256 !== files[0].sha256) {throw new Error("RUNTIME_PACKAGE_NORMALIZE_INVALID");}
    const prepared = await run("prepare", {directory: {platformId: "nes", defaultCoreId: "fceumm", allowedCoreIds: ["fceumm"]},
      config, files, fingerprints: {"emulatorjs/fceumm": "b".repeat(64)}});
    if (prepared.romHash !== files[0].sha256 || prepared.targetId !== "fceumm") {throw new Error("RUNTIME_PACKAGE_PREPARE_INVALID");}
    const original = await run("prepare", {directory: {platformId: "thomson", defaultCoreId: "theodore", allowedCoreIds: ["theodore"]},
      config: {content: {kind: "SINGLE_FILE", entryFile: "original_TO7.sap"}},
      files: [{...files[0], logicalKey: "original_TO7.sap", name: "original_TO7.sap"}],
      fingerprints: {"emulatorjs/theodore": "b".repeat(64)}});
    const frozen = {coreId: original.coreId, providerId: original.providerId, targetId: original.targetId,
      coreFingerprint: original.coreFingerprint, romHash: original.romHash, checkpointFormat: original.checkpoint.writeFormat,
      content: original.config.content, runtimeOptions: original.targetOptions};
    const restored = await run("prepare", {directory: {platformId: "thomson", defaultCoreId: "theodore", allowedCoreIds: ["theodore"]},
      config: {content: {kind: "SINGLE_FILE", entryFile: "renamed_TO8.sap"}},
      files: [{...files[0], logicalKey: "renamed_TO8.sap", name: "renamed_TO8.sap"}],
      fingerprints: {"emulatorjs/theodore": "b".repeat(64)}, savedContext: frozen});
    if (original.targetOptions.thomsonModel !== "TO7" || restored.targetOptions.thomsonModel !== "TO7") {
      throw new Error("RUNTIME_PACKAGE_FROZEN_OPTIONS_INVALID");
    }
    const serving = execFile(process.execPath, [join(tool, "scripts/runtime-cli.mjs"), "--serve"], {
      cwd: temporary, timeout: 45000, maxBuffer: 16 * 1024 * 1024, env: {PATH: process.env.PATH, LANG: "C.UTF-8"},
    });
    const reused = new Promise((resolveResult, reject) => {
      let output = ""; serving.stdout.on("data", bytes => {output += bytes;});
      serving.on("error", reject); serving.on("close", code => {
        try {
          const rows = output.trim().split("\n").map(line => JSON.parse(line));
          if (code || rows.length !== 3 || rows[0].result?.content?.entryFile !== "game.nes" ||
              rows[1].error !== "RUNTIME_COMMAND_INVALID" || rows[2].result?.romHash !== files[0].sha256) {
            throw new Error("RUNTIME_PACKAGE_WORKER_INVALID");
          }
          resolveResult();
        } catch (error) {reject(error);}
      });
    });
    serving.stdin.end([{id: 1, command: "configure", input: {platformId: "nes", coreIds: ["fceumm"], files}},
      {id: 2, command: "missing", input: {}}, {id: 3, command: "hash", input: {files, mode: "FILE"}}]
      .map(row => JSON.stringify(row)).join("\n") + "\n");
    await reused;
    const providerRoot = process.env.RETROM_PACKAGE_DETECTOR_PROVIDER_ROOT;
    const treeRoot = process.env.RETROM_PACKAGE_DETECTOR_TREE_ROOT;
    let detector = "input-validation";
    if (providerRoot && treeRoot) {
      const result = await run("detect-scummvm", {providerRoot: resolve(providerRoot), treeRoot: resolve(treeRoot)});
      if (!Array.isArray(result.candidates)) {throw new Error("RUNTIME_PACKAGE_DETECTOR_INVALID");}
      const facts = [], locators = {};
      async function inspect(directory, prefix = "") {
        for (const file of await readdir(directory, {withFileTypes: true})) {
          const path = join(directory, file.name), logicalKey = `${prefix}${file.name}`;
          if (file.isDirectory()) {await inspect(path, `${logicalKey}/`); continue;}
          if (!file.isFile()) {throw new Error("RUNTIME_PACKAGE_DETECTOR_INPUT_INVALID");}
          const bytes = await readFile(path); locators[logicalKey] = path;
          facts.push({logicalKey, name: logicalKey, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")});
        }
      }
      await inspect(resolve(treeRoot));
      const configured = await run("configure", {platformId: "scummvm", coreIds: ["scummvm"], files: facts,
        locators, providerRoots: {"retrom-runtime": resolve(providerRoot)}});
      if (configured.content?.kind !== "SCUMMVM_PROJECT" || !configured.cores?.scummvm?.options?.engineId) {
        throw new Error("RUNTIME_PACKAGE_AUTOMATIC_DETECTION_INVALID");
      }
      detector = `verified-native:${result.candidates.length}`;
    } else {
      try {await run("detect-scummvm", {}); throw new Error("RUNTIME_PACKAGE_DETECTOR_VALIDATION_MISSING");}
      catch (error) {if (error.message !== "RUNTIME_DETECTION_INPUT_INVALID") {throw error;}}
    }
    return {files: pack.files.length, catalog: 110, detector};
  } finally {await rm(temporary, {recursive: true, force: true});}
}
