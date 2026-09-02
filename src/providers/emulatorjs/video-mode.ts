import type {RuntimeVideoModeV1} from "../../provider/module-api.js";

type EmulatorVideoInstance = {
  canvas?: HTMLCanvasElement;
  changeSettingOption?: (name: string, value: string) => void;
  enableShader?: (name: string) => void;
};

const modeConfiguration: Record<RuntimeVideoModeV1, {
  shader: string;
  imageRendering: "auto" | "pixelated";
}> = {
  "adaptive-sharpen": {shader: "retrom-adaptive-sharpen", imageRendering: "auto"},
  original: {shader: "disabled", imageRendering: "auto"},
  pixel: {shader: "disabled", imageRendering: "pixelated"},
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
