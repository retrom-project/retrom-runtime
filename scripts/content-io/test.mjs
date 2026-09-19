import {argumentsFor, main} from "./cli.mjs";
import {runStage} from "./stage.mjs";
export async function test() {
  const args = argumentsFor({stage: {type: "string"}, env: {type: "string"}}, ["stage", "env"]);
  if (args.help) {console.log("test --stage Sxx --env <absolute environment.json>; runs the frozen stage validation"); return;}
  process.argv = [process.execPath, process.argv[1], "run", args.stage, "--env", args.env];
  await runStage();
}
main(import.meta.url, test);
