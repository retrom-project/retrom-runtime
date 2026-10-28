import {strict as assert} from "node:assert";
import {test} from "node:test";
import {ESLint} from "eslint";
import configuration from "../eslint.config.js";

test("lint exclusions stay within the reviewed generated and dependency paths", () => {
  assert.deepEqual(configuration.filter((entry) => entry.ignores).map((entry) => entry.ignores),
    [["dist/**", "release/**", "node_modules/**"]]);
});

test("lint policy covers new production and test paths at the existing strength", async () => {
  const eslint = new ESLint();
  for (const path of ["src/new-feature/example.ts", "tests/new-feature/example.test.ts"]) {
    const config = await eslint.calculateConfigForFile(path);
    assert.ok(config, `${path} must be linted`);
    assert.deepEqual(config.rules.complexity, [2, 18]);
    assert.deepEqual(config.rules["max-lines"], [2, {max: 600, skipBlankLines: true, skipComments: true}]);
    assert.equal(config.rules["@typescript-eslint/no-explicit-any"][0], 2);
  }
});
