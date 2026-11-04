const maximumBytes = 32 * 1024 * 1024;
const signature = Buffer.from("TVP pre-rendered font\x1a", "ascii");

/** Validate the complete supported TFT representation, including every glyph.
 * This format has no checksum; structural validity does not authenticate source
 * integrity. Versions 0/1 use packed 20-byte items and 65-level alpha RLE. */
export function validPrerenderedFont(input) {
  if (!(input instanceof Uint8Array) || input.length < 36 || input.length > maximumBytes) {return false;}
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (!bytes.subarray(0, 22).equals(signature) || bytes[23] !== 2 || bytes[22] > 1) {return false;}
  const version = bytes[22], count = bytes.readUInt32LE(24), chars = bytes.readUInt32LE(28), index = bytes.readUInt32LE(32);
  const characterEnd = chars + count * 2;
  if (!count || count > 65536 || chars < 36 || index < characterEnd || index - characterEnd > 4 ||
      index + count * 20 !== bytes.length || !bytes.subarray(characterEnd, index).every(value => value === 0)) {return false;}
  const glyphs = new Map(); let previous = -1;
  for (let i = 0; i < count; i++) {
    const character = bytes.readUInt16LE(chars + i * 2), item = index + i * 20;
    if (character <= previous) {return false;}
    previous = character;
    const offset = bytes.readUInt32LE(item), pixels = bytes.readUInt16LE(item + 4) * bytes.readUInt16LE(item + 6);
    // Metrics and the reserved word are not interpreted by the bitmap codec.
    if (!pixels) {
      if (offset !== 0 && (offset < 36 || offset > chars)) {return false;}
      continue;
    }
    if (pixels > maximumBytes || offset < 36 || offset >= chars || glyphs.has(offset) && glyphs.get(offset) !== pixels) {return false;}
    glyphs.set(offset, pixels);
  }
  const offsets = [...glyphs.keys()].sort((a, b) => a - b);
  if (offsets.length ? offsets[0] !== 36 : chars !== 36) {return false;}
  // Each distinct encoded span is visited once, even when glyphs share a bitmap.
  for (let i = 0; i < offsets.length; i++) {
    let at = offsets[i], expanded = 0;
    const end = offsets[i + 1] ?? chars, pixels = glyphs.get(at);
    while (expanded < pixels) {
      if (at >= end) {return false;}
      const value = bytes[at++];
      if (version === 0 && value === 0x41) {
        if (!expanded || at >= end) {return false;}
        expanded += bytes[at++];
      } else if (version === 1 && value >= 0x41) {
        if (!expanded) {return false;}
        expanded += value - 0x40;
      } else {
        if (value > 0x40) {return false;}
        expanded++;
      }
      if (expanded > pixels) {return false;}
    }
    if (end - at > 4 || !bytes.subarray(at, end).every(value => value === 0)) {return false;}
  }
  return true;
}
