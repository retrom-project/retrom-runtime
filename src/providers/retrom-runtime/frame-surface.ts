export type RuntimeFrameSurface = {
  cleanup(): void;
  refresh(): void;
  target: HTMLElement;
};

type RuntimeFrameWindow = Window & {
  MutationObserver: typeof MutationObserver;
  ResizeObserver?: typeof ResizeObserver;
};

const frameStyleText = `
html,body,#game{width:100%!important;height:100%!important;margin:0!important;overflow:hidden!important;background:#05060a}
#game{position:relative!important}
canvas{display:block;max-width:none!important;max-height:none!important;margin:auto!important;image-rendering:pixelated!important}
`;

export function installRuntimeFrameSurface(
  frameWindow: Window,
  getCanvas: () => HTMLCanvasElement | null,
): RuntimeFrameSurface {
  const runtimeWindow = frameWindow as RuntimeFrameWindow;
  const frameDocument = frameWindow.document;
  frameDocument.documentElement.lang = "zh-CN";
  const style = frameDocument.createElement("style");
  style.dataset.retromRuntimeFrame = "";
  style.textContent = frameStyleText;
  frameDocument.head.append(style);
  const target = frameDocument.createElement("div");
  target.id = "game";
  frameDocument.body.replaceChildren(target);

  const refresh = () => {
    const canvas = getCanvas() ?? frameDocument.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) {return;}
    fitCanvasToViewport(canvas, frameWindow.innerWidth, frameWindow.innerHeight);
  };
  const mutationObserver = new runtimeWindow.MutationObserver(refresh);
  mutationObserver.observe(frameDocument.documentElement, {
    attributes: true,
    attributeFilter: ["height", "width"],
    childList: true,
    subtree: true,
  });
  const ResizeObserverConstructor = runtimeWindow.ResizeObserver;
  const resizeObserver = ResizeObserverConstructor ? new ResizeObserverConstructor(refresh) : null;
  resizeObserver?.observe(frameDocument.documentElement);
  frameWindow.addEventListener("resize", refresh);
  refresh();
  return {
    cleanup: () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      frameWindow.removeEventListener("resize", refresh);
      style.remove();
      target.remove();
    },
    refresh,
    target,
  };
}

function fitCanvasToViewport(
  canvas: HTMLCanvasElement,
  viewportWidth: number,
  viewportHeight: number,
) {
  if (![viewportWidth, viewportHeight, canvas.width, canvas.height]
    .every((value) => Number.isFinite(value) && value > 0)) {return;}
  const contentRatio = canvas.width / canvas.height;
  const viewportRatio = viewportWidth / viewportHeight;
  const width = contentRatio >= viewportRatio ? viewportWidth : viewportHeight * contentRatio;
  const height = contentRatio >= viewportRatio ? viewportWidth / contentRatio : viewportHeight;
  const alignedWidth = Math.max(1, Math.round(width));
  const alignedHeight = Math.max(1, Math.round(height));
  canvas.style.setProperty("width", `${alignedWidth}px`, "important");
  canvas.style.setProperty("height", `${alignedHeight}px`, "important");
  canvas.style.setProperty("max-width", "none", "important");
  canvas.style.setProperty("max-height", "none", "important");
  canvas.style.setProperty("position", "absolute", "important");
  canvas.style.setProperty("left", `${Math.floor((viewportWidth - alignedWidth) / 2)}px`, "important");
  canvas.style.setProperty("top", `${Math.floor((viewportHeight - alignedHeight) / 2)}px`, "important");
}
