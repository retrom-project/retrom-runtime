export function copyByteView(value: unknown) {
  if (!ArrayBuffer.isView(value)) {return null;}
  const view = value as ArrayBufferView;
  return Uint8Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

type CheckpointManager = {
  getState?: () => unknown;
  getStateAsync?: () => Promise<unknown>;
  toggleMainLoop?: (running: boolean) => void;
};

export async function readEmulatorJsCheckpoint(
  manager: CheckpointManager | undefined,
  paused: boolean,
  waitForRunningFrame: () => Promise<void> = nextRunningFrame,
) {
  if (!manager) {return null;}
  let initialError: unknown;
  try {
    const bytes = await readCheckpointBytes(manager);
    if (bytes) {return bytes;}
  } catch (error) {
    initialError = error;
  }
  if (!paused || !manager.toggleMainLoop) {
    if (initialError) {throw initialError;}
    return null;
  }
  manager.toggleMainLoop(true);
  try {
    await waitForRunningFrame();
    return readCheckpointBytes(manager);
  } finally {
    manager.toggleMainLoop(false);
  }
}

async function readCheckpointBytes(manager: CheckpointManager) {
  return copyByteView(manager.getStateAsync ? await manager.getStateAsync() : manager.getState?.());
}

function nextRunningFrame() {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {return;}
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, 100);
    if (typeof requestAnimationFrame !== "function") {return;}
    requestAnimationFrame(() => requestAnimationFrame(finish));
  });
}
