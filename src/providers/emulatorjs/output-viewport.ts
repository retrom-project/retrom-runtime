import type {RuntimeVideoModeV1} from "../../provider/module-api.js";

type OutputSize = {width: number; height: number};
const properties = ["position", "left", "top", "width", "height", "max-width", "max-height", "transform", "transform-origin"];

export function fitEmulatorJsOutput(width: number, height: number, limit: OutputSize) {
  const reduction = Math.max(1, width / limit.width, height / limit.height);
  const outputWidth = Math.max(1, Math.floor(width / reduction));
  const outputHeight = Math.max(1, Math.floor(height / reduction));
  const scale = Math.min(width / outputWidth, height / outputHeight);
  return {width: outputWidth, height: outputHeight, scale,
    left: (width - outputWidth * scale) / 2, top: (height - outputHeight * scale) / 2};
}

export function installEmulatorJsOutputViewport(frame: HTMLIFrameElement, target: HTMLElement, limit: OutputSize) {
  const original = properties.map((name) => ({name, value: frame.style.getPropertyValue(name), priority: frame.style.getPropertyPriority(name)}));
  let videoMode: RuntimeVideoModeV1 = "pixel";
  let active = true;
  const restore = () => {
    for (const {name, value, priority} of original) {
      if (value) {frame.style.setProperty(name, value, priority);}
      else {frame.style.removeProperty(name);}
    }
  };
  const refresh = () => {
    if (!active) {return;}
    if (videoMode !== "pixel" && videoMode !== "original") {restore(); return;}
    const {clientWidth: width, clientHeight: height} = target;
    if (width < 1 || height < 1) {return;}
    const output = fitEmulatorJsOutput(width, height, limit);
    const styles = {
      position: "absolute", left: `${output.left}px`, top: `${output.top}px`,
      width: `${output.width}px`, height: `${output.height}px`,
      "max-width": "none", "max-height": "none", "transform-origin": "top left", transform: `scale(${output.scale})`,
    };
    for (const [name, value] of Object.entries(styles)) {frame.style.setProperty(name, value, "important");}
  };
  const observer = new ResizeObserver(refresh);
  observer.observe(target);
  refresh();
  return {
    setVideoMode(mode: RuntimeVideoModeV1) {videoMode = mode; refresh();},
    cleanup() {active = false; observer.disconnect(); restore();},
  };
}
