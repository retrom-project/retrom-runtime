// Synthetic PE/version-resource data, built from the public Windows layout.
export function kirikiriPe(product = "TVP(KIRIKIRI) Z core / Scripting Platform for Win32", pe64 = false) {
  const utf16 = (text: string) => Uint8Array.from(Array.from(text + "\0").flatMap(c => [c.charCodeAt(0) & 255, c.charCodeAt(0) >>> 8]));
  const align = (value: number) => Math.ceil(value / 4) * 4;
  function block(key: string, value: Uint8Array, children: Uint8Array[], text = false) {
    const name = utf16(key), start = align(6 + name.length), child = align(start + value.length);
    const bytes = new Uint8Array(child + children.reduce((n, item) => n + align(item.length), 0));
    const view = new DataView(bytes.buffer);
    view.setUint16(0, bytes.length, true); view.setUint16(2, text ? value.length / 2 : value.length, true);
    view.setUint16(4, text ? 1 : 0, true); bytes.set(name, 6); bytes.set(value, start);
    let at = child; for (const item of children) {bytes.set(item, at); at += align(item.length);}
    return bytes;
  }
  const fixed = new Uint8Array(52); new DataView(fixed.buffer).setUint32(0, 0xfeef04bd, true);
  const version = block("VS_VERSION_INFO", fixed, [block("StringFileInfo", new Uint8Array(), [
    block("040904b0", new Uint8Array(), [block("ProductName", utf16(product), [], true)]),
  ])]);
  const bytes = new Uint8Array(0x200 + 0x100 + version.length), view = new DataView(bytes.buffer);
  bytes.set([0x4d, 0x5a]); view.setUint32(60, 0x80, true); view.setUint32(0x80, 0x4550, true);
  view.setUint16(0x86, 1, true); const optional = pe64 ? 240 : 224;
  view.setUint16(0x94, optional, true); view.setUint16(0x98, pe64 ? 0x20b : 0x10b, true);
  const directories = 0x98 + (pe64 ? 112 : 96);
  view.setUint32(directories - 4, 16, true); view.setUint32(directories + 16, 0x1000, true);
  view.setUint32(directories + 20, bytes.length - 0x200, true);
  const section = 0x98 + optional;
  view.setUint32(section + 12, 0x1000, true); view.setUint32(section + 16, bytes.length - 0x200, true);
  view.setUint32(section + 20, 0x200, true);
  for (const [offset, id, next] of [[0, 16, 0x80000020], [0x20, 1, 0x80000040], [0x40, 1033, 0x60]]) {
    view.setUint16(0x200 + offset! + 14, 1, true);
    view.setUint32(0x200 + offset! + 16, id!, true); view.setUint32(0x200 + offset! + 20, next!, true);
  }
  view.setUint32(0x260, 0x1100, true); view.setUint32(0x264, version.length, true); bytes.set(version, 0x300);
  return bytes;
}
