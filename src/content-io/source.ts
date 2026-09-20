import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import type {ContentSourceV1, ContentIdentityV1} from "../../contracts/content-io/v1/content-io.js";
import {fail} from "./errors.js";
export const BLOCK_BYTES = 262144;
export const MAX_READ_BYTES = 16777216;
export const isDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function exact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}
export function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
export function canonicalPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    !value.includes("\\") && printable(value) && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
export function validateReadBounds(size: number, offset: number, length: number, maximum = MAX_READ_BYTES): void {
  if (!integer(size) || !integer(offset) || !integer(length, 0, maximum) || offset > size || length > size - offset) {fail("BOUNDS");}
}
export type SourceContext = Readonly<{storageOrigin: string; allowedOrigins: readonly string[]}>;
export function validateSource(value: unknown, context: SourceContext): ContentSourceV1 {
  if (!exact(value, ["identity", "sizeBytes", "url", "purpose", "transport", "etagPolicy", "contentLengthPolicy"]) ||
    !integer(value.sizeBytes)) {fail("SOURCE_INVALID");}
  const identity = validateIdentity(value.identity);
  const url = validateURL(value.url, context.allowedOrigins);
  const {purpose, transport, etagPolicy, contentLengthPolicy, sizeBytes} = value;
  if (purpose !== "GAME" && purpose !== "FIRMWARE" && purpose !== "CORE_ASSET") {fail("SOURCE_INVALID");}
  if (transport !== "RANGE_REQUIRED" && transport !== "WHOLE_ALLOWED") {fail("SOURCE_INVALID");}
  if (etagPolicy !== "EXPECTED_SHA256" && etagPolicy !== "PIN_STRONG" && etagPolicy !== "NONE_FULL_SHA256" && etagPolicy !== "IMMUTABLE_ASSET") {fail("SOURCE_INVALID");}
  if (contentLengthPolicy !== "EXACT_IF_PRESENT" && contentLengthPolicy !== "REQUIRED_EXACT") {fail("SOURCE_INVALID");}
  validateProfile(identity, purpose, transport, etagPolicy);
  return Object.freeze({identity, sizeBytes, url, purpose, transport, etagPolicy, contentLengthPolicy});
}
function validateIdentity(value: unknown): ContentIdentityV1 {
  if (exact(value, ["kind", "sha256"]) && value.kind === "FILE_SHA256" && isDigest(value.sha256)) {
    return Object.freeze({kind: value.kind, sha256: value.sha256});
  }
  if (exact(value, ["kind", "projectDigest", "logicalPath"]) && value.kind === "INDEX_ENTRY" &&
    isDigest(value.projectDigest) && canonicalPath(value.logicalPath)) {
    return Object.freeze({kind: value.kind, projectDigest: value.projectDigest, logicalPath: value.logicalPath});
  }
  return fail("SOURCE_INVALID");
}
function validateURL(value: unknown, origins: readonly string[]): string {
  if (typeof value !== "string" || (value.includes("\\") || /\s/u.test(value) || !printable(value))) {fail("SOURCE_INVALID");}
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || !origins.includes(url.origin)) {fail("SOURCE_INVALID");}
    return url.href;
  } catch {return fail("SOURCE_INVALID");}
}
function validateProfile(identity: ContentIdentityV1, purpose: ContentSourceV1["purpose"], transport: ContentSourceV1["transport"], etag: ContentSourceV1["etagPolicy"]) {
  if (identity.kind === "INDEX_ENTRY") {
    if (etag !== "PIN_STRONG" || purpose === "CORE_ASSET") {fail("SOURCE_INVALID");}
  } else if (purpose !== "CORE_ASSET") {
    if (etag !== "EXPECTED_SHA256") {fail("SOURCE_INVALID");}
  } else if (!((transport === "WHOLE_ALLOWED" && etag === "NONE_FULL_SHA256") ||
      (transport === "RANGE_REQUIRED" && etag === "IMMUTABLE_ASSET"))) {fail("SOURCE_INVALID");}
}
export function contentObjectKey(source: ContentSourceV1, storageOrigin: string): string {
  const id = source.identity;
  const fields = ["retrom-content-io", 1, storageOrigin, new URL(source.url).origin, source.purpose,
    id.kind, id.kind === "FILE_SHA256" ? id.sha256 : id.projectDigest, id.kind === "FILE_SHA256" ? "" : id.logicalPath, source.sizeBytes];
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(fields))));
}

function printable(value: string): boolean {
  return [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
}
