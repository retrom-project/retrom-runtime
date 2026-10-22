import {describe, expect, it} from "vitest";
import {configureRuntime} from "./configure.js";
import {onsScriptEncoding, onsScriptSampleBytes} from "./ons-encoding.js";
import type {RuntimeContentFile} from "./types.js";

// Plain script bytes produced by Python's gbk and shift_jis codecs.
const chinese = hex("2a646566696e650a3bcbaec9abbababbafd7e95354414646c3fbb5a5a3a8c5c5c3fbb2bbb7d6cfc8baf3a3a90ac6f3bbaea3ba706e7467640acffbb3fdb6d4bbb0bff20ab1a3b4e6bdf8b6c80ab6c1c8a1bdf8b6c80a");
const japanese = hex("2a646566696e650a3b82b182f182c982bf82cd814190a28a4581428da193fa82cd82a282a293568b4382c582b782cb81420a835a815b837582b582dc82b782a981480a82cd82a20a82a282a282a60a");
const magic = [0x79, 0x57, 0x0d, 0x80, 0x04];

function hex(value: string) {return Uint8Array.from(value.match(/../gu)!, pair => Number.parseInt(pair, 16));}
function base64(bytes: Uint8Array) {return Buffer.from(bytes).toString("base64");}
function script(logicalKey: string, bytes: Uint8Array, sizeBytes = bytes.length) {
  const file: RuntimeContentFile = {logicalKey, name: logicalKey, sizeBytes, sha256: "a".repeat(64)};
  return {file, evidence: {[logicalKey]: {prefixBase64: base64(bytes)}}};
}
function detect(...scripts: ReturnType<typeof script>[]) {
  const files = scripts.map(item => item.file), evidence = Object.assign({}, ...scripts.map(item => item.evidence));
  return onsScriptEncoding(files, files.at(-1)!.logicalKey, evidence);
}

describe("ONS script encoding", () => {
  it("decodes each engine script format before detecting Chinese, Japanese and UTF-8 text", () => {
    expect(detect(script("game/0.txt", chinese))).toBe("gbk");
    expect(detect(script("game/nscript.dat", chinese.map(byte => byte ^ 0x84)))).toBe("gbk");
    expect(detect(script("game/nscr_sec.dat", chinese.map((byte, index) => byte ^ magic[index % 5]!)))).toBe("gbk");
    expect(detect(script("game/nscript.dat", japanese.map(byte => byte ^ 0x84)))).toBe("sjis");
    expect(detect(script("game/00.txt", new TextEncoder().encode("*define\n;水色汉化组 こんにちは\n")))).toBe("utf8");
    expect(detect(script("game/0.txt", new TextEncoder().encode("*define\nend\n")))).toBe("utf8");
  });

  it("follows the engine's script order instead of the configured entry name", () => {
    expect(detect(script("game/0.txt", japanese), script("game/nscript.dat", chinese.map(byte => byte ^ 0x84)))).toBe("sjis");
    expect(detect(script("other/0.txt", japanese), script("game/nscript.dat", chinese.map(byte => byte ^ 0x84)))).toBe("gbk");
  });

  it("ignores a multibyte character cut by the bounded sample", () => {
    const line = new TextEncoder().encode(";水色汉化组STAFF名单\n");
    const whole = new Uint8Array(onsScriptSampleBytes + line.length);
    for (let offset = 0; offset < whole.length; offset += line.length) {whole.set(line.subarray(0, whole.length - offset), offset);}
    let cut = onsScriptSampleBytes;
    while ((whole[cut]! & 0xc0) !== 0x80) {cut--;}
    // Shift the text so the 1 MiB boundary falls inside a three-byte UTF-8 character.
    const shifted = new Uint8Array(whole.length + onsScriptSampleBytes - cut).fill(0x3b);
    shifted.set(whole, onsScriptSampleBytes - cut);
    expect(shifted[onsScriptSampleBytes]! & 0xc0).toBe(0x80);
    expect(detect(script("game/0.txt", shifted.subarray(0, onsScriptSampleBytes), shifted.length))).toBe("utf8");
  });

  it("requires exact host evidence for the script the engine reads", () => {
    const {file} = script("game/0.txt", chinese);
    expect(() => onsScriptEncoding([file], file.logicalKey, undefined)).toThrow("RUNTIME_EVIDENCE_REQUIRED");
    expect(() => detect(script("game/0.txt", chinese, chinese.length + 1))).toThrow("RUNTIME_EVIDENCE_INVALID");
  });

  it("stores the detected encoding in the imported configuration", () => {
    const {file, evidence} = script("水色/0.txt", chinese);
    const font: RuntimeContentFile = {logicalKey: "水色/default.ttf", name: "default.ttf", sizeBytes: 4, sha256: "b".repeat(64)};
    const config = configureRuntime({platformId: "ons", coreIds: ["onscripter_yuri"], files: [file, font], evidence});
    expect(config.cores?.onscripter_yuri?.options).toEqual({scriptEncoding: "gbk"});
  });
});
