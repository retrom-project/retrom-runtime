/** Formal versions come only from an immutable GitHub release tag. */
export function versionFromTag(tag) {
  if (typeof tag !== "string" || !/^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-rc\.[1-9][0-9]*)?$/u.test(tag)) {
    throw new Error("PROVIDER_RELEASE_TAG_INVALID");
  }
  return tag.slice(1);
}
export function buildVersion(environment = process.env) {
  return environment.GITHUB_REF_TYPE === "tag" ? versionFromTag(environment.GITHUB_REF_NAME) : "0.0.0-dev";
}
