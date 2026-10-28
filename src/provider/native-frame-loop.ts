/** Fixed-rate native emulation on the browser's animation clock, capped at 100 ms catch-up. */
export function nativeFrameLoop(frameWindow: Window, options: {
  active: () => boolean;
  framesPerSecond: () => number;
  timingError: string;
  step: () => void;
  draw: () => void;
  onFailure: (error: unknown) => void;
}) {
  let request = 0, previous = 0, elapsed = 0;
  const tick = (time: number) => {
    if (!options.active()) {return;}
    elapsed += Math.min(100, previous ? time - previous : 1000 / options.framesPerSecond()); previous = time;
    try {
      const interval = 1000 / options.framesPerSecond();
      if (!Number.isFinite(interval) || interval < 5 || interval > 100) {throw new Error(options.timingError);}
      while (elapsed >= interval) {options.step(); elapsed -= interval;}
      options.draw(); request = frameWindow.requestAnimationFrame(tick);
    } catch (error) {options.onFailure(error);}
  };
  const start = () => {request = frameWindow.requestAnimationFrame(tick);};
  return {
    start,
    stop: () => {frameWindow.cancelAnimationFrame(request);},
    resume: () => {previous = 0; elapsed = 0; start();},
  };
}
