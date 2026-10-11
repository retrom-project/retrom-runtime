import type {ArcadeCatalog, ArcadeMachine} from "./arcade.js";
import {configurationFailure} from "./validation.js";

/** Only firmware declared by this machine's ancestry may satisfy inherited ROM ownership. */
export function arcadeAncestry(machineId: string, catalog: ArcadeCatalog) {
  const parents = [{id: machineId, machine: catalog[machineId]}], seen = new Set([machineId]);
  while (parents.at(-1)!.machine.parent) {
    const id = parents.at(-1)!.machine.parent!, machine = catalog[id];
    if (!machine || seen.has(id) || seen.size >= 32) {configurationFailure("RUNTIME_ARCADE_CATALOG_INVALID");}
    seen.add(id); parents.push({id, machine});
  }
  const devices: Array<{id: string; machine: ArcadeMachine}> = [], visited = new Set<string>(), visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) {configurationFailure("RUNTIME_ARCADE_CATALOG_INVALID");}
    if (visited.has(id)) {return;}
    const machine = catalog[id];
    if (!machine?.device || visiting.size >= 128) {configurationFailure("RUNTIME_ARCADE_CATALOG_INVALID");}
    visiting.add(id);
    for (const child of machine.devices ?? []) {visit(child);}
    visiting.delete(id); visited.add(id); devices.push({id, machine});
  }
  for (const {machine} of parents) {for (const id of machine.devices ?? []) {visit(id);}}
  const firmware = [...parents.filter(({machine}) => machine.bios), ...devices].flatMap(({machine}) => machine.roms);
  return {parents, devices, firmware};
}
