import {strict as assert} from "node:assert";
import {test} from "node:test";
import {assertFormalCoreSources} from "./release-source-policy.mjs";

const stable = {id: "example", tag: "retrom-core-g123456789abc-r1"};
const candidate = {...stable, tag: `${stable.tag}-rc.1`};

test("stable runtime rejects RC cores in either Provider source catalog", () => {
  assert.throws(() => assertFormalCoreSources({upstreamReleases: [candidate]}, {}, "v1.2.3"),
    /STABLE_RELEASE_RC_CORE_FORBIDDEN/u);
  assert.throws(() => assertFormalCoreSources({upstreamReleases: []}, {forks: [candidate]}, "v1.2.3"),
    /STABLE_RELEASE_RC_CORE_FORBIDDEN/u);
});

test("RC runtime accepts RC pins; stable pins and upstream pre resource versions stay valid", () => {
  assertFormalCoreSources({upstreamReleases: [candidate]}, {forks: [candidate]}, "v1.2.3-rc.1");
  assertFormalCoreSources({upstreamReleases: [stable]},
    {forks: [stable], releases: [{id: "4.3.0-pre"}]}, "v1.2.3");
});

test("all formal releases reject development core inputs", () => {
  for (const tag of ["v1.2.3", "v1.2.3-rc.1"]) {
    assert.throws(() => assertFormalCoreSources({upstreamReleases: [], developmentInputs: [stable]}, {}, tag),
      /FORMAL_RELEASE_DEVELOPMENT_CORE_FORBIDDEN/u);
    for (const property of ["developmentCores", "developmentForks"]) {
      assert.throws(() => assertFormalCoreSources({upstreamReleases: []}, {[property]: [stable]}, tag),
        /FORMAL_RELEASE_DEVELOPMENT_CORE_FORBIDDEN/u);
    }
  }
});
