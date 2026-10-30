// A bounded static vocabulary for scheduled register operations. This is not
// an x86 interpreter: unsupported instructions stop the def/use relationship.
export function registerMove(bytes, at) {
  const opcode = bytes[at], m = bytes[at + 1];
  if (![0x8b, 0x89].includes(opcode) || m >> 6 !== 3) {return null;}
  return opcode === 0x8b ? {to: m >> 3 & 7, from: m & 7} : {to: m & 7, from: m >> 3 & 7};
}
export function shiftIs(bytes, at, reg, amount) {return bytes[at] === 0xc1 && bytes[at + 1] === (0xe8 | reg) && bytes[at + 2] === amount;}
export function xor32Is(bytes, at, to, from) {
  return bytes[at] === 0x33 && bytes[at + 1] === (0xc0 | to << 3 | from) ||
    bytes[at] === 0x31 && bytes[at + 1] === (0xc0 | from << 3 | to);
}
function modrm(bytes, at, end) {
  if (at >= end) {return null;}
  const m = bytes[at], mode = m >> 6, rm = m & 7;
  let size = 1;
  if (mode !== 3) {
    if (rm === 4) {
      if (at + size >= end) {return null;}
      if (mode === 0 && (bytes[at + size] & 7) === 5) {size += 4;}
      size++;
    } else if (mode === 0 && rm === 5) {size += 4;}
    if (mode === 1) {size++;}
    if (mode === 2) {size += 4;}
  }
  return at + size <= end ? {size, mode, rm, reg: m >> 3 & 7} : null;
}

// PE32 instructions used by these relationships, including complete operand
// lengths. Unknown opcodes/prefixes stop a path; operand bytes are never scanned
// as instructions. Register writes conservatively include byte/stack changes.
function step(bytes, start, end) {
  if (start < 0 || start >= end) {return null;}
  let at = start;
  if ([0x26, 0x2e, 0x36, 0x3e, 0x64, 0x65].includes(bytes[at])) {at++;}
  const op = bytes[at];
  let size = 1, writes = [], flow, target;
  if (op >= 0x50 && op <= 0x57) {writes = [4];}
  else if (op >= 0x58 && op <= 0x5f) {writes = [4, op & 7];}
  else if (op >= 0x40 && op <= 0x4f) {writes = [op & 7];}
  else if (op >= 0xb8 && op <= 0xbf) {size = 5; writes = [op & 7];}
  else if (op >= 0xb0 && op <= 0xb7) {size = 2; writes = [op & 3];}
  else if (op === 0x90) { /* NOP */ }
  else if (op === 0x68 || op === 0x6a) {size = op === 0x68 ? 5 : 2; writes = [4];}
  else if (op >= 0xa0 && op <= 0xa3) {size = 5; if (op <= 0xa1) {writes = [0];}}
  else if ([0x05, 0x25].includes(op)) {size = 5; writes = [0];}
  else if (op === 0xc3 || op === 0xc2) {size = op === 0xc3 ? 1 : 3; flow = "return";}
  else if ([0xe8, 0xe9, 0xeb].includes(op) || op >= 0x70 && op <= 0x7f ||
      op === 0x0f && bytes[at + 1] >= 0x80 && bytes[at + 1] <= 0x8f) {
    size = op === 0x0f ? 6 : op === 0xe8 || op === 0xe9 ? 5 : 2;
    if (at + size > end) {return null;}
    target = at + size + (size === 2 ? bytes.readInt8(at + 1) : bytes.readInt32LE(at + size - 4));
    flow = op === 0xe8 ? "call" : op === 0xe9 || op === 0xeb ? "jump" : "branch";
  } else {
    const m = modrm(bytes, at + 1, end);
    if (!m) {return null;}
    size += m.size;
    if ([0x8b, 0x03, 0x2b, 0x33, 0x8d].includes(op)) {
      if (op === 0x8d && m.mode === 3) {return null;}
      writes = [m.reg];
    } else if ([0x89, 0x01, 0x29, 0x31].includes(op)) {if (m.mode === 3) {writes = [m.rm];}}
    else if ([0x8a, 0x32].includes(op)) {writes = [m.reg & 3];}
    else if ([0x88, 0x30].includes(op)) {if (m.mode === 3) {writes = [m.rm & 3];}}
    else if ([0x39, 0x3b, 0x84, 0x85].includes(op)) { /* comparison only */ }
    else if ([0x81, 0x83, 0xc1].includes(op)) {
      size += op === 0x81 ? 4 : 1;
      if (m.mode === 3 && (op === 0xc1 || m.reg !== 7)) {writes = [m.rm];}
    } else if (op === 0xc7 && m.reg === 0) {size += 4; if (m.mode === 3) {writes = [m.rm];}}
    else {return null;}
  }
  size += at - start;
  return start + size <= end ? {at: start, size, writes, flow, target} : null;
}

export function registerPreserved(bytes, start, end, reg) {
  if (end < start || end - start >= 16) {return false;}
  for (let at = start; at < end;) {
    const instruction = step(bytes, at, end);
    if (!instruction || instruction.flow || instruction.writes.includes(reg)) {return false;}
    at += instruction.size;
  }
  return true;
}

// Only possible local control-flow edges are followed, with a fixed byte budget.
// Overlapping decodings are ambiguous and cannot establish a relationship.
export function reachableInstructions(bytes, start, end) {
  const limit = Math.min(end, bytes.length, start + 256), pending = [start], decoded = new Map(), occupied = new Set();
  while (pending.length) {
    let at = pending.pop();
    while (at >= start && at < limit && !decoded.has(at)) {
      if (occupied.has(at)) {return [];}
      const instruction = step(bytes, at, limit);
      if (!instruction) {break;}
      for (let p = at; p < at + instruction.size; p++) {
        if (occupied.has(p)) {return [];}
        occupied.add(p);
      }
      decoded.set(at, instruction);
      if (instruction.flow === "return") {break;}
      if (instruction.flow === "branch") {pending.push(instruction.target);}
      at = instruction.flow === "jump" ? instruction.target : at + instruction.size;
    }
  }
  return [...decoded.values()];
}

export function scheduledOperation(bytes, start, end, matches, preserved) {
  const limit = Math.min(end, start + 16);
  for (let at = start; at < limit;) {
    const instruction = step(bytes, at, limit);
    if (!instruction) {return null;}
    if (matches(at)) {return at;}
    if (instruction.flow || instruction.writes.some(reg => preserved.includes(reg))) {return null;}
    at += instruction.size;
  }
  return null;
}
