import {expect, it} from "vitest";
import {contentLoadingCapability} from "./content-loading.js";
import {mameArcadeTarget, mameAppleTarget} from "../providers/retrom-runtime/mame-declaration.js";
it("offers on-demand loading when an eagerly loaded ROM has range-backed companions", () => {
  expect(contentLoadingCapability(mameArcadeTarget)).toEqual({contentLoading: "ON_DEMAND_AND_PRELOAD"});
  expect(contentLoadingCapability(mameAppleTarget)).toEqual({contentLoading: "PRELOAD_ONLY"});
});
