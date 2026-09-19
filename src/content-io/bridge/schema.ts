import schema from "../../../contracts/content-io/v1/protocol.schema.json" with {type: "json"};
import {integer, record} from "../source.js";
type Shape = {type?: string; const?: unknown; enum?: unknown[]; oneOf?: Shape[]; anyOf?: Shape[]; $ref?: string;
  minimum?: number; maximum?: number; multipleOf?: number; minLength?: number; maxLength?: number; pattern?: string; format?: string;
  required?: string[]; properties?: Record<string, Shape | undefined>; additionalProperties?: boolean; items?: Shape; minItems?: number; maxItems?: number; uniqueItems?: boolean;
  "x-hostObject"?: string};
const definitions: Record<string, Shape> = schema.$defs;
const messages = new Map((schema.oneOf as Shape[]).map((shape) => [shape.properties?.type?.const, shape]));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export function hostObject(value: unknown, type: string): boolean {
  if (!value || typeof value !== "object") {return false;}
  if (type === "MessagePort" && typeof MessagePort !== "undefined" && value instanceof MessagePort) {return true;}
  const tag = Object.prototype.toString.call(value);
  if (tag !== `[object ${type}]` && !(type === "Blob" && tag === "[object File]")) {return false;}
  if (type === "ArrayBuffer" || type === "SharedArrayBuffer") {return integer((value as ArrayBuffer).byteLength);}
  if (type === "Blob") {return integer((value as Blob).size) && typeof (value as Blob).slice === "function";}
  return type === "MessagePort" && typeof (value as MessagePort).postMessage === "function" && typeof (value as MessagePort).start === "function";
}
function stringMatches(value: string, shape: Shape): boolean {
  if (value.length < (shape.minLength ?? 0) || value.length > (shape.maxLength ?? 65536) || shape.pattern && !new RegExp(shape.pattern, "u").test(value)) {return false;}
  if (shape.format === "uuid") {return uuid.test(value);}
  if (shape.format === "uri") {try {new URL(value); return true;} catch {return false;}}
  return true;
}
function objectMatches(value: unknown, shape: Shape, depth: number): boolean {
  if (!record(value)) {return false;}
  const keys = Object.keys(value), properties = shape.properties ?? {};
  if (keys.length > Math.max(32, Object.keys(properties).length) || (shape.required ?? []).some((key) => !Object.hasOwn(value, key))) {return false;}
  return keys.every((key) => properties[key] ? matches(value[key], properties[key], depth + 1) : shape.additionalProperties !== false);
}
function arrayMatches(value: unknown, shape: Shape, depth: number): boolean {
  return Array.isArray(value) && value.length >= (shape.minItems ?? 0) && value.length <= (shape.maxItems ?? 128) &&
    (!shape.uniqueItems || new Set(value).size === value.length) && value.every((entry) => matches(entry, shape.items!, depth + 1));
}
function primitive(value: unknown, shape: Shape): boolean {
  switch (shape.type) {
    case "null": return value === null;
    case "string": return typeof value === "string" && stringMatches(value, shape);
    case "number": return typeof value === "number" && Number.isFinite(value) && value >= (shape.minimum ?? 0) && value <= (shape.maximum ?? Number.MAX_VALUE);
    case "integer": return integer(value, shape.minimum ?? 0, shape.maximum ?? Number.MAX_SAFE_INTEGER) && (!shape.multipleOf || value % shape.multipleOf === 0);
    default: return false;
  }
}
function matches(value: unknown, shape: Shape, depth = 0): boolean {
  if (depth > 8) {return false;}
  if (shape.$ref) {return matches(value, definitions[shape.$ref.slice("#/$defs/".length)], depth + 1);}
  if (shape.anyOf) {return shape.anyOf.some((alternative) => matches(value, alternative, depth + 1));}
  if (shape.oneOf) {return shape.oneOf.filter((alternative) => matches(value, alternative, depth + 1)).length === 1;}
  if (Object.hasOwn(shape, "const")) {return value === shape.const;}
  if (shape.enum) {return shape.enum.includes(value);}
  if (shape["x-hostObject"]) {return hostObject(value, shape["x-hostObject"]);}
  if (shape.type === "object") {return objectMatches(value, shape, depth);}
  if (shape.type === "array") {return arrayMatches(value, shape, depth);}
  return primitive(value, shape);
}
export function matchesMessage(value: unknown): boolean {
  try {
    if (!record(value)) {return false;}
    const shape = messages.get(value.type);
    if (!shape || !matches(value, shape)) {return false;}
    const json = JSON.stringify(value, (_key, entry: unknown) => {
      if (entry && typeof entry === "object" && ["ArrayBuffer", "SharedArrayBuffer", "Blob", "MessagePort"].some((kind) => hostObject(entry, kind))) {return null;}
      return entry;
    });
    return new TextEncoder().encode(json).byteLength <= 65536;
  } catch {return false;}
}
