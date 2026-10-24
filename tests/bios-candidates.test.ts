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
const rtpRequirement = (target: string, name: string, archiveEntries: string[]) => ({...requirement,
  requirementKey: `retrom-runtime/${target}/${name}.zip`, logicalName: `${name}.zip`, targetId: target, condition: "RPG_RTP",
  delivery: "SEEKABLE_BLOB" as const, virtualPath: null, members: undefined, resourceRole: "rtp",
  archiveEntries, archiveExcludes: ["Game.ini", "Data/"]});
const rtps = [
  rtpRequirement("rpgmaker-xp", "Standard", ["Audio/", "Graphics/Windowskins/", "Graphics/Autotiles/"]),
  rtpRequirement("rpgmaker-vx", "RPGVX", ["Audio/", "Graphics/System/TileA1.png", "Graphics/System/TileB.png"]),
  rtpRequirement("rpgmaker-vx-ace", "RPGVXAce", ["Audio/", "Graphics/Titles1/", "Graphics/Battlebacks1/"]),
];
// Representative layouts of the three official packages, with their real directory and file names.
const layouts: Record<string, Record<string, Uint8Array>> = {
  Standard: {"Audio/BGM/001-Battle01.mid": payload, "Graphics/Windowskins/001-Blue01.png": payload, "Graphics/Autotiles/001-G_Water01.png": payload},
  RPGVX: {"Audio/BGM/Battle1.mid": payload, "Graphics/System/TileA1.png": payload, "Graphics/System/TileB.png": payload, "Graphics/Faces/Actor1.png": payload},
  RPGVXAce: {"Audio/BGM/Battle1.ogg": payload, "Graphics/Titles1/Castle.png": payload, "Graphics/Battlebacks1/Castle.png": payload,
    "Graphics/System/Window.png": payload, "Graphics/Faces/Actor1.png": payload},
};
async function rtpArchive(entries: Record<string, Uint8Array> | Uint8Array, name: string) {
  const root = await mkdtemp(join(tmpdir(), "bios-rtp-")); roots.push(root);
  const bytes = entries instanceof Uint8Array ? entries : zipSync(entries, {level: 9}), path = join(root, name);
  await writeFile(path, bytes);
  return {path, file: {name, sizeBytes: bytes.length, sha256: hash("sha256", bytes), md5: hash("md5", bytes)}};
}
it("[RTP-03] verifies an RTP archive by the marker entries mkxp mounts at its root, without hashing it", async () => {
  const verify = async (entries: Record<string, Uint8Array> | Uint8Array, rtp = rtps[0]) =>
    verifyHostBIOS({requirement: rtp, path: (await rtpArchive(entries, "Standard.zip")).path});
  expect(await verify(layouts.Standard)).toEqual({status: "valid", matchedMembers: 3, expectedMembers: 3, missingMembers: []});
  // Compressing the folder itself puts everything below "Standard/", where mkxp cannot find it.
  expect(await verify(Object.fromEntries(Object.entries(layouts.Standard).map(([name, bytes]) => [`Standard/${name}`, bytes]))))
    .toEqual({status: "invalid", matchedMembers: 0, expectedMembers: 3, missingMembers: ["Audio/", "Graphics/Windowskins/", "Graphics/Autotiles/"]});
  expect(await verify(Uint8Array.of(1, 2, 3)))
    .toEqual({status: "invalid", matchedMembers: 0, expectedMembers: 3, missingMembers: ["Audio/", "Graphics/Windowskins/", "Graphics/Autotiles/"]});
  // The other engine's package is not this one, whichever way round it is installed.
  expect(await verify(layouts.RPGVXAce, rtps[1])).toMatchObject({status: "incomplete",
    missingMembers: ["Graphics/System/TileA1.png", "Graphics/System/TileB.png"]});
  expect(await verify(layouts.RPGVX, rtps[2])).toMatchObject({status: "incomplete", missingMembers: ["Graphics/Titles1/", "Graphics/Battlebacks1/"]});
  expect(await verify({"graphics/titles1/a.png": payload, "AUDIO/a.ogg": payload, "Graphics/BattleBacks1/a.png": payload}, rtps[2])).toMatchObject({status: "valid"});
});
it("[RTP-04] scans identify an RTP by its content regardless of the file name, and never a game package", async () => {
  const identify = async (entries: Record<string, Uint8Array>, name: string) => {
    const {path, file} = await rtpArchive(entries, name);
    return (await identifyHostBIOS({path, file, requirements: rtps})).map(item => item.logicalName);
  };
  expect(await identify(layouts.Standard, "RPGXP_RTP_v1.02.zip")).toEqual(["Standard.zip"]);
  expect(await identify(layouts.RPGVX, "vx-rtp.zip")).toEqual(["RPGVX.zip"]);
  expect(await identify(layouts.RPGVXAce, "RTP Ace (EN).zip")).toEqual(["RPGVXAce.zip"]);
  // A name alone no longer decides: a VX Ace package called RPGVX.zip is the VX Ace RTP.
  expect(await identify(layouts.RPGVXAce, "RPGVX.zip")).toEqual(["RPGVXAce.zip"]);
  expect(await identify({...layouts.RPGVXAce, "Game.ini": payload, "Data/Scripts.rvdata2": payload}, "MyGame.zip")).toEqual([]);
  expect(await identify({"Graphics/a.png": payload, "Audio/a.ogg": payload}, "Standard.zip")).toEqual([]);
  // Distinct packages of the same RTP carry evidence, so a scan ranks them instead of skipping the requirement.
  const {path, file} = await rtpArchive(layouts.RPGVX, "vx.zip");
  expect((await identifyHostBIOS({path, file, requirements: rtps}))[0].candidate)
    .toEqual({memberIdentity: expect.stringMatching(/^[0-9a-f]{64}$/u), matchedMembers: 3, totalMembers: 4});
});
