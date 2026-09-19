import {readFile, realpath} from "node:fs/promises";
import {isAbsolute, join, relative} from "node:path";
/** Fork fixtures are selected by the resolved PFB environment, never a baseline checkout. */
export async function coreFixturePath(coreId: string, path: string): Promise<string> {
  const environmentPath = process.env.RETROM_CONTENT_IO_ENV;
  if (!environmentPath || !isAbsolute(environmentPath)) {throw new Error("CONTENT_IO_ENV_REQUIRED");}
  const environment = JSON.parse(await readFile(environmentPath, "utf8")) as {
    pfb: {projectRoot: string}; repositories: {cores: Record<string, {root: string; availability: string}>};
  };
  const core = environment.repositories.cores[coreId];
  if (!core || core.availability !== "AVAILABLE") {throw new Error("CONTENT_IO_CORE_UNAVAILABLE");}
  const project = await realpath(environment.pfb.projectRoot), root = await realpath(core.root), file = await realpath(join(root, path));
  for (const part of [relative(project, root), relative(root, file)]) {
    if (isAbsolute(part) || part.startsWith("..")) {throw new Error("CONTENT_IO_CORE_PATH_INVALID");}
  }
  return file;
}
