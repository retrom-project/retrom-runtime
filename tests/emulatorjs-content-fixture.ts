import {vi} from "vitest";

// Lifecycle tests stop at the core handoff; real bytes and persistence run in browser cases.
vi.mock("../src/content-io/bootstrap.js", () => ({
  bootstrapContentSession: vi.fn(async () => {
    const sources = new Map<string, {sizeBytes: number}>();
    let next = 0;
    return {
      close: vi.fn(async () => {}), fail: vi.fn(), closeFile: vi.fn(async () => {}),
      open: vi.fn(async (source: {sizeBytes: number}) => {
        const id = String(++next); sources.set(id, source);
        return {id, close: vi.fn(async () => {sources.delete(id);})};
      }),
      materialize: vi.fn(async (id: string, request: {kind: string}) => {
        const source = sources.get(id);
        if (!source) {throw new Error("fixture reader closed");}
        const bytes = new Uint8Array(source.sizeBytes);
        return request.kind === "BYTES" ? {kind: "BYTES", bytes} : {kind: "BLOB", blob: new Blob([bytes]), release: async () => {}};
      }),
    };
  }),
}));
