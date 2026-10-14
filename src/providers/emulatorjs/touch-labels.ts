// EJS creates and replaces these controls after the frame is mounted.
export function installEmulatorJsTouchLabels(frameDocument: Document) {
  const Observer = frameDocument.defaultView?.MutationObserver;
  if (!Observer) {return () => {};}
  const labels = new Set<HTMLSpanElement>();
  const update = () => {
    for (const button of frameDocument.querySelectorAll(".ejs_virtualGamepad_button")) {
      if (button.children.length || !button.textContent?.trim()) {continue;}
      const label = frameDocument.createElement("span");
      label.className = "retrom-touch-label";
      label.append(...button.childNodes);
      button.append(label);
      labels.add(label);
    }
  };
  const observer = new Observer(update);
  observer.observe(frameDocument.documentElement, {childList: true, subtree: true});
  update();
  return () => {
    observer.disconnect();
    for (const label of labels) {label.replaceWith(...label.childNodes);}
    labels.clear();
  };
}
