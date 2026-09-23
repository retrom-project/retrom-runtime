/** Formal versions come only from an immutable GitHub release tag. */
export function versionFromTag(tag) {
  if (typeof tag !== "string" || !/^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-rc\.[1-9][0-9]*)?$/u.test(tag)) {
    throw new Error("PROVIDER_RELEASE_TAG_INVALID");
  }
  return tag.slice(1);
}
export function buildVersion(environment = process.env) {
  if (environment.GITHUB_REF_TYPE === "tag") {return versionFromTag(environment.GITHUB_REF_NAME);}
  const candidate = environment.RETROM_PFB_CANDIDATE_VERSION;
  if (candidate !== undefined) {
    if (environment.RETROM_PFB_CANDIDATE_BUILD !== "1" ||
      !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-dev\.[1-9][0-9]*$/u.test(candidate)) {
      throw new Error("PFB_CANDIDATE_VERSION_INVALID");
    }
    return candidate;
  }
  return "0.0.0-dev";
}
