export function diskName(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 32) {
    const header = view.getUint32(8, true), size = view.getUint32(12, true);
    const sector = view.getUint32(16, true), sectors = view.getUint32(20, true);
    const heads = view.getUint32(24, true), cylinders = view.getUint32(28, true);
    if (header >= 32 && header <= 1048576 && [256, 512, 1024].includes(sector) &&
        sectors > 0 && heads > 0 && cylinders > 0 && size === sector * sectors * heads * cylinders &&
        header + size === bytes.length) {return "game.hdi";}
  }
  if (bytes.length >= 688 && view.getUint32(28, true) === bytes.length &&
      [0, 0x10, 0x20].includes(bytes[27])) {return "game.d88";}
  throw new Error("NP2KAI_DISK_FORMAT_UNSUPPORTED");
}
export function configuration(name: string) {
  return new TextEncoder().encode(`[NekoProject21kai]\nclk_base=2457600\nclk_mult=16\nExMemory=13\nSampleHz=44100\nLatencys=100\nfontfile=/emulator/np2kai/font.bmp\nSTATSAVE=true\nResume=false\nJoystick=false\n${name.endsWith(".hdi") ? `HDD1FILE=/emulator/np2kai/${name}\n` : ""}`);
}
