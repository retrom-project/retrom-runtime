import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, writeFile, rm, symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {hash} from "./evidence.mjs";
import {verifyCandidateFiles, matchProviderIdentities, needsProviderIdentity} from "./provider-identities.mjs";
test("[PK-04] CONTRACT/provider-proof rejects missing identity and altered candidate files or closed inventories", async () => {
  const root = await mkdtemp(join(tmpdir(), "content-provider-proof-"));
  try {
    const bytes = Buffer.from("candidate"), descriptor = {files: [{path: "asset", sizeBytes: bytes.length, sha256: hash(bytes)}]};
    await writeFile(join(root, "asset"), bytes); await verifyCandidateFiles(root, descriptor);
    await writeFile(join(root, "asset"), Buffer.from("Candidate"));
    await assert.rejects(verifyCandidateFiles(root, descriptor), /ASSET_INVALID/u);
    await writeFile(join(root, "asset"), bytes); await writeFile(join(root, "extra"), "extra");
    await assert.rejects(verifyCandidateFiles(root, descriptor), /FILES_INVALID/u);
    await rm(join(root, "extra")); await symlink(join(root, "asset"), join(root, "extra"));
    await assert.rejects(verifyCandidateFiles(root, descriptor), /FILES_INVALID/u);
  } finally {await rm(root, {recursive: true});}
  const rows = [{id: "provider", bundleSha256: "a".repeat(64)}], path = "/proof/providers.json";
  const identities = [{id: "provider", sha256: rows[0].bundleSha256, evidencePath: path, reportLocation: "/0/bundleSha256"}];
  matchProviderIdentities(rows, rows, identities, path);
  assert.throws(() => matchProviderIdentities(rows, [], identities, path), /PROVIDER_IDENTITY_PROOF_INVALID/u);
  assert.throws(() => matchProviderIdentities(rows, rows, [], path), /PROVIDER_IDENTITY_PROOF_INVALID/u);
  assert.deepEqual(["S17", "S18", "S19", "S20", "S21", "S22"].map(needsProviderIdentity), [false, true, true, true, true, false]);
});
