import type {RuntimeVideoModeV1} from "../../provider/module-api.js";

type EmulatorVideoInstance = {
  canvas?: HTMLCanvasElement;
  changeSettingOption?: (name: string, value: string) => void;
  enableShader?: (name: string) => void;
  gameManager?: {getFrameNum?: () => number};
};

const modeConfiguration: Record<RuntimeVideoModeV1, {
  shader: string;
  imageRendering: "auto" | "pixelated";
}> = {
  "adaptive-sharpen": {shader: "retrom-adaptive-sharpen", imageRendering: "auto"},
  original: {shader: "retrom-passthrough", imageRendering: "auto"},
  pixel: {shader: "retrom-passthrough", imageRendering: "pixelated"},
  "sharp-bilinear": {shader: "retrom-sharp-bilinear", imageRendering: "pixelated"},
  smooth: {shader: "sabr", imageRendering: "auto"},
};

export function applyEmulatorJsVideoMode(instance: EmulatorVideoInstance, mode: RuntimeVideoModeV1) {
  const configuration = modeConfiguration[mode];
  if (!configuration || !instance.canvas) {return false;}
  instance.canvas.style.setProperty("image-rendering", configuration.imageRendering, "important");
  if (instance.changeSettingOption) {
    instance.changeSettingOption("shader", configuration.shader);
    return true;
  }
  if (instance.enableShader) {
    instance.enableShader(configuration.shader);
    return true;
  }
  return false;
}

export function createEmulatorJsVideoModeController(
  instance: EmulatorVideoInstance,
  scheduler: Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame">,
) {
  let pending: number | null = null;
  const cleanup = () => {
    if (pending !== null) {scheduler.cancelAnimationFrame(pending); pending = null;}
  };
  return {
    setVideoMode(mode: RuntimeVideoModeV1) {
      cleanup();
      if (!applyEmulatorJsVideoMode(instance, mode)) {return false;}
      const manager = instance.gameManager;
      if (!manager?.getFrameNum || !instance.enableShader) {return true;}
      let previous = manager.getFrameNum();
      let advances = 0;
      const refresh = () => {
        pending = null;
        const current = manager.getFrameNum!();
        if (current !== previous) {advances++; previous = current;}
        if (advances < 2) {pending = scheduler.requestAnimationFrame(refresh); return;}
        // The initial native video frames initialize texture coordinates after
        // EJS reports start. Rebind the selected shader once that has happened.
        instance.enableShader!(modeConfiguration[mode].shader);
      };
      pending = scheduler.requestAnimationFrame(refresh);
      return true;
    },
    cleanup,
  };
}
