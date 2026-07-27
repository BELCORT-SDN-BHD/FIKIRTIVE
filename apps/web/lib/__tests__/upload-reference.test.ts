import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  projectFindFirst: vi.fn(),
  storagePut: vi.fn(),
  assetUpsert: vi.fn(),
  generationCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../auth-guard", async () => ({ requireOwner: h.requireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: h.projectFindFirst },
    asset: { upsert: h.assetUpsert },
    generation: { create: h.generationCreate },
    $transaction: h.transaction,
  },
}));
vi.mock("@fikirtive/core", () => ({
  newId: () => "new-id",
  storageKey: (ownerId: string, hash: string, ext: string) => `u/${ownerId}/${hash}.${ext}`,
  storageKeyToSrc: (key: string) => `/files/${key}`,
  fikirtiveEdit: {},
  captionCue: {},
  editDuration: {},
  parseStorageKey: () => ({}),
  keyOwnerMatches: () => true,
  srcToStorageKey: () => "",
  INGEST_QUEUE: "",
  RENDER_QUEUE: "",
  CAPTION_QUEUE: "",
}));
vi.mock("../storage", () => ({
  storage: { put: h.storagePut },
  extFromFilename: (name: string) => name.split(".").pop()?.toLowerCase() ?? "bin",
  mimeOf: (ext: string) => `image/${ext}`,
}));
vi.mock("../queue", () => ({ getBoss: vi.fn() }));
vi.mock("../entity-snapshot", () => ({ buildEntitySnapshot: vi.fn() }));
vi.mock("../edit", () => ({ buildBoardEdit: vi.fn(), transitionFor: vi.fn() }));
vi.mock("../data", () => ({ getShots: vi.fn(), getLooseVideoClips: vi.fn(), getMediaPage: vi.fn() }));

import { uploadReference } from "../actions";

const REF_MAX_BYTES = 10 * 1024 * 1024;

beforeEach(() => {
  vi.clearAllMocks();
  h.requireOwner.mockResolvedValue({ ownerId: "o1", email: "a@b.c" });
  h.projectFindFirst.mockResolvedValue({ id: "p1" });
  h.storagePut.mockResolvedValue({ contentHash: "deadbeef" });
  h.assetUpsert.mockResolvedValue({ id: "asset-1" });
  h.generationCreate.mockResolvedValue({ id: "gen-1" });
  h.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    await fn({
      asset: { upsert: h.assetUpsert },
      generation: { create: h.generationCreate },
    });
  });
});

function formWith(file: File): FormData {
  const fd = new FormData();
  fd.append("files", file);
  return fd;
}

describe("uploadReference", () => {
  it("rejects oversized canvas reference images before storage or DB writes", async () => {
    // Regression: Canvas drag/drop accepted arbitrarily large image files and
    // read them into the server action before creating an upload Generation.
    // Found by /qa on 2026-07-04.
    const file = new File([new Uint8Array(REF_MAX_BYTES + 1)], "huge.png", { type: "image/png" });

    await expect(uploadReference("p1", formWith(file))).resolves.toEqual({
      error: "Reference image must be 10 MB or smaller.",
    });
    expect(h.storagePut).not.toHaveBeenCalled();
    expect(h.transaction).not.toHaveBeenCalled();
  });
});
