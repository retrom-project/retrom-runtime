import {expect, it} from "vitest";
import {identifyPSXRegion} from "./psx.js";

function disc(region: string, sectorBytes: number) {
  const bytes = new Uint8Array(5 * 2352);
  bytes.set(new TextEncoder().encode(`Licensed by Sony Computer Entertainment ${region}`), 4 * sectorBytes + 32);
  return bytes;
}
it("reads region from the sector-four license for raw and cooked discs", () => {
  expect(identifyPSXRegion(disc("Amer  ica", 2352))).toBe("US");
  expect(identifyPSXRegion(disc("Europe", 2048))).toBe("EU");
  expect(identifyPSXRegion(disc("Inc.", 2336))).toBe("JP");
});
it("keeps unknown or conflicting evidence unresolved and ignores executable strings", () => {
  const bytes = new Uint8Array(60000);
  bytes.set(new TextEncoder().encode("Licensed by Sony Computer Entertainment Inc."), 55000);
  expect(identifyPSXRegion(bytes)).toBeNull();
  const conflicting = disc("America", 2048);
  conflicting.set(new TextEncoder().encode("Licensed by Sony Computer Entertainment Europe"), 4 * 2352 + 32);
  expect(identifyPSXRegion(conflicting)).toBeNull();
});
