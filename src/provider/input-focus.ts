// Resuming from Host chrome returns keyboard ownership to the runtime surface.
// Isolated web projects expose a WindowProxy instead of a readable canvas.
export function focusRuntimeInput(canvas: HTMLCanvasElement | null, runtimeWindow: Window | null) {
  if (canvas) {
    canvas.tabIndex = 0;
    canvas.focus({preventScroll: true});
  } else {
    runtimeWindow?.focus();
  }
}
