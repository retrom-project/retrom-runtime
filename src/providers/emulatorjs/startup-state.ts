import {installAzaharStateRestore} from "./azahar-state.js";
import {installEmulatorJs423StateRestoreCompatibility} from "./state-restore.js";

export function installStartupStateRestore(realm: Window, core: string, release: string) {
  if (core === "azahar") {return installAzaharStateRestore(realm);}
  if (release === "4.2.3") {return installEmulatorJs423StateRestoreCompatibility(realm, core === "mame2003_plus");}
  return null;
}
