// @vitest-environment node
import {afterEach, expect, it} from "vitest";
import {createHash} from "node:crypto";
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {zipSync} from "fflate";
import {crc32} from "node:zlib";
import {identifyHostBIOS, verifyHostBIOS} from "../scripts/runtime-host-input.mjs";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
const hash = (algorithm: string, bytes: Uint8Array) => createHash(algorithm).update(bytes).digest("hex");
const payload = Uint8Array.of(1, 2, 3);
const requirement = {requirementKey: "test/bios.zip", coreId: "test", logicalName: "bios.zip",
  providerId: "test", targetId: "test", required: true, condition: "ARCADE_BIOS", delivery: "EXTERNAL_FILE" as const,
  virtualPath: "bios.zip", activationOptions: {},
  sizeBytes: null, sha256: null, md5: null, members: [{name: "firmware.bin", sizeBytes: payload.length,
    crc32: crc32(payload).toString(16).padStart(8, "0"), sha1: hash("sha1", payload), required: true}]};
async function inspect(entries: Record<string, Uint8Array>, level: 0 | 9 = 0, name = "bios.zip", req = requirement) {
  const root = await mkdtemp(join(tmpdir(), "bios-candidates-")); roots.push(root);
  const bytes = zipSync(entries, {level}), path = join(root, name); await writeFile(path, bytes);
  return identifyHostBIOS({path, file: {name, sizeBytes: bytes.length, sha256: hash("sha256", bytes), md5: hash("md5", bytes)}, requirements: [req]});
}
it("compares actual named members independently of ZIP compression and ordering", async () => {
  const first = await inspect({"renamed.bin": payload, "extra.bin": Uint8Array.of(8)});
  const second = await inspect({"extra.bin": Uint8Array.of(8), "renamed.bin": payload}, 9);
  expect(first).toHaveLength(1); expect(second).toHaveLength(1);
  expect(first[0].candidate).toEqual({memberIdentity: expect.stringMatching(/^[0-9a-f]{64}$/u), matchedMembers: 1, totalMembers: 2});
  expect(second[0].candidate).toEqual(first[0].candidate);
  const changed = await inspect({"renamed.bin": payload, "extra.bin": Uint8Array.of(9)});
  expect(changed[0].candidate?.memberIdentity).not.toBe(first[0].candidate?.memberIdentity);
});
it("retains named incomplete and zero-match candidates, but does not assign unrelated archives", async () => {
  const result = await inspect({"firmware.bin": Uint8Array.of(9)});
  expect(result).toHaveLength(1);
  expect(result[0].candidate).toMatchObject({matchedMembers: 0, totalMembers: 1});
  expect(await inspect({"firmware.bin": Uint8Array.of(9)}, 0, "unrelated.zip")).toEqual([]);
});
it("requires SHA1 when DAT supplies it, even when size and CRC match", async () => {
  const result = await inspect({"firmware.bin": payload}, 0, "bios.zip", {...requirement,
    members: [{...requirement.members[0], sha1: "f".repeat(40)}]});
  expect(result[0].candidate?.matchedMembers).toBe(0);
});

it("supports CRC-only DAT facts and reports installed incomplete or corrupt bytes truthfully", async () => {
  const root = await mkdtemp(join(tmpdir(), "bios-installed-")); roots.push(root);
  const path = join(root, "bios.zip");
  const req = {...requirement, members: [{...requirement.members[0], sha1: ""}]};
  await writeFile(path, zipSync({"renamed.bin": payload}, {level: 0}));
  expect(await verifyHostBIOS({path, requirement: req})).toEqual({status: "valid", matchedMembers: 1, expectedMembers: 1, missingMembers: []});
  await writeFile(path, zipSync({"renamed.bin": Uint8Array.of(7, 8, 9)}, {level: 0}));
  expect(await verifyHostBIOS({path, requirement: req})).toEqual({status: "incomplete", matchedMembers: 0,
    expectedMembers: 1, missingMembers: ["firmware.bin"]});
  const corrupt = zipSync({"renamed.bin": payload}, {level: 0});
  corrupt[30 + "renamed.bin".length] ^= 1;
  await writeFile(path, corrupt);
  expect(await verifyHostBIOS({path, requirement: req})).toMatchObject({status: "invalid", matchedMembers: 0});
});
