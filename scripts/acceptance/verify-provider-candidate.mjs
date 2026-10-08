import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {lstat, readFile, readdir, writeFile} from "node:fs/promises";
import {join, relative, resolve} from "node:path";

const [candidate, source, output] = process.argv.slice(2).map(path => resolve(path));
if (!candidate || !source || !output) {throw new Error("CANDIDATE_INPUT_INVALID");}
const active = JSON.parse(await readFile(join(candidate, "active.json")));
const original = JSON.parse(await readFile(join(source, "active.json")));
const verified = [];
for (const provider of active.providers) {
  const root = join(candidate, "installed", provider.installationPath);
  const integrity = JSON.parse(await readFile(join(root, "integrity.json")));
  const expected = new Set(["integrity.json", ".installation.json", ...integrity.files.map(file => file.path)]);
  const actual = await files(root);
  if (actual.length !== expected.size || actual.some(path => !expected.has(path))) {throw new Error("CANDIDATE_CLOSURE_INVALID");}
  let bytes = (await lstat(join(root, "integrity.json"))).size;
  for (const file of integrity.files) {
    const path = join(root, file.path), info = await lstat(path);
    if (info.size !== file.sizeBytes || await hash(path) !== file.sha256) {throw new Error(`CANDIDATE_BYTES_INVALID:${file.path}`);}
    bytes += info.size;
  }
  const proof = JSON.parse(await readFile(join(root, ".installation.json")));
  const expectedProof = {schemaVersion: 1, providerId: provider.providerId, providerVersion: provider.providerVersion,
    bundleSha256: provider.bundleSha256, manifestSha256: provider.manifestSha256,
    fileCount: integrity.files.length + 1, unpackedSizeBytes: bytes};
  if (JSON.stringify(Object.entries(proof).sort()) !== JSON.stringify(Object.entries(expectedProof).sort()) ||
      provider.fileCount !== expectedProof.fileCount || provider.unpackedSizeBytes !== bytes ||
      await hash(join(root, "provider.json")) !== provider.manifestSha256 ||
      await hash(join(root, "client.mjs")) !== provider.moduleSha256) {throw new Error("CANDIDATE_PROOF_INVALID");}
  const archive = join(candidate, "archives", `${provider.providerId}-provider-${provider.providerVersion}.tar.gz`);
  if (await hash(archive) !== provider.bundleSha256 || (await lstat(archive)).size !== provider.bundleSizeBytes) {throw new Error("CANDIDATE_ARCHIVE_INVALID");}
  const base = original.providers.find(item => item.providerId === provider.providerId);
  const before = JSON.parse(await readFile(join(source, "installed", base.installationPath, "integrity.json")));
  const binaryAssets = integrity.files.filter(file => file.path.startsWith("assets/") && /\.(?:wasm|data|xp3)$/u.test(file.path));
  for (const file of binaryAssets) {
    const prior = before.files.find(item => item.path === file.path);
    if (prior?.sha256 !== file.sha256 || prior?.sizeBytes !== file.sizeBytes) {throw new Error(`CANDIDATE_CORE_CHANGED:${file.path}`);}
  }
  const manifest = JSON.parse(await readFile(join(root, "provider.json")));
  const identities = JSON.parse(await readFile(join(root, "runtime-fingerprints.json")));
  if (Object.keys(identities.targets).length !== manifest.targets.length || manifest.targets.some(target =>
    !/^[a-f0-9]{64}$/u.test(identities.targets[target.id]?.fingerprint))) {throw new Error("CANDIDATE_FINGERPRINTS_INVALID");}
  verified.push({providerId: provider.providerId, targets: manifest.targets.length, bundleSha256: provider.bundleSha256,
    moduleSha256: provider.moduleSha256, manifestSha256: provider.manifestSha256, fileCount: provider.fileCount,
    unpackedSizeBytes: bytes, unchangedBinaryAssets: binaryAssets.length,
    fceummFingerprint: identities.targets.fceumm?.fingerprint, nestopiaFingerprint: identities.targets.nestopia?.fingerprint});
}
const result = {sourceTreeSha256: active.sourceTreeSha256, providers: verified};
await writeFile(output, JSON.stringify(result, null, 2));
process.stdout.write(`${JSON.stringify(result)}\n`);

async function hash(path) {const digest = createHash("sha256"); for await (const bytes of createReadStream(path)) {digest.update(bytes);} return digest.digest("hex");}
async function files(root) {
  const found = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name), info = await lstat(path);
      if (info.isSymbolicLink()) {throw new Error("CANDIDATE_LINK_INVALID");}
      if (info.isDirectory()) {await visit(path);} else if (info.isFile()) {found.push(relative(root, path));}
      else {throw new Error("CANDIDATE_FILE_INVALID");}
    }
  }
  await visit(root); return found;
}
