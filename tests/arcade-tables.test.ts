// @vitest-environment node
import {expect, it} from "vitest";
import {arcadeTables} from "../scripts/runtime-host-input.mjs";

it("shares the first DAT load and parsed objects between concurrent callers", async () => {
  const catalogs = await Promise.all(Array.from({length: 8}, () => arcadeTables()));
  for (const catalog of catalogs) {expect(catalog).toBe(catalogs[0]);}
  for (const core of ["fbalpha", "fbneo", "mame2003", "mame2003_plus", "mame_arcade"]) {
    expect(catalogs[0][core].pacman.description).toContain("Pac");
  }
});
