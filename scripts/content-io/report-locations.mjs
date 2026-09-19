/** JSON pointers refer to the untouched machine report, never to a copied summary. */
export function locatedAssertions(report, kind) {
  if (kind === "node" && Array.isArray(report.assertions)) return report.assertions.map((value, index) => ({...value, location: `/assertions/${index}`}));
  if (kind === "vitest" && Array.isArray(report.testResults)) return report.testResults.flatMap((suite, si) =>
    suite.assertionResults.map((test, ti) => ({name: test.fullName, status: test.status, location: `/testResults/${si}/assertionResults/${ti}`})));
  if (kind === "playwright" && Array.isArray(report.suites)) {
    const rows = [];
    const visit = (suites, prefix) => suites.forEach((suite, si) => {
      const at = `${prefix}/${si}`;
      (suite.specs ?? []).forEach((spec, pi) => spec.tests.forEach((test, ti) => rows.push({name: spec.title,
        status: test.results.length === 1 && test.results[0].status === "passed" ? "passed" : "failed", location: `${at}/specs/${pi}/tests/${ti}`})));
      visit(suite.suites ?? [], `${at}/suites`);
    });
    visit(report.suites, "/suites"); return rows;
  }
  throw new Error("CONTENT_IO_MACHINE_REPORT_INVALID");
}
export function proofAssertions(report, kind, reportPath) {
  const tests = locatedAssertions(report, kind);
  if (tests.length === 0) throw new Error("CONTENT_IO_ZERO_ASSERTIONS");
  if (tests.some(test => test.status !== "passed")) throw new Error("CONTENT_IO_ASSERTION_FAILED");
  return tests.flatMap(test => [...test.name.matchAll(/\[([A-Z]+-?\d+)\] (CONTRACT|UNIT|BROWSER|CORE|PRODUCT)\/([^\s[]+)/gu)].map(match => ({
    caseId: match[1], level: match[2], subcase: match[3], status: "passed", expected: "passed", observed: test.status,
    reportPath, reportLocation: test.location,
  })));
}
