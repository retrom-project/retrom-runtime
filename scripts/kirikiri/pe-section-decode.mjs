// Recognize one bounded PE32 section-loader vocabulary. All constants and the
// dispatch order come from connected instructions; no native code is executed.
const matches = (bytes, at, pattern, end) => at >= 0 && at + pattern.length <= end &&
  pattern.every((value, i) => value === null || bytes[at + i] === value);
const relative = (bytes, at, size) => at + size + (size === 2 ? bytes.readInt8(at + 1) : bytes.readInt32LE(at + size - 4));

function sectionLoader(bytes, pe, at, end) {
  const prefix = [0x33, 0xc0, 0xb3, null, 0xb2, null, 0x80, 0x3c, 8, null, 0x75, 25,
    0x80, 0x7c, 8, 1, null, 0x75, 18, 0x38, 0x5c, 8, 2, 0x75, 12,
    0x38, 0x54, 8, 3, 0x75, 6, 0x38, 0x54, 8, 4, 0x74, 8, 0x40,
    0x3d, null, null, null, null, 0x72, 0xd9, 0x3d, null, null, null, null, 0x0f, 0x84,
    null, null, null, null, 0x8b, 0x74, 8, 12, 0x8b, 0x54, 8, 8, 3, 0xf1,
    0xbd, null, null, null, null, 0x2b, 0xee, 0x0f, 0x88, null, null, null, null,
    0x3b, 0xea, 0x0f, 0x8f, null, null, null, null, 0x33, 0xc0, 0x57, 0x85, 0xd2,
    0xbf, null, null, null, null, 0x0f, 0x86, null, null, null, null];
  if (!matches(bytes, at, prefix, end)) {return null;}
  const limit = bytes.readUInt32LE(at + 39), name = Buffer.from([bytes[at + 9], bytes[at + 16], bytes[at + 3], bytes[at + 5], bytes[at + 5], 0, 0, 0]);
  if (!limit || limit > 4096 || limit !== bytes.readUInt32LE(at + 46)) {return null;}
  const sections = pe.sections.filter(s => s.header < limit && bytes.subarray(s.header, s.header + 8).equals(name));
  if (sections.length !== 1 || bytes.indexOf(name.subarray(0, 5)) !== sections[0].header) {return null;}
  const section = sections[0], anchor = pe.fromVa(bytes.readUInt32LE(at + 67));
  if (!section.executable || !section.virtualSize || section.virtualSize > section.size ||
      anchor === null || anchor < section.raw || anchor >= section.raw + section.virtualSize ||
      at >= section.raw && at < section.end) {return null;}
  // Both the virtual-size guard and the anchor guard must leave this loop.
  const finish = relative(bytes, at + 97, 6);
  for (const guard of [50, 73, 81]) {
    const target = relative(bytes, at + guard, 6);
    if (target < finish || target >= end) {return null;}
  }
  return {section, seed: bytes.readUInt32LE(at + 93), loop: at + 103, finish};
}

// Reduce the compiler's LEA/SHL/SUB chain to an affine coefficient, rather than
// interpreting instructions or evaluating a machine state.
function recurrence(bytes, at, end) {
  if (!matches(bytes, at, [0x8d, 0x0c, null], end) || (bytes[at + 2] & 63) !== 63) {return null;}
  let multiplier = 1 + 2 ** (bytes[at + 2] >>> 6), p = at + 3, operations = 0;
  for (; operations < 16; operations++) {
    if (matches(bytes, p, [0xc1, 0xe1, null], end) && bytes[p + 2] < 32) {
      multiplier = Math.imul(multiplier, 2 ** bytes[p + 2]) >>> 0; p += 3;
    } else if (matches(bytes, p, [0xd1, 0xe1], end)) {multiplier = Math.imul(multiplier, 2) >>> 0; p += 2;}
    else if (matches(bytes, p, [0x2b, 0xcf], end)) {multiplier = (multiplier - 1) >>> 0; p += 2;}
    else if (matches(bytes, p, [0x8d, 0x0c, null], end) && (bytes[p + 2] & 63) === 9) {
      multiplier = Math.imul(multiplier, 1 + 2 ** (bytes[p + 2] >>> 6)) >>> 0; p += 3;
    } else {break;}
  }
  if (!multiplier || !matches(bytes, p, [0x81, 0xc1, null, null, null, null, 0xc1, 0xef, null,
    0x33, 0xf9, 0x8b, 0xcf, 0x83, 0xe1, 3, 0x83, 0xf9, 3, 0x77, null, 0xff, 0x24, 0x8d,
    null, null, null, null], end) || bytes[p + 8] < 1 || bytes[p + 8] > 31) {return null;}
  return {multiplier, increment: bytes.readUInt32LE(p + 2), shift: bytes[p + 8],
    tableVa: bytes.readUInt32LE(p + 24), default: relative(bytes, p + 19, 2), dispatch: p + 21};
}

function byteShift(bytes, at, operand, end) {
  if (matches(bytes, at, [0xd0, operand], end)) {return {bits: 1, end: at + 2};}
  if (matches(bytes, at, [0xc0, operand, null], end) && bytes[at + 2] > 0 && bytes[at + 2] < 8) {
    return {bits: bytes[at + 2], end: at + 3};
  }
  return null;
}

function bytePermutation(bytes, at, end) {
  if (!matches(bytes, at, [0x8a, 0x0c, 0x30, 0x8a, 0xd9, 0x80], end)) {return null;}
  let p = at + 8, table;
  if (bytes[at + 6] === 0xe1) {
    const right = byteShift(bytes, p, 0xeb, end);
    if (!right || !matches(bytes, right.end, [0x80, 0xe3, null], end)) {return null;}
    const left = byteShift(bytes, right.end + 3, 0xe1, end);
    if (!left) {return null;}
    const low = bytes[at + 7], high = bytes[right.end + 2];
    table = Uint8Array.from({length: 256}, (_, v) => ((v & low) << left.bits) + ((v >>> right.bits) & high));
    p = left.end;
  } else if (bytes[at + 6] === 0xe3) {
    const left = byteShift(bytes, p, 0xe3, end), right = left && byteShift(bytes, left.end, 0xe9, end);
    if (!right) {return null;}
    const low = bytes[at + 7];
    table = Uint8Array.from({length: 256}, (_, v) => ((v & low) << left.bits) + (v >>> right.bits));
    p = right.end;
  } else {return null;}
  if (new Set(table).size !== 256) {return null;}
  const shared = matches(bytes, p, [0xeb, null], end) ? relative(bytes, p, 2) : p;
  return {table, shared};
}

function decoder(bytes, pe, at, end) {
  const loader = sectionLoader(bytes, pe, at, end);
  if (!loader) {return null;}
  const state = recurrence(bytes, loader.loop, end), table = state && pe.fromVa(state.tableVa, 16);
  if (table === null || !state || table < loader.section.end && table + 16 > loader.section.raw) {return null;}
  const targets = Array.from({length: 4}, (_, i) => pe.fromVa(bytes.readUInt32LE(table + i * 4), 1, true));
  if (new Set(targets).size !== 4 || targets.some(p => p === null || p < state.dispatch + 7 || p >= Math.min(end, at + 512))) {return null;}
  const cases = targets.map(p => bytePermutation(bytes, p, end));
  if (cases.some(p => !p) || new Set(cases.map(p => p.shared)).size !== 1) {return null;}
  const shared = cases[0].shared;
  if (!matches(bytes, shared, [2, 0xd9, 0x88, 0x1c, 0x30, 0x3b, 0xc5, 0x75, 7,
    0x8a, 0x0c, 0x30, 0x88, 0x4c, 0x24, null, 0x40, 0x3b, 0xc2, 0x0f, 0x82,
    null, null, null, null], end) || relative(bytes, shared + 19, 6) !== loader.loop ||
      loader.finish !== shared + 25 || state.default !== shared + 5) {return null;}
  return {...loader, ...state, cases, at};
}

export function decodePeSections(bytes, pe) {
  const candidates = [];
  for (const section of pe.sections.filter(s => s.executable)) {
    for (let at = section.raw; at + 103 < section.end; at++) {
      if (bytes[at] !== 0x33 || bytes[at + 1] !== 0xc0 || bytes[at + 2] !== 0xb3) {continue;}
      const value = decoder(bytes, pe, at, section.end);
      if (value) {candidates.push(value);}
      if (candidates.length > 1) {return null;}
    }
  }
  if (candidates.length !== 1) {return null;}
  const value = candidates[0], output = Buffer.from(bytes);
  let state = value.seed;
  for (let i = 0; i < value.section.virtualSize; i++) {
    state = ((Math.imul(state, value.multiplier) + value.increment) ^ (state >>> value.shift)) >>> 0;
    output[value.section.raw + i] = value.cases[state & 3].table[bytes[value.section.raw + i]];
  }
  return {bytes: output, evidence: {loaderVa: pe.toVa(value.at), sectionRva: value.section.rva,
    decodedBytes: value.section.virtualSize, seed: value.seed, multiplier: value.multiplier,
    increment: value.increment, stateShift: value.shift, dispatchVa: pe.toVa(value.dispatch)}};
}
