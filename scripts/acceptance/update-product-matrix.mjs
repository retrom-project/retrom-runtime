import {readFile, readdir, writeFile, stat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {basename, join, resolve} from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((rows, key, index, all) =>
  key.startsWith("--") ? [...rows, [key.slice(2), all[index + 1]]] : rows, []));
for (const key of ["matrix", "evidence-root", "output"]) {if (!args[key]) {throw new Error(`MATRIX_ARGUMENT_REQUIRED:${key}`);}}
const matrix = JSON.parse(await readFile(args.matrix, "utf8")), root = resolve(args["evidence-root"]);
const materialId = (kind, path) => `material-${createHash("sha256").update(`${kind}\0${path}`).digest("hex").slice(0, 16)}`;
const rowFor = input => matrix.rows.find(row => row.id === input.rowId) ?? matrix.rows.find(row =>
  row.providerId === input.rowId?.split("/")[0] && row.coreId === input.coreId && row.platformId === (input.platformId ?? input.rowId?.split("/")[2]));
if (args["inventory-output"] && matrix.roots) {await writeFile(args["inventory-output"], JSON.stringify(matrix, null, 2));}
delete matrix.roots; matrix.materialInventoryOnly = false;
for (const row of matrix.rows) {
  row.materialCandidates = row.materialCandidates.map(candidate => candidate.id ? candidate :
    {id: materialId(candidate.root, candidate.path), sourceKind: candidate.root, use: candidate.use});
  row.materialCandidates = row.materialCandidates.filter((candidate, index, candidates) =>
    candidates.findIndex(other => other.id === candidate.id) === index);
}
const sources = ["root/matrix/inputs.json", "runtime/native-inputs.json", "root/matrix/public-gap-import-proof.json",
  "root/matrix/public-gap-2-import-proof.json", "root/matrix/public-gap-3-import-proof.json",
  "root/matrix/public-gap-4-import-proof.json", "root/matrix/public-gap-5-import-proof.json"];
for (const source of sources) {
  let inputs;
  try {const value = JSON.parse(await readFile(join(root, source), "utf8")); inputs = value.rows ?? value;} catch (error) {if (error.code === "ENOENT") {continue;} throw error;}
  for (const input of inputs) {
    const row = rowFor(input); if (!row) {continue;}
    const sourceKind = input.sourceRoot ?? "OFFICIAL_AUTHOR";
    const id = materialId(sourceKind, input.sourcePath);
    if (!row.materialCandidates.some(candidate => candidate.id === id)) {
      row.materialCandidates.unshift({id, sourceKind, use: "PRODUCT_SOURCE", sourceEvidence: source});
    }
    if (row.materialStatus === "MATERIAL_GAP") {row.materialStatus = input.sourceRoot === "OPERATOR" ? "OPERATOR_MATERIAL_CANDIDATE" : "REDISTRIBUTABLE_FIXTURE_CANDIDATE";}
  }
}
for (const owner of ["root/matrix", "runtime", "frontend"]) {
  let entries; try {entries = await readdir(join(root, owner));} catch (error) {if (error.code === "ENOENT") {continue;} throw error;}
  for (const filename of entries.filter(name => name.endsWith("-product.json"))) {
    const report = JSON.parse(await readFile(join(root, owner, filename), "utf8"));
    const row = rowFor(report); if (!row) {continue;}
    const phase = report.phases ?? {}, checks = Object.fromEntries(Object.entries(row.checks).map(([key, value]) =>
      [key, value === "NOT_DECLARED" ? value : "PENDING"]));
    if (phase.reviewPrepare?.status === 200 || phase.playPrepare === 200) {checks.configuration = "PASS"; checks.prepare = "PASS";}
    if (phase.review) {checks.review = "PASS"; checks.frame = "CANVAS_OBSERVED";}
    if (phase.playPrepare === 200 && report.input) {checks.launch = "PASS";}
    if (report.input?.calls?.some(call => call[0] === 0 && call[1] === 7 && call[2] === 1)) {checks.direction = "INPUT_DELIVERY_OBSERVED";}
    if (report.input?.calls?.some(call => call[0] === 0 && call[1] === 8 && call[2] === 1)) {checks.confirm = "INPUT_DELIVERY_OBSERVED";}
    if (report.frames?.length) {checks.screenshot = "CAPTURED";}
    if (phase.saveHTTP === 200 && report.save?.sizeBytes > 0) {checks.checkpoint = "PAYLOAD_PERSISTED";}
    if (phase.restoreHTTP === 200 && phase.newRunRestored) {checks.differentRunRestore = "NEW_RUN_TRANSPORT_CONFIRMED";}
    if (report.restoredInput?.calls?.length) {checks.restoredInput = "INPUT_DELIVERY_OBSERVED";}
    if (report.cleanup?.length && report.cleanup.every(item => item.status === 204)) {checks.cleanup = "PASS";}
    row.attempts ??= [];
    const artifact = `${owner}/${basename(filename)}`, at = report.finishedAt ?? report.startedAt;
    if (!row.attempts.some(attempt => attempt.artifact === artifact && attempt.at === at)) {
      row.attempts.push({artifact, at, coreFingerprint: report.runIdentity?.fingerprint ?? report.fingerprint ?? null,
        result: report.complete ? "CHAIN_COMPLETE_REQUIRES_CONTENT_REVIEW" : "INCOMPLETE",
        failureCode: /(?:CONTENT_IO_|PLAYER_|RUNTIME_|BIOS_)[A-Z0-9_]+/u.exec(report.failure ?? "")?.[0] ?? null,
        checks});
    }
    row.evidence = [...new Set([...(row.evidence ?? []), artifact])];
    row.productStatus = "PRODUCT_ATTEMPTED";
  }
}
async function frontendReports(directory) {
  let entries;
  try {entries = await readdir(join(root, directory), {withFileTypes: true});}
  catch (error) {if (error.code === "ENOENT") {return;} throw error;}
  for (const entry of entries) {
    const artifact = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {await frontendReports(artifact); continue;}
    if (!entry.isFile() || entry.name !== "report.json") {continue;}
    const report = JSON.parse(await readFile(join(root, artifact), "utf8"));
    const runtime = report.runtime ?? report.run?.envelope?.runtime ?? report.runs?.[0]?.envelope?.runtime;
    if (!runtime?.providerId || !runtime.targetId || !runtime.coreFingerprint) {continue;}
    const matches = matrix.rows.filter(row => row.providerId === runtime.providerId && row.targetId === runtime.targetId);
    if (matches.length !== 1) {continue;}
    const row = matches[0], checks = Object.fromEntries(Object.entries(row.checks).map(([key, value]) =>
      [key, value === "NOT_DECLARED" ? value : "PENDING"]));
    if (report.launchStatus === 200 || report.run?.id || report.runs?.length) {checks.prepare = "PASS"; checks.launch = "PASS";}
    const at = (await stat(join(root, artifact))).mtime.toISOString();
    row.attempts ??= [];
    if (!row.attempts.some(attempt => attempt.artifact === artifact && attempt.at === at)) {
      row.attempts.push({artifact, at, coreFingerprint: runtime.coreFingerprint,
        result: "PRODUCT_OBSERVED_REQUIRES_SEMANTIC_REVIEW", checks});
    }
    row.evidence = [...new Set([...(row.evidence ?? []), artifact])];
    row.productStatus = "PRODUCT_ATTEMPTED";
  }
}
await frontendReports("frontend");
const currentFingerprints = new Map();
if (args["provider-base"]) {
  const base = resolve(args["provider-base"]), active = JSON.parse(await readFile(join(base, "active.json"), "utf8"));
  matrix.currentCandidate = active.providers.map(({providerId, bundleSha256, moduleSha256}) =>
    ({providerId, bundleSha256, moduleSha256}));
  matrix.currentProviderSourceTreeSha256 = active.sourceTreeSha256;
  if (!matrix.currentHostToolSourceTreeSha256) {matrix.currentSourceTreeSha256 = active.sourceTreeSha256;}
  for (const provider of active.providers) {
    const identities = JSON.parse(await readFile(join(base, "installed", provider.installationPath, "runtime-fingerprints.json"), "utf8"));
    for (const [targetId, identity] of Object.entries(identities.targets)) {currentFingerprints.set(`${provider.providerId}/${targetId}`, identity.fingerprint);}
  }
}
for (const row of matrix.rows) {
  const latest = row.attempts?.toSorted((a, b) => String(a.at).localeCompare(String(b.at))).at(-1);
  if (latest) {row.checks = latest.checks; row.currentEvidenceFingerprint = latest.coreFingerprint;}
  const current = currentFingerprints.get(`${row.providerId}/${row.targetId}`);
  const proof = row.semanticEvidence?.find(item => item.result === "PASS" && item.coreFingerprint === current);
  if (proof) {row.productStatus = "PASS"; row.checks = proof.checks; row.currentEvidenceFingerprint = current;}
  else if (row.productStatus === "PASS") {row.productStatus = "PRODUCT_ATTEMPTED";}
}
matrix.productPassed = matrix.rows.filter(row => row.productStatus === "PASS").length;
matrix.summary = {productRows: matrix.rows.length, productPassed: matrix.productPassed,
  actuallyAttempted: matrix.rows.filter(row => row.attempts?.length).length,
  preparedWithoutProductAttempt: matrix.rows.filter(row => !row.attempts?.length && row.checks.prepare === "PASS").length,
  materialGaps: matrix.rows.filter(row => row.materialStatus === "MATERIAL_GAP").length,
  materialAvailableWithoutProductAttempt: matrix.rows.filter(row => !row.attempts?.length && row.materialStatus !== "MATERIAL_GAP").length};
await writeFile(args.output, `${JSON.stringify(matrix, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(matrix.summary)}\n`);
