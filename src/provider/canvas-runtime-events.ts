/** Bind and release the input, audio-unlock and cancellation listeners of one canvas session. */
export function canvasRuntimeEvents(frameWindow: Window, options: {
  keyboard: (event: KeyboardEvent) => void;
  releaseKeys: () => void;
  unlock: () => void;
  exit: () => Promise<void>;
  signal?: AbortSignal;
}) {
  const abort = () => {void options.exit();};
  return {
    listen: () => {
      for (const type of ["keydown", "keyup"]) {frameWindow.addEventListener(type, options.keyboard as EventListener);}
      frameWindow.addEventListener("blur", options.releaseKeys); frameWindow.addEventListener("pointerdown", options.unlock);
      options.signal?.addEventListener("abort", abort, {once: true});
    },
    dispose: () => {
      for (const type of ["keydown", "keyup"]) {frameWindow.removeEventListener(type, options.keyboard as EventListener);}
      frameWindow.removeEventListener("blur", options.releaseKeys); frameWindow.removeEventListener("pointerdown", options.unlock);
      options.signal?.removeEventListener("abort", abort);
    },
  };
}
