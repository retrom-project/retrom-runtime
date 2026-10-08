import {RuntimeConfigurationError} from "./types.js";

export function configurationFailure(code = "RUNTIME_CONFIGURATION_INVALID", details: Readonly<Record<string, string>> = {}): never {
  throw new RuntimeConfigurationError(code, details);
}
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
export function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u.test(value) && value.length <= 64;
}
export function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
export function logicalPath(value: unknown, empty = false): value is string {
  return typeof value === "string" && (empty && value === "" || value.length > 0 && value.length <= 4096 &&
    !value.includes("\\") && [...value].every(printableCharacter) && value.split("/").every(segment => segment !== "" && segment !== "." && segment !== ".."));
}
function printableCharacter(character: string): boolean {
  const point = character.codePointAt(0)!;
  return point >= 32 && point !== 127 && (point < 0xd800 || point > 0xdfff);
}
export function utf8Compare(left: string, right: string): number {
  const a = new TextEncoder().encode(left), b = new TextEncoder().encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {if (a[index] !== b[index]) {return a[index] - b[index];}}
  return a.length - b.length;
}
