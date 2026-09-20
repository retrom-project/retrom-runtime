import {locatedAssertions} from "./report-locations.mjs";
export function assertionsFrom(report, kind) {
  return locatedAssertions(report, kind).map(({name, status}) => ({name, status}));
}
