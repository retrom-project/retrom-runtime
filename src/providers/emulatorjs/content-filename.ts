import {ContentIOError} from "../../content-io/errors.js";

/** Resource URLs freeze the original basename; core loaders use it to identify archives. */
export function contentFileName(url: string) {
  const path = new URL(url, location.href).pathname;
  const name = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
  if (!name || name.length > 255 || name === "." || name === ".." || /[/\\]/u.test(name) ||
    Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new ContentIOError("SOURCE_INVALID");
  }
  return name;
}
