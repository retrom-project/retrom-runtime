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
it("[RTP-03] verifies an RTP archive by the directories mkxp mounts at its root, without hashing it", async () => {
  const rtp = {...requirement, requirementKey: "retrom-runtime/rpgmaker-xp/Standard.zip", logicalName: "Standard.zip",
    condition: "RPG_RTP", delivery: "SEEKABLE_BLOB" as const, virtualPath: null, members: undefined,
    resourceRole: "rtp", archiveRoot: ["Audio/", "Graphics/"]};
  const verify = async (entries: Record<string, Uint8Array> | Uint8Array) => {
    const root = await mkdtemp(join(tmpdir(), "bios-rtp-")); roots.push(root);
    const path = join(root, "Standard.zip");
    await writeFile(path, entries instanceof Uint8Array ? entries : zipSync(entries, {level: 9}));
    return verifyHostBIOS({requirement: rtp, path});
  };
  expect(await verify({"Audio/BGM/001-Battle01.mid": payload, "graphics/Titles/001-Title01.jpg": payload}))
    .toEqual({status: "valid", matchedMembers: 2, expectedMembers: 2, missingMembers: []});
  // Compressing the folder itself puts everything below "Standard/", where mkxp cannot find it.
  expect(await verify({"Standard/Audio/BGM/a.mid": payload, "Standard/Graphics/a.png": payload}))
    .toEqual({status: "invalid", matchedMembers: 0, expectedMembers: 2, missingMembers: ["Audio/", "Graphics/"]});
  expect(await verify({"Graphics/a.png": payload}))
    .toEqual({status: "incomplete", matchedMembers: 1, expectedMembers: 2, missingMembers: ["Audio/"]});
  expect(await verify(Uint8Array.of(1, 2, 3)))
    .toEqual({status: "invalid", matchedMembers: 0, expectedMembers: 2, missingMembers: ["Audio/", "Graphics/"]});
});
