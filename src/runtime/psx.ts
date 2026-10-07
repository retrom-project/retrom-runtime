export type PSXRegion = "JP" | "US" | "EU";

/** Read only the disc's sector-four license, independently of a title or filename. */
export function identifyPSXRegion(systemArea: Uint8Array): PSXRegion | null {
  const regions = new Set<PSXRegion>();
  for (const sectorBytes of [2048, 2336, 2352]) {
    const text = new TextDecoder("latin1").decode(systemArea.subarray(4 * sectorBytes, 5 * sectorBytes))
      .replace(/\s/gu, "").toLowerCase();
    const prefix = "licensedbysonycomputerentertainment";
    if (text.includes(`${prefix}america`)) {regions.add("US");}
    if (text.includes(`${prefix}europe`)) {regions.add("EU");}
    if (text.includes(`${prefix}inc`)) {regions.add("JP");}
  }
  return regions.size === 1 ? [...regions][0] : null;
}
