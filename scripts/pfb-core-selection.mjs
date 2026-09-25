// A PFB may track several core worktrees while validating one core at a time.
// The candidate records only the explicitly selected, already built inputs.
export function selectedPfbCoreIds(raw, cores) {
  const available = new Set(cores.map((core) => core.id));
  if (raw === undefined) return available;
  const ids = raw.split(",");
  if (!ids.length || ids.some((id) => !/^[a-z0-9_]{1,64}$/u.test(id) || !available.has(id)) ||
    new Set(ids).size !== ids.length) {
    throw new Error("PFB_CORE_SELECTION_INVALID");
  }
  return new Set(ids);
}
