import {readFileSync} from "node:fs";
import {resolve} from "node:path";

import {describe, expect, it} from "vitest";

import type {TargetOptionsSchema} from "./declarations.js";
import {validateTargetOptionsAgainstSchema} from "./module-api.js";

type Fixture = {
  schema: TargetOptionsSchema;
  cases: Array<{valid: boolean; value: Record<string, unknown>}>;
};

describe("shared targetOptions schema fixtures", () => {
  it("agrees with the Host validator for every exact Provider-owned case", () => {
    const path = resolve(process.cwd(), "contracts/retrom-provider/v1/fixtures/target-options/schema-validation.json");
    const fixture = JSON.parse(readFileSync(path, "utf8")) as Fixture;
    for (const candidate of fixture.cases) {
      const action = () => validateTargetOptionsAgainstSchema(candidate.value, fixture.schema);
      if (candidate.valid) {expect(action()).toBe(candidate.value);}
      else {expect(action).toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");}
    }
  });
});
