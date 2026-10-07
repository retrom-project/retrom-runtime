import type {RPGEngine} from "./types.js";
import {configurationFailure} from "./validation.js";

/** The LCF System chunk's database ID distinguishes 2000 and 2003 without filename guesses. */
export function detectLcfEngine(bytes: Uint8Array): RPGEngine {
  if (bytes.byteLength > 24 * 1024 * 1024) {configurationFailure("RUNTIME_RPG_EVIDENCE_INVALID");}
  const reader = new LcfReader(bytes);
  const length = reader.integer();
  if (new TextDecoder().decode(reader.take(length)) !== "LcfDataBase") {configurationFailure("RUNTIME_RPG_EVIDENCE_INVALID");}
  let databaseId: number | null = null;
  while (!reader.done) {
    const id = reader.integer();
    if (id === 0) {if (!reader.done) {configurationFailure("RUNTIME_RPG_EVIDENCE_INVALID");} break;}
    const chunk = reader.take(reader.integer());
    if (id !== 0x16) {continue;}
    if (databaseId !== null) {configurationFailure("RUNTIME_RPG_EVIDENCE_INVALID");}
    databaseId = systemId(chunk);
  }
  if (databaseId === 0) {return "RPG2000";}
  if (databaseId === 2003) {return "RPG2003";}
  configurationFailure("RUNTIME_RPG_EVIDENCE_INVALID");
}
function systemId(bytes: Uint8Array): number {
  const reader = new LcfReader(bytes);
  let databaseId = 0, found = false;
  while (!reader.done) {
    const id = reader.integer();
    if (id === 0 && reader.done) {return databaseId;}
    if (id === 0) {configurationFailure("RUNTIME_RPG_EVIDENCE_INVALID");}
    const chunk = reader.take(reader.integer());
    if (id !== 0x0a) {continue;}
    if (found) {configurationFailure("RUNTIME_RPG_EVIDENCE_INVALID");}
    found = true;
    const value = new LcfReader(chunk); databaseId = value.integer();
    if (!value.done) {configurationFailure("RUNTIME_RPG_EVIDENCE_INVALID");}
  }
  configurationFailure("RUNTIME_RPG_EVIDENCE_INVALID");
}
class LcfReader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get done() {return this.offset === this.bytes.byteLength;}
  integer() {
    let value = 0;
    for (let count = 0; count < 5; count++) {
      const next = this.take(1)[0]; value = value * 128 + (next & 127);
      if (value > 0xffffffff) {configurationFailure("RUNTIME_RPG_EVIDENCE_INVALID");}
      if (next < 128) {return value;}
    }
    configurationFailure("RUNTIME_RPG_EVIDENCE_INVALID");
  }
  take(length: number) {
    if (length > this.bytes.byteLength - this.offset) {configurationFailure("RUNTIME_RPG_EVIDENCE_INVALID");}
    const result = this.bytes.subarray(this.offset, this.offset + length); this.offset += length; return result;
  }
}
