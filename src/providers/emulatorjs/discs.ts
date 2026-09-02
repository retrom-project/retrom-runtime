import type {RuntimeDiscStateV1, RuntimeMultiDiscResourceV1} from "../../provider/module-api.js";

export type EmulatorDiscInstance = {
  allSettings?: Record<string, unknown>;
  gameManager?: {
    getDiskCount?: () => number;
    getCurrentDisk?: () => number;
    setCurrentDisk?: (index: number) => void;
    toggleMainLoop?: (running: boolean) => void;
  };
};

export function initializeEmulatorJsDiscs(instance: EmulatorDiscInstance) {
  if (instance.allSettings === undefined) {
    instance.allSettings = {};
    return;
  }
  if (Object.prototype.toString.call(instance.allSettings) !== "[object Object]") {throw discError();}
}

export function readEmulatorJsDiscState(
  instance: EmulatorDiscInstance,
  resource: RuntimeMultiDiscResourceV1,
): RuntimeDiscStateV1 {
  const count = instance.gameManager?.getDiskCount?.();
  const currentIndex = instance.gameManager?.getCurrentDisk?.();
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(currentIndex) || count === undefined ||
    currentIndex === undefined || count !== resource.entries.length || count < 2 || count > 8 ||
    currentIndex < 0 || currentIndex >= count) {throw discError();}
  return {count, currentIndex, labels: resource.entries.map((entry) => entry.label)};
}

export function switchEmulatorJsDisc(
  instance: EmulatorDiscInstance,
  resource: RuntimeMultiDiscResourceV1,
  targetIndex: number,
) {
  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex >= resource.entries.length) {
    throw discError();
  }
  const before = readEmulatorJsDiscState(instance, resource);
  if (before.currentIndex === targetIndex) {return {changed: false, state: before};}
  const setCurrentDisk = instance.gameManager?.setCurrentDisk;
  if (!setCurrentDisk) {throw discError();}
  setCurrentDisk.call(instance.gameManager, targetIndex);
  const after = readEmulatorJsDiscState(instance, resource);
  if (after.currentIndex !== targetIndex) {throw discError();}
  return {changed: true, state: after};
}

function discError() {return new Error("PLAYER_DISC_RUNTIME_INVALID");}
