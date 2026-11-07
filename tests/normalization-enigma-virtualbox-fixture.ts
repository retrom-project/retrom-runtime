// Synthetic PE32 + package builder for the Enigma Virtual Box layout-3 adapter.
// Contains no real loader code: only the connected instruction shapes the
// adapter requires as evidence and independently encoded package records.
const u16 = (n: number) => {const b = Buffer.alloc(2); b.writeUInt16LE(n); return b;};
const u32 = (n: number) => {const b = Buffer.alloc(4); b.writeUInt32LE(n); return b;};
const u64 = (n: number) => {const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b;};
const wide = (s: string) => Buffer.from(s + "\0", "utf16le");

export type VirtualFile = {path: string; data: Buffer; flags?: number; target?: string};
type Node = {name: string; kind: number; children: Node[]; file?: VirtualFile};

function tree(files: VirtualFile[], root = "%DEFAULT FOLDER%") {
  const top: Node = {name: root, kind: 3, children: []};
  for (const file of files) {
    let parent = top; const parts = file.path.split("/");
    for (const part of parts.slice(0, -1)) {
      let next = parent.children.find(child => child.kind === 3 && child.name === part);
      if (!next) {next = {name: part, kind: 3, children: []}; parent.children.push(next);}
      parent = next;
    }
    parent.children.push({name: parts.at(-1)!, kind: 2, children: [], file});
  }
  return top;
}

/** Layout-3 package: 64-byte header, u32 metadata length, preorder metadata, payloads. */
export function virtualBoxPackage(files: VirtualFile[], options: {timestamp?: number; layout?: number; root?: string; level?: number} = {}) {
  const records: Buffer[] = [], payloads: Buffer[] = []; let index = 0, position = 0;
  const visit = (node: Node, level: number) => {
    const head = Buffer.concat([u32(index++), u32(level), u32(node.children.length), wide(node.name), Buffer.from([node.kind])]);
    if (node.kind === 3) {records.push(head, Buffer.alloc(29));}
    else if (node.kind === 2) {
      const file = node.file!;
      records.push(head, Buffer.from([file.flags ?? 0, 0]), u64(file.data.length), Buffer.alloc(24), u32(32), Buffer.from([0]),
        wide(file.target ?? ""), u64(position), u64(file.data.length));
      payloads.push(file.data); position += file.data.length;
    } else {records.push(head);}
    for (const child of node.children) {visit(child, level + 1 === 1 ? 2 : level + 1);}
  };
  const root: Node = {name: "", kind: 0, children: [tree(files, options.root)]};
  records.push(Buffer.concat([u32(index++), u32(0), u32(1), wide(""), Buffer.from([0])]));
  visit(root.children[0], options.level ?? 1);
  const metadata = Buffer.concat(records), body = Buffer.concat(payloads);
  const fsSpan = 4 + metadata.length + body.length;
  const header = Buffer.alloc(64); Buffer.from("EVB\0", "latin1").copy(header);
  header.writeUInt32LE(64, 4); header.writeDoubleLE(options.timestamp ?? 44000, 8);
  header.writeUInt32LE(1, 16); header.writeUInt32LE(options.layout ?? 3, 20);
  header.writeBigUInt64LE(64n, 24); header.writeBigUInt64LE(BigInt(fsSpan), 32);
  return Buffer.concat([header, u32(metadata.length), metadata, body]);
}

/** PE32 with a TLS callback connected to a loader that reads section[n-2] config. */
export function virtualBoxExecutable(masks: string[], internal: Buffer, options: {disconnect?: boolean; prefix?: string} = {}) {
  const imageBase = 0x400000, align = 0x200, sectionRva = (i: number) => 0x1000 * (i + 1);
  // Section 0: headers' TLS directory and callback table; 1: config; 2: loader code.
  const prefix = options.prefix ?? "%DEFAULT FOLDER%\\";
  const config = Buffer.alloc(176);
  config.writeUInt32LE(prefix.length, 156); config.writeUInt32LE(masks.length, 164);
  const names = Buffer.concat([Buffer.from(prefix, "utf16le"), ...masks.map(mask => Buffer.concat([u16(mask.length), Buffer.from(mask, "utf16le")]))]);
  const internalOffset = config.length + names.length;
  config.writeUInt32LE(internalOffset, 168); config.writeUInt32LE(internal.length, 112);
  const configSection = Buffer.concat([config, names, internal]);
  const initRva = sectionRva(2) + 0x100, callbackRva = sectionRva(2);
  const loader = Buffer.alloc(0x1200);
  const callback = Buffer.from([0x55, 0x8b, 0xec, 0x33, 0xd2, 0x33, 0xc0, 0xe8, 0, 0, 0, 0, 0xc3]);
  callback.writeInt32LE(initRva - (callbackRva + 12), 8); callback.copy(loader, 0);
  const init = Buffer.from([
    0x0f, 0xb7, 0x40, 6, 0x8d, 4, 0x80, 0x8b, 0x55, 0xf4, 0x8b, 0x94, 0xc2, 0xb4, 0, 0, 0, 0x8b, 0x0d, 0, 0, 0, 0,
    0x8b, 0x84, 0xc2, 0xbc, 0, 0, 0, 0x8b, 0x55, 0xf0, 3, 0x82, 0xa8, 0, 0, 0,
    0x8b, 0x80, 0x9c, 0, 0, 0, 0x8b, 0x16, 0x89, 0x42, 0x70, 5, 0xb0, 0, 0, 0, 0x8b, 0x80, 0xa4, 0, 0, 0, 0x50, 0xc3]);
  if (options.disconnect) {init[13] = 0xb8;}
  init.copy(loader, 0x100);
  const tls = Buffer.alloc(0x40);
  tls.writeUInt32LE(imageBase + sectionRva(0) + 0x30, 12); tls.writeUInt32LE(imageBase + callbackRva, 0x30);
  const sections = [tls, configSection, loader].map(data => Buffer.concat([data, Buffer.alloc((align - data.length % align) % align)]));
  const nt = 0x80, optional = 0xe0, headerSize = align;
  const head = Buffer.alloc(headerSize); head.write("MZ", 0, "latin1"); head.writeUInt32LE(nt, 60);
  head.writeUInt32LE(0x4550, nt); head.writeUInt16LE(0x14c, nt + 4); head.writeUInt16LE(sections.length, nt + 6); head.writeUInt16LE(optional, nt + 20);
  const opt = nt + 24; head.writeUInt16LE(0x10b, opt); head.writeUInt32LE(initRva, opt + 16); head.writeUInt32LE(imageBase, opt + 28);
  head.writeUInt32LE(16, opt + 92); head.writeUInt32LE(sectionRva(0), opt + 96 + 9 * 8); head.writeUInt32LE(0x18, opt + 100 + 9 * 8);
  let raw = headerSize;
  sections.forEach((data, i) => {
    const at = opt + optional + 40 * i; head.write(".s" + i, at, "latin1");
    head.writeUInt32LE(data.length, at + 8); head.writeUInt32LE(sectionRva(i), at + 12);
    head.writeUInt32LE(data.length, at + 16); head.writeUInt32LE(raw, at + 20); raw += data.length;
  });
  return {bytes: Buffer.concat([head, ...sections]), configRaw: headerSize + sections[0].length};
}
