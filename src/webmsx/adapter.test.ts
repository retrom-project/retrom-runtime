import {createHash, webcrypto} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import {mountWebMSX} from "./adapter.js";
import type {WebMSXModule} from "./core.js";
const bytes = new Uint8Array([65, 66, 0, 64, 0, 0, 0, 0]);
const config = {mediaUrl: 'https://content.test/cart', mediaSizeBytes: bytes.length,
  contentDigest: createHash('sha256').update(bytes).digest('hex'), runtimeBaseUrl: '/assets/webmsx/'};
afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks();});
it('transfers checkpoints to a fresh core and cleans up input, machine and surface on exit', async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', async () => new Response(bytes));
  const target = document.createElement('div');
  const state = new Uint8Array([1, 2, 3]);
  const stop = vi.fn(); const pause = vi.fn(); const resume = vi.fn();
  const module: WebMSXModule = {abi: 'webmsx-host-v1', create: vi.fn(async () => ({
    canvas: document.createElement('canvas'), checkpoint: () => state, pause, resume, stop,
  }))};
  const loader = vi.fn(async () => module);
  const first = await mountWebMSX(config, target, window, null, () => undefined, undefined, loader);
  await first.pause(); expect(pause).toHaveBeenCalledOnce();
  const snapshot = await first.checkpoint();
  expect(snapshot).toEqual({bytes: state, format: 'webmsx-state-v1'});
  expect(snapshot.bytes).not.toBe(state);
  await first.resume(); expect(resume).toHaveBeenCalledOnce();
  await first.exit(); await first.exit(); expect(stop).toHaveBeenCalledOnce();
  await expect(first.checkpoint()).rejects.toThrow('WEBMSX_STOPPED');
  const next = await mountWebMSX(config, target, window, snapshot.bytes, () => undefined, undefined, loader);
  expect(module.create).toHaveBeenLastCalledWith(expect.objectContaining({restore: state, digest: config.contentDigest}));
  await next.exit();
});
it('rejects empty restoration before fetching content', async () => {
  const network = vi.fn(); vi.stubGlobal('fetch', network);
  await expect(mountWebMSX(config, document.createElement('div'), window, new Uint8Array(), () => undefined))
    .rejects.toThrow('WEBMSX_CONFIG_INVALID');
  expect(network).not.toHaveBeenCalled();
});

it('preserves bounded error codes thrown by the iframe realm', async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', async () => new Response(bytes));
  const frame = document.createElement('iframe'); document.body.append(frame);
  const foreignError = new (frame.contentWindow as Window & {Error: ErrorConstructor}).Error('WEBMSX_START_TIMEOUT');
  const module: WebMSXModule = {abi: 'webmsx-host-v1', create: async () => {throw foreignError;}};
  try {
    const error = await mountWebMSX(config, document.createElement('div'), window, null,
      () => undefined, undefined, async () => module).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty('message', 'WEBMSX_START_TIMEOUT');
  } finally {frame.remove();}
});
