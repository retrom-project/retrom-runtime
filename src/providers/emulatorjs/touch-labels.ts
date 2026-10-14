// EJS creates and replaces these controls after the frame is mounted.
export function installEmulatorJsTouchLabels(frameDocument: Document) {
  const Observer = frameDocument.defaultView?.MutationObserver;
  if (!Observer) {return () => {};}
  const labels = new Set<HTMLSpanElement>();
  const layout = trackLabelLayout(frameDocument);
  const update = () => {
    for (const button of frameDocument.querySelectorAll(".ejs_virtualGamepad_button")) {
      if (button.children.length || !button.textContent?.trim()) {continue;}
      const label = frameDocument.createElement("span");
      label.className = "retrom-touch-label";
      label.append(...button.childNodes);
      button.append(label);
      labels.add(label);
      layout.observe(label, button);
    }
    layout.align();
  };
  const observer = new Observer(update);
  observer.observe(frameDocument.documentElement, {childList: true, subtree: true});
  update();
  return () => {
    observer.disconnect();
    layout.dispose();
    for (const label of labels) {label.replaceWith(...label.childNodes);}
    labels.clear();
  };
}

function trackLabelLayout(document: Document) {
  const view = document.defaultView!;
  const labels = new Map<HTMLSpanElement, {button: Element; shift: number}>();
  let context: CanvasRenderingContext2D | null | undefined;
  let disposed = false;
  const align = () => {
    if (disposed) {return;}
    const changes: {label: HTMLSpanElement; shift: number}[] = [];
    for (const [label, state] of labels) {
      if (label.parentElement !== state.button) {continue;}
      const button = state.button.getBoundingClientRect();
      if (!button.width || !button.height) {continue;}
      if (context === undefined) {context = document.createElement("canvas").getContext("2d");}
      if (!context) {return;}
      context.font = view.getComputedStyle(label).font;
      const ink = context.measureText(label.textContent ?? "");
      const range = document.createRange();
      range.selectNodeContents(label);
      // Font fallback and glyph descenders can differ from CSS capital-height trimming.
      const center = range.getBoundingClientRect().top + ink.fontBoundingBoxAscent +
        (ink.actualBoundingBoxDescent - ink.actualBoundingBoxAscent) / 2;
      const shift = state.shift + button.top + button.height / 2 - center;
      if (Number.isFinite(shift) && Math.abs(shift - state.shift) > 0.001) {changes.push({label, shift});}
    }
    for (const {label, shift} of changes) {
      labels.get(label)!.shift = shift;
      label.style.setProperty("--retrom-touch-label-shift", `${shift}px`);
    }
  };
  const resize = view.ResizeObserver ? new view.ResizeObserver(align) : null;
  view.addEventListener("resize", align);
  document.fonts?.addEventListener("loadingdone", align);
  void document.fonts?.ready?.then(align);
  return {
    align,
    observe(label: HTMLSpanElement, button: Element) {
      labels.set(label, {button, shift: 0});
      resize?.observe(button);
      resize?.observe(label);
    },
    dispose() {
      if (disposed) {return;}
      disposed = true;
      resize?.disconnect();
      view.removeEventListener("resize", align);
      document.fonts?.removeEventListener("loadingdone", align);
      labels.clear();
    },
  };
}
