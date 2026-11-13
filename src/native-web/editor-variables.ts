import type {RuntimeGameEditEntryV1} from "../provider/module-api.js";

type Variables = {value(id: number): unknown; setValue(id: number, value: unknown): void};
type Path = {root: number; keys: string[]; category: string; label: string};
const maximumDepth = 16;
const maximumPaths = 16_384;

/** Paths retain property names so a reordered object cannot redirect an edit. */
export function createRpgVariableEditor(owner: () => Variables, validId: (id: number) => boolean) {
  const paths = new Map<string, Path>();
  const identities = new Map<string, string>();

  function identify(path: Path) {
    const key = JSON.stringify([path.root, path.keys]);
    const previous = identities.get(key);
    if (previous) {return previous;}
    if (paths.size >= maximumPaths) {throw invalid();}
    const id = `${path.root}:${paths.size + 1}`;
    paths.set(id, path); identities.set(key, id);
    return id;
  }

  function describe(id: string, label: string, value: unknown, depth: number): RuntimeGameEditEntryV1 {
    const base = {id, label: label.slice(0, 160)};
    if (numeric(value)) {
      return {...base, value, valueType: "number", min: -Number.MAX_SAFE_INTEGER,
        max: Number.MAX_SAFE_INTEGER, step: "any"};
    }
    if (typeof value === "boolean") {return {...base, value, valueType: "boolean"};}
    if (typeof value === "string" && value.length <= 500) {return {...base, value, valueType: "text"};}
    if (value === null) {return {...base, value: null, valueType: "null"};}
    if (collection(value) && depth < maximumDepth) {
      const count = Object.keys(value).length;
      return {...base, value: `${Array.isArray(value) ? "数组" : "对象"} · ${count} 项`,
        valueType: "collection", children: `variables:${id}`};
    }
    return {...base, value: null, valueType: "unsupported"};
  }

  function rootPath(id: string): Path {
    if (!/^[1-9]\d*$/u.test(id) || !validId(Number(id))) {throw invalid();}
    return {root: Number(id), keys: [], category: "variables", label: id};
  }

  function pathFor(id: string) {return paths.get(id) ?? rootPath(id);}

  function scope(category: string) {
    if (!category.startsWith("variables:")) {throw invalid();}
    const path = pathFor(category.slice("variables:".length));
    if (path.keys.length >= maximumDepth) {throw invalid();}
    const value = readPath(owner().value(path.root), path.keys);
    if (!collection(value)) {throw invalid();}
    return {path, value};
  }

  function child(category: string, parent: Path, value: object, key: string) {
    const label = Array.isArray(value) ? `[${key}]` : key || '""';
    const path = {root: parent.root, keys: [...parent.keys, key], category, label};
    const id = identify(path);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      return {id, label: label.slice(0, 160), value: null, valueType: "unsupported" as const};
    }
    const entry = describe(id, label, descriptor.value, path.keys.length);
    if (descriptor.writable === false && entry.valueType !== "collection" && entry.valueType !== "null") {
      return {id, label: entry.label, value: null, valueType: "unsupported" as const};
    }
    return entry;
  }

  return {
    entry(id: number, label: string) {return describe(String(id), label, owner().value(id), 0);},
    entries(category: string, query: string, offset: number, limit: number) {
      const {path, value} = scope(category);
      const filter = query.trim().toLowerCase();
      const keys = Object.keys(value).filter(key => !filter || key.toLowerCase().includes(filter));
      const rows = keys.slice(offset, offset + limit).map(key => child(category, path, value, key));
      const page = pageEditorEntries(rows, 0, limit);
      const next = offset + page.entries.length;
      return {entries: page.entries, nextOffset: next < keys.length ? next : null};
    },
    set(category: string, id: string, value: unknown) {
      const path = pathFor(id);
      if (path.category !== category) {throw invalid();}
      const root = owner().value(path.root);
      const current = readPath(root, path.keys);
      if (!validWrite(current, value)) {throw invalid();}
      const replacement = replacePath(root, path.keys, value);
      owner().setValue(path.root, replacement);
      return describe(id, path.label, readPath(owner().value(path.root), path.keys), path.keys.length);
    },
  };
}

export function pageEditorEntries(rows: RuntimeGameEditEntryV1[], offset: number, limit: number) {
  const entries: RuntimeGameEditEntryV1[] = [];
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const row of rows.slice(offset, offset + limit)) {
    const size = encoder.encode(JSON.stringify(row)).byteLength + 1;
    if (bytes + size > 48 * 1024) {break;}
    bytes += size; entries.push(row);
  }
  const next = offset + entries.length;
  return {entries, nextOffset: next < rows.length ? next : null};
}

function collection(value: unknown): value is object {
  if (!value || typeof value !== "object") {return false;}
  if (Array.isArray(value)) {return true;}
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function readPath(root: unknown, keys: string[]): unknown {
  let value = root;
  for (const key of keys) {
    if (!collection(value)) {throw invalid();}
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {throw invalid();}
    value = descriptor.value;
  }
  return value;
}

/** Copy edited ancestors; preserve sparse slots, sibling references and engine instances. */
function replacePath(root: unknown, keys: string[], value: unknown): unknown {
  if (!keys.length) {return value;}
  if (!collection(root)) {throw invalid();}
  const [key, ...tail] = keys;
  const descriptor = Object.getOwnPropertyDescriptor(root, key);
  if (!descriptor || !("value" in descriptor) || descriptor.writable === false) {throw invalid();}
  const descriptors = Object.getOwnPropertyDescriptors(root);
  descriptors[key] = {...descriptor, value: replacePath(descriptor.value, tail, value)};
  return Array.isArray(root) ? Object.defineProperties([], descriptors)
    : Object.create(Object.getPrototypeOf(root), descriptors) as object;
}

function numeric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
}

function validWrite(current: unknown, value: unknown) {
  return numeric(current) && numeric(value) || typeof current === "boolean" && typeof value === "boolean" ||
    typeof current === "string" && typeof value === "string" && value.length <= 500;
}

function invalid() {return new Error("RPG_GAME_EDITOR_INVALID");}
