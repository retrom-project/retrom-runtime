import {contentHash, kirikiriEntryCandidates, kirikiriArchiveProbeBytes} from "../dist/runtime/index.js";
import {contentStream} from "./runtime-host-content.mjs";
import {requireLocator} from "./runtime-archive-input.mjs";

/** Shared entry evidence for configuration and the read-only candidate projection. */
export async function withKirikiriEntryEvidence(input, signal) {
  const evidence = {...input.evidence};
  for (const file of input.files) {
    signal?.throwIfAborted();
    if (file.sizeBytes < kirikiriArchiveProbeBytes || evidence[file.logicalKey]?.prefixBase64 !== undefined || !input.locators?.[file.logicalKey]) {continue;}
    const chunks = [];
    for await (const chunk of contentStream(requireLocator(input, file), {length: kirikiriArchiveProbeBytes, signal})) {chunks.push(chunk);}
    evidence[file.logicalKey] = {...evidence[file.logicalKey], prefixBase64: Buffer.concat(chunks).toString("base64")};
  }
  return {...input, evidence};
}

/** Filter by the same runtime rules used for selection, then form a bounded page. */
export async function hostKirikiriEntryCandidates(input, signal) {
  signal?.throwIfAborted();
  const {after = "", prefix = "", limit = 100} = input;
  if (input.platformId !== "kirikiri" || !queryPath(after) || !queryPath(prefix) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("RUNTIME_CONFIGURATION_INVALID");
  }
  contentHash(input.files, "TREE");
  const cursor = Buffer.from(after);
  const files = input.files.filter(file => Buffer.compare(Buffer.from(file.logicalKey), cursor) > 0 && file.logicalKey.startsWith(prefix))
    .sort((left, right) => Buffer.compare(Buffer.from(left.logicalKey), Buffer.from(right.logicalKey)));
  const entries = [];
  for (const file of files) {
    signal?.throwIfAborted();
    const candidate = {...input, files: [file]};
    const known = kirikiriEntryCandidates(candidate);
    const matched = known.length ? known : kirikiriEntryCandidates(await withKirikiriEntryEvidence(candidate, signal));
    entries.push(...matched);
    if (entries.length > limit) {break;}
  }
  const page = entries.slice(0, limit);
  return {entries: page, nextCursor: entries.length > limit ? page.at(-1) : null};
}

function queryPath(value) {
  return typeof value === "string" && Buffer.byteLength(value) <= 1024 && Buffer.from(value).toString("utf8") === value;
}
