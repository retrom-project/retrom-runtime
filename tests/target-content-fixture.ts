import {bindTargetContent} from "../src/provider/target-content.js";
import type {ContentSessionAccess} from "../src/provider/content-inputs.js";
import {retromRuntimeProviderDefinition} from "../src/providers/retrom-runtime/catalog.js";
import {emulatorJsProviderDefinition} from "../src/providers/emulatorjs/catalog.js";
export function targetContentFixture(session: ContentSessionAccess, id: string) {
  const target = [...retromRuntimeProviderDefinition.targets, ...emulatorJsProviderDefinition.targets].find(entry => entry.id === id);
  if (!target) {throw new Error(`Unknown fixture Target: ${id}`);}
  const unused = () => {throw new Error("Fixture used an unstubbed session operation");};
  return bindTargetContent({open: session.open?.bind(session) ?? unused,
    materialize: session.materialize?.bind(session) ?? unused, closeFile: session.closeFile?.bind(session) ?? unused}, target);
}
