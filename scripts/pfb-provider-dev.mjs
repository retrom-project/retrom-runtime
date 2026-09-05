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
  if (provider.targets.some((target) => !validActiveTarget(target))) {
    throw new Error("PFB_PROVIDER_BASE_INVALID");
  }
  const parent = dirname(input.outputRoot);
  await mkdir(parent, {recursive: true});
  const staging = await mkdtemp(join(parent, ".provider-dev-"));
  try {
    const clientPath = join(staging, "client.mjs");
    await buildProviderClient({
      assetIndex,
      entryPoint: input.entryPoint,
      outfile: clientPath,
    });
    const files = [];
    for (const local of input.localAssets) {
      if (!isAbsolute(local.source) || !safeRelative(local.output)) {
        throw new Error("PFB_PROVIDER_DEV_INPUT_INVALID");
      }
      const contents = await readRegular(local.source);
      const path = `assets/${local.output.replace(/^runtime\//u, "")}`;
      files.push(fileDescriptor(path, contents));
    }
    files.push(fileDescriptor("client.mjs", await readRegular(clientPath)));
    files.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
    const descriptor = {
      schemaVersion: 1,
      providerId: "retrom-runtime",
      baseBundleSha256: provider.bundleSha256,
      files,
    };
    await mkdir(input.outputRoot, {recursive: true});
    await atomicWrite(join(input.outputRoot, "dev-provider.json"), canonicalBytes(descriptor));
    return {baseBundleSha256: provider.bundleSha256, moduleSha256: files.find((file) => file.path === "client.mjs").sha256};
  } finally {
    await rm(staging, {recursive: true, force: true});
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
    contentBase64: contents.toString("base64"),
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

function validActiveTarget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== "checkpoint\0id" ||
    typeof value.id !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(value.id)) {
    return false;
  }
  const checkpoint = value.checkpoint;
  if (checkpoint === null) {return true;}
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint) ||
    Object.keys(checkpoint).sort().join("\0") !== "maxBytes\0readFormats\0writeFormat" ||
    !Number.isSafeInteger(checkpoint.maxBytes) || checkpoint.maxBytes < 1 ||
    typeof checkpoint.writeFormat !== "string" || !Array.isArray(checkpoint.readFormats)) {
    return false;
  }
  const formats = checkpoint.readFormats;
  return formats.length > 0 && formats.includes(checkpoint.writeFormat) &&
    formats.every((format) => typeof format === "string" && /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u.test(format)) &&
    formats.every((format, index) => index === 0 || formats[index - 1] < format);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export const defaultPFBProviderDevInput = {
  entryPoint: join(runtimeRoot, "src/providers/retrom-runtime/module.ts"),
};
