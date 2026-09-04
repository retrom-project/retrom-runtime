import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {buildProviderClient} from "./provider-client-build.mjs";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildPFBProviderDev(input) {
  validateInput(input);
  const active = await readJSON(input.activePath);
  const provider = active?.providers?.find((item) => item?.providerId === "retrom-runtime");
  if (!provider || !digest(provider.bundleSha256) || !safeRelative(provider.installationPath) ||
    !Array.isArray(provider.targets) || provider.targets.length === 0) {
    throw new Error("PFB_PROVIDER_BASE_INVALID");
  }
  const installation = join(input.installedRoot, provider.installationPath);
  const manifest = await readJSON(join(installation, "provider.json"));
  const integrity = await readJSON(join(installation, "integrity.json"));
  if (manifest?.providerId !== "retrom-runtime" || !Array.isArray(integrity?.files)) {
    throw new Error("PFB_PROVIDER_BASE_INVALID");
  }
  const assetIndex = Object.fromEntries(integrity.files
    .filter((file) => file?.path?.startsWith("assets/") && digest(file.sha256) &&
      Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0)
    .map((file) => [file.path, {sha256: file.sha256, sizeBytes: file.sizeBytes}]));
  const targetDigests = Object.fromEntries(provider.targets.map((target) => {
    if (typeof target?.id !== "string" || !digest(target.targetContractSha256)) {
      throw new Error("PFB_PROVIDER_BASE_INVALID");
    }
    return [target.id, target.targetContractSha256];
  }));
  const parent = dirname(input.outputRoot);
  await mkdir(parent, {recursive: true});
  const staging = await mkdtemp(join(parent, ".provider-dev-"));
  try {
    const clientPath = join(staging, "client.mjs");
    await buildProviderClient({
      assetIndex,
      entryPoint: input.entryPoint,
      outfile: clientPath,
      targetDigests,
    });
    const files = [];
    for (const local of input.localAssets) {
      if (!isAbsolute(local.source) || !safeRelative(local.output)) {
        throw new Error("PFB_PROVIDER_DEV_INPUT_INVALID");
      }
      const contents = await readRegular(local.source);
      const path = `assets/${local.output.replace(/^runtime\//u, "")}`;
      const destination = join(staging, path);
      await mkdir(dirname(destination), {recursive: true});
      await writeFile(destination, contents, {mode: 0o644});
      files.push(fileDescriptor(path, contents));
    }
    files.push(fileDescriptor("client.mjs", await readRegular(clientPath)));
    files.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
    const revision = developmentRevision("retrom-runtime", provider.bundleSha256, files);
    const descriptor = {
      schemaVersion: 1,
      providerId: "retrom-runtime",
      baseBundleSha256: provider.bundleSha256,
      revision,
      files,
    };
    const revisions = join(input.outputRoot, "revisions");
    await mkdir(revisions, {recursive: true});
    await publishRevision(staging, join(revisions, revision), files);
    await atomicWrite(join(input.outputRoot, "dev-provider.json"), canonicalBytes(descriptor));
    return {baseBundleSha256: provider.bundleSha256, revision};
  } finally {
    await rm(staging, {recursive: true, force: true});
  }
}

async function publishRevision(staging, destination, files) {
  try {
    await rename(staging, destination);
    return;
  } catch (error) {
    if (!new Set(["EEXIST", "ENOTEMPTY"]).has(error?.code)) { throw error; }
  }
  for (const file of files) {
    const contents = await readRegular(join(destination, file.path));
    if (contents.byteLength !== file.sizeBytes || sha256(contents) !== file.sha256) {
      throw new Error("PFB_PROVIDER_DEV_REVISION_CONFLICT");
    }
  }
}

async function atomicWrite(path, contents) {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, {mode: 0o600});
    await rename(temporary, path);
  } finally {
    await rm(temporary, {force: true});
  }
}

function validateInput(input) {
  if (!input || !isAbsolute(input.activePath) || !isAbsolute(input.entryPoint) ||
    !isAbsolute(input.installedRoot) || !isAbsolute(input.outputRoot) ||
    !Array.isArray(input.localAssets)) {
    throw new Error("PFB_PROVIDER_DEV_INPUT_INVALID");
  }
}

async function readJSON(path) {
  return JSON.parse((await readRegular(path)).toString("utf8"));
}

async function readRegular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1) {
    throw new Error("PFB_PROVIDER_DEV_INPUT_INVALID");
  }
  return readFile(path);
}

function fileDescriptor(path, contents) {
  return {
    path,
    sizeBytes: contents.byteLength,
    sha256: sha256(contents),
    mediaType: path.endsWith(".rb") ? "text/plain; charset=utf-8" : "text/javascript; charset=utf-8",
  };
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(sortValue(value))}\n`, "utf8");
}

function sortValue(value) {
  if (Array.isArray(value)) { return value.map(sortValue); }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

function safeRelative(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") &&
    !value.includes("\\") && !value.includes("\0") &&
    value.split("/").every((part) => part && part !== "." && part !== "..");
}

function digest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function developmentRevision(providerId, bundle, files) {
  const lines = [providerId, bundle];
  for (const file of [...files].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)))) {
    lines.push(file.path, String(file.sizeBytes), file.sha256, file.mediaType);
  }
  return sha256(`${lines.join("\n")}\n`);
}

export const defaultPFBProviderDevInput = {
  entryPoint: join(runtimeRoot, "src/providers/retrom-runtime/module.ts"),
};
