export default async function* reporter(events) {
  const assertions = [], diagnostics = [];
  for await (const event of events) {
    if (event.type === "test:diagnostic") diagnostics.push(event.data.message);
    if (["test:pass", "test:fail"].includes(event.type) && event.data.details?.type !== "suite") {
      assertions.push({name: event.data.name, status: event.type === "test:pass" && !event.data.skip && !event.data.todo ? "passed" : "failed"});
    }
  }
  yield JSON.stringify({assertions, diagnostics});
}
