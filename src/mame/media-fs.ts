type MediaNode = {node_ops: {getattr(node: MediaNode): {size: number; [key: string]: unknown}; [key: string]: unknown};
  stream_ops: Record<string, unknown>};
export type MameMediaFS = {mkdirTree(path: string): void; writeFile(path: string, bytes: Uint8Array): void;
  chmod(path: string, mode: number): void; lookupPath(path: string): {node: MediaNode};
  ErrnoError: new (errno: number) => Error; ignorePermissions: boolean};

/** Self-contained so the same implementation can be installed inside the native core worker. */
export function mountMameMedia(fs: MameMediaFS, path: string, size: number, reader: {readInto(offset: number, bytes: Uint8Array): number}) {
  if (!/^[a-z0-9_]{1,32}\/[^/\\]+\.chd$/iu.test(path) || path.includes("..") ||
    !Number.isSafeInteger(size) || size < 1) {throw new Error("MAME_CONTENT_INVALID");}
  const target = `/content/roms/${path}`;
  fs.mkdirTree(target.slice(0, target.lastIndexOf("/"))); fs.writeFile(target, new Uint8Array());
  fs.chmod(target, 0o444); fs.ignorePermissions = false;
  const node = fs.lookupPath(target).node, original = node.node_ops;
  node.node_ops = {...original, getattr: value => ({...original.getattr(value), size})};
  node.stream_ops = {...node.stream_ops,
    read: (_stream: unknown, buffer: Uint8Array, offset: number, length: number, position: number) => {
      if (![position, offset, length].every(Number.isSafeInteger) || Math.min(position, offset, length) < 0 ||
        offset > buffer.length - length) {throw new fs.ErrnoError(28);}
      const count = Math.max(0, Math.min(length, size - position));
      for (let done = 0; done < count;) {
        const chunk = Math.min(count - done, 256 * 1024);
        if (reader.readInto(position + done, buffer.subarray(offset + done, offset + done + chunk)) !== chunk) {throw new fs.ErrnoError(29);}
        done += chunk;
      }
      return count;
    },
    write: () => {throw new fs.ErrnoError(63);},
    llseek: (stream: {position: number}, offset: number, whence: number) => {
      const position = offset + (whence === 0 ? 0 : whence === 1 ? stream.position : whence === 2 ? size : NaN);
      if (!Number.isSafeInteger(position) || position < 0) {throw new fs.ErrnoError(28);} return position;
    },
    mmap: () => {throw new fs.ErrnoError(43);},
  };
}
