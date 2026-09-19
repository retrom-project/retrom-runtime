import type {ContentInputPolicyV1, ManagedInputPolicyV1, ContentSourceV1} from "../../contracts/content-io/v1/content-io.js";
import {exact, integer, record} from "./source.js";
import {fail} from "./errors.js";

export function validateManagedPolicy(value: unknown): ManagedInputPolicyV1 {
  if (!exact(value, ["mode", "bridge", "result", "maxFileBytes", "workspace", "writes", "contentLengthPolicy"]) ||
    !integer(value.maxFileBytes)) {fail("SOURCE_INVALID");}
  const mode = choice(value.mode, ["RANGE", "EAGER", "ON_OPEN"] as const);
  const bridge = choice(value.bridge, ["ASYNC", "SYNC_WORKER", "POLLING", "WASMFS", "VLFS", "NONE"] as const);
  const result = choice(value.result, ["READER", "BYTES", "BLOB", "WORKSPACE_FILE"] as const);
  const workspace = choice(value.workspace, ["NONE", "OPFS_REQUIRED"] as const);
  const writes = choice(value.writes, ["DENY", "SESSION_OVERLAY"] as const);
  const contentLengthPolicy = choice(value.contentLengthPolicy, ["EXACT_IF_PRESENT", "REQUIRED_EXACT"] as const);
  const maxFileBytes = value.maxFileBytes;
  if (mode === "RANGE" ? result !== "READER" || bridge === "NONE" : result === "READER" || bridge !== "NONE") {fail("SOURCE_INVALID");}
  if ((result === "WORKSPACE_FILE") !== (workspace === "OPFS_REQUIRED")) {fail("SOURCE_INVALID");}
  return Object.freeze({mode, bridge, result, maxFileBytes, workspace, writes, contentLengthPolicy});
}
export function validateContentPolicies(roles: readonly string[], value: unknown, registeredBoundaries: readonly string[]): Readonly<Record<string, ContentInputPolicyV1>> {
  if (new Set(roles).size !== roles.length || !record(value) || !exact(value, roles)) {fail("SOURCE_INVALID");}
  const policies: Record<string, ContentInputPolicyV1> = Object.create(null);
  for (const role of roles) {
    const policy = value[role];
    if (exact(policy, ["mode", "boundaryId"]) && (policy.mode === "BROWSER_NATIVE" || policy.mode === "UPSTREAM_LOADER")) {
      if (typeof policy.boundaryId !== "string" || !registeredBoundaries.includes(policy.boundaryId)) {fail("SOURCE_INVALID");}
      policies[role] = Object.freeze({mode: policy.mode, boundaryId: policy.boundaryId});
    } else {policies[role] = validateManagedPolicy(policy);}
  }
  return Object.freeze(policies);
}
export function validateSourcePolicy(source: ContentSourceV1, policy: ManagedInputPolicyV1): void {
  if (source.sizeBytes > policy.maxFileBytes || source.contentLengthPolicy !== policy.contentLengthPolicy ||
    policy.mode === "RANGE" && (source.transport !== "RANGE_REQUIRED" || source.etagPolicy === "NONE_FULL_SHA256")) {fail("SOURCE_INVALID");}
}

function choice<Value extends string>(value: unknown, options: readonly Value[]): Value {
  for (const option of options) {if (value === option) {return option;}}
  return fail("SOURCE_INVALID");
}
