// @vitest-environment node
import {readFile, readdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {expect, it} from "vitest";
import {contentObjectKey, validateSource} from "./source.js";
import {errorNumbers} from "./errors.js";
it("contract hash closes every ABI file and source keys match independent vectors", async () => {
  const root = new URL("../../contracts/content-io/v1/", import.meta.url);
  const files = (await readdir(root)).sort();
  expect(files).toEqual(["CONTRACT.sha256", "content-io.d.ts", "errors.json", "protocol.schema.json", "vectors.json"]);
  const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
  let listing = "";
  for (const path of files.filter((path) => path !== "CONTRACT.sha256")) {listing += `${path}\n${hash(await readFile(new URL(path, root)))}\n`;}
  expect(hash(listing)).toBe((await readFile(new URL("CONTRACT.sha256", root), "utf8")).trim());
  const vectors = JSON.parse(await readFile(new URL("vectors.json", root), "utf8"));
  const source = validateSource({identity: {kind: "FILE_SHA256", sha256: "a".repeat(64)}, sizeBytes: 786449,
    url: "https://example.test/game", purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256",
    contentLengthPolicy: "EXACT_IF_PRESENT", },
  {storageOrigin: "https://example.test", allowedOrigins: ["https://example.test"]});
  expect(contentObjectKey(source, "https://example.test")).toBe(vectors.objectKeys[0].expectedSha256);
  expect(errorNumbers).toEqual(JSON.parse(await readFile(new URL("errors.json", root), "utf8")));
});
