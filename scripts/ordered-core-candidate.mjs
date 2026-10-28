import {createHash} from "node:crypto";
import {lstat, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

/** Verify the complete, ordered candidate file set before publishing any bytes. */
export function orderedCoreCandidate({id, repository, adapterAbi, filenames, output, maximum, errorCode}) {
  const invalid = () => new Error(errorCode);
  const validSource = (source) => exact(source, ["id", "repository", "upstreamCommit", "adapterAbi", "assets"]) &&
    source.id === id && source.repository === repository && /^[0-9a-f]{40}$/u.test(source.upstreamCommit) &&
    source.adapterAbi === adapterAbi && Array.isArray(source.assets) && source.assets.length === filenames.length &&
    source.assets.every((asset, i) => exact(asset, ["filename", "output", "maxSizeBytes"]) &&
      asset.filename === filenames[i] && asset.output === output(filenames[i]) && asset.maxSizeBytes === maximum(filenames[i]));

  const asCandidateSource = (release) => {
    const source = {id: release?.id, repository: release?.repository, upstreamCommit: release?.upstreamCommit,
      adapterAbi: release?.adapterAbi, assets: release?.assets?.map(({filename, output, maxSizeBytes}) =>
        ({filename, output, maxSizeBytes}))};
    if (!validSource(source)) {throw invalid();}
    return source;
  };
  const bounded = async (path, maximumBytes) => {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maximumBytes) {throw invalid();}
    return readFile(path);
  };
  const stageCandidate = async (source, directory, stage) => {
    if (!directory) {throw new Error("UNPUBLISHED_CORE_INPUT");}
    if (!validSource(source)) {throw invalid();}
    const descriptor = JSON.parse(await bounded(join(directory, "retrom-core-candidate.json"), 65536));
    if (!validDescriptor(descriptor, source, filenames.length)) {throw invalid();}
    if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify([...filenames, "retrom-core-candidate.json"].sort())) {throw invalid();}
    const verified = [];
    for (const [i, file] of descriptor.files.entries()) {
      if (!exact(file, ["filename", "sizeBytes", "sha256"]) || file.filename !== filenames[i] ||
        !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > maximum(file.filename) ||
        !/^[0-9a-f]{64}$/u.test(file.sha256)) {throw invalid();}
      const bytes = await bounded(join(directory, file.filename), maximum(file.filename));
      if (bytes.length !== file.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) {throw invalid();}
      verified.push([output(file.filename), bytes]);
    }
    for (const [path, bytes] of verified) {
      const target = new URL(path, stage);
      await mkdir(new URL(".", target), {recursive: true}); await writeFile(target, bytes);
    }
    return verified.map(([path]) => path);
  };
  return {asCandidateSource, validSource, stageCandidate};
}

function validDescriptor(descriptor, source, fileCount) {
  return exact(descriptor, ["schemaVersion", "kind", "coreId", "repository", "branch", "commit", "dirty",
    "sourceTreeSha256", "adapterAbi", "files"]) && descriptor.schemaVersion === 1 &&
    descriptor.kind === "RETROM_CORE_CANDIDATE_V1" && descriptor.coreId === source.id &&
    descriptor.repository === source.repository && descriptor.adapterAbi === source.adapterAbi &&
    /^[0-9a-f]{40}$/u.test(descriptor.commit) && /^[0-9a-f]{64}$/u.test(descriptor.sourceTreeSha256) &&
    typeof descriptor.dirty === "boolean" && typeof descriptor.branch === "string" && Boolean(descriptor.branch) &&
    Array.isArray(descriptor.files) && descriptor.files.length === fileCount;
}

function exact(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
