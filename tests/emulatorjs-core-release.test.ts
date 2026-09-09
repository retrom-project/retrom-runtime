// @vitest-environment node
import {createHash} from "node:crypto";
import {expect, it} from "vitest";
import {readEmulatorJsCoreRelease} from "../scripts/emulatorjs-core-release.mjs";

it("verifies published core identity, closed file set and exact bytes before materialization", async () => {
  const repository = "https://github.com/retrom-project/flycast-wasm";
  const tag = "retrom-core-1.0-r1";
  const records = [
    ["LICENSE", "4.2.3/licenses/flycast/LICENSE"],
    ["flycast-wasm.data", "4.2.3/data/cores/flycast-wasm.data"],
    ["flycast.json", "4.2.3/data/cores/reports/flycast.json"],
  ].map(([filename, output]) => {
    const bytes = Buffer.from(filename!);
    return {filename: filename!, output: output!, sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      url: `${repository}/releases/download/${tag}/${filename}`, maxSizeBytes: 1000};
  });
  const release = {id: "flycast", repository, tag, commit: "a".repeat(40),
    adapterAbi: "emulatorjs-flycast-state-v1", assets: records,
    metadataUrl: `${repository}/releases/download/${tag}/rpg-runtime-release.json`};
  const metadata = {schemaVersion: 1, repository, tag, commit: release.commit,
    adapterAbi: release.adapterAbi, files: records.map(({filename, sizeBytes, sha256}) => ({filename, sizeBytes, sha256}))};
  let corrupt = false;
  const fetchBytes = async (url: string) => url === release.metadataUrl
    ? Buffer.from(JSON.stringify(metadata)) : Buffer.from(corrupt ? "corrupted" : url.split("/").at(-1)!);
  expect((await readEmulatorJsCoreRelease(release, fetchBytes)).size).toBe(3);
  metadata.commit = "b".repeat(40);
  await expect(readEmulatorJsCoreRelease(release, fetchBytes)).rejects.toThrow("EMULATORJS_CORE_RELEASE_INVALID");
  metadata.commit = release.commit;
  metadata.files.push(metadata.files[0]!);
  await expect(readEmulatorJsCoreRelease(release, fetchBytes)).rejects.toThrow("EMULATORJS_CORE_RELEASE_INVALID");
  metadata.files.pop();
  corrupt = true;
  await expect(readEmulatorJsCoreRelease(release, fetchBytes)).rejects.toThrow("EMULATORJS_CORE_RELEASE_INVALID");
});
