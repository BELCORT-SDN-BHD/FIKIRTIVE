/**
 * Once ReferenceImage_live_entity_asset_variant_key (migration 20260703000000) exists,
 * the two upload paths that create ReferenceImage rows must survive the live-uniqueness
 * collision — content-addressed upload dedups identical files to ONE Asset, so:
 *   - createEntity with the same image selected twice → the repeat targets the same row
 *   - addReferenceImages re-uploading an already-attached image → create hits the index
 * Both previously created a silent duplicate row. Neither may 500.
 *
 * The two paths answer it differently on purpose (#698): createEntity commits its rows in ONE
 * transaction, where a P2002 would abort the whole upload, so it skips the repeat BEFORE the
 * insert; addReferenceImages writes outside a transaction against a pre-existing element, so it
 * still swallows the index's P2002 after the fact. A non-P2002 DB error must never be laundered
 * into success — addReferenceImages propagates it, createEntity rolls back and returns { error }.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  entityCreate: vi.fn(),
  entityFindFirst: vi.fn(),
  entityUpdate: vi.fn(),
  refImageCreate: vi.fn(),
  refImageCount: vi.fn(),
  refImageFindFirst: vi.fn(),
  assetUpsert: vi.fn(),
  actionEventCreate: vi.fn(),
  storagePut: vi.fn(),
}));

vi.mock("../auth-guard", async () => ({ requireOwner: h.requireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@fikirtive/db", () => {
  const prisma = {
    entity: { create: h.entityCreate, findFirst: h.entityFindFirst, update: h.entityUpdate },
    referenceImage: { create: h.refImageCreate, count: h.refImageCount, findFirst: h.refImageFindFirst },
    asset: { upsert: h.assetUpsert },
    actionEvent: { create: h.actionEventCreate },
    // #698 — createEntity now commits every row write together; the tx client is this same
    // mock so the assertions below still see each call.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  return { prisma };
});
vi.mock("@fikirtive/core", () => ({
  newId: () => `id-${Math.random().toString(36).slice(2)}`,
  // used by ingestFile: byte-derived mime (工单 F) — stubbed to a stable image mime here (these
  // tests assert P2002 dedup, not mime resolution; the real classifier is covered in media-sniff).
  resolveUploadMime: (_bytes: Uint8Array, ext: string) => `image/${ext}`,
  MEDIA_SNIFF_BYTES: 4096,
  // unused-by-these-actions exports imported at module top level:
  fikirtiveEdit: {}, captionCue: {}, editDuration: {}, parseStorageKey: () => ({}),
  keyOwnerMatches: () => true, srcToStorageKey: () => "", storageKey: () => "", storageKeyToSrc: () => "",
  INGEST_QUEUE: "", RENDER_QUEUE: "", CAPTION_QUEUE: "",
}));
vi.mock("../storage", () => ({
  storage: { put: h.storagePut },
  extFromFilename: (name: string) => name.split(".").pop() ?? "bin",
  mimeOf: (ext: string) => `image/${ext}`,
}));
// sibling modules imported at the top of actions.ts but unused by these two actions:
vi.mock("../queue", () => ({ getBoss: vi.fn() }));
vi.mock("../entity-snapshot", () => ({ buildEntitySnapshot: vi.fn() }));
vi.mock("../edit", () => ({ buildBoardEdit: vi.fn(), transitionFor: vi.fn() }));
vi.mock("../data", () => ({ getShots: vi.fn(), getLooseVideoClips: vi.fn(), getMediaPage: vi.fn() }));

import { createEntity, addReferenceImages } from "../actions";

const P2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

function pngFile(name = "same.png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}
function formWith(...files: File[]): FormData {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  return fd;
}
function createForm(...files: File[]): FormData {
  const fd = formWith(...files);
  fd.append("name", "Nova");
  fd.append("type", "CHARACTER");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets call history but NOT queued mock*Once implementations —
  // reset the create mock so a leftover once from a prior test can't bleed over.
  h.refImageCreate.mockReset();
  h.requireOwner.mockResolvedValue({ ownerId: "o1", email: "a@b.c" });
  h.entityCreate.mockResolvedValue({ id: "e1" });
  h.entityFindFirst.mockResolvedValue({ id: "e1", baseAssetId: null });
  h.entityUpdate.mockResolvedValue({});
  h.actionEventCreate.mockResolvedValue({});
  h.refImageCount.mockResolvedValue(0);
  h.refImageFindFirst.mockResolvedValue(null); // no prior ref → nextRefPosition starts at 0
  // identical files content-dedup to the SAME asset (content-addressed upload)
  h.storagePut.mockResolvedValue({ contentHash: "deadbeef" });
  h.assetUpsert.mockResolvedValue({ id: "asset-shared" });
});

describe("createEntity — same image selected twice (content-deduped)", () => {
  /** #698 — the row writes now share ONE transaction, where a P2002 aborts everything and
   *  cannot be swallowed after the fact. The repeat is therefore skipped BEFORE the database
   *  sees it: one reference row, one successful element, still never a 500. */
  it("skips the repeat before it reaches the index and still creates the entity", async () => {
    h.refImageCreate.mockResolvedValue({ id: "ref1" });

    const res = await createEntity(createForm(pngFile(), pngFile()));

    expect(res).toMatchObject({ id: expect.any(String) });
    expect(h.entityCreate).toHaveBeenCalledWith({
      data: { id: (res as { id: string }).id, ownerId: "o1", name: "Nova", type: "CHARACTER" },
    });
    expect(h.refImageCreate).toHaveBeenCalledTimes(1); // the deduped repeat is never attempted
  });

  /** #698 — a DB failure used to escape as a 500 AFTER the Entity row had committed, leaving
   *  an imageless tile in the Library and no message. It now rolls back and comes back as a
   *  merchant-readable error the dialog can render. */
  it("reports a DB failure as an error instead of throwing, and creates no element", async () => {
    h.refImageCreate.mockRejectedValueOnce(new Error("db down"));
    const res = await createEntity(createForm(pngFile()));
    expect(res).toMatchObject({ error: expect.any(String) });
    expect(h.actionEventCreate).not.toHaveBeenCalled();
  });
});

describe("addReferenceImages — re-uploading an already-attached image hits the live index", () => {
  it("skips the P2002 duplicate row and still returns ok", async () => {
    h.refImageCreate.mockRejectedValueOnce(P2002);

    const res = await addReferenceImages("e1", formWith(pngFile()));

    expect(res).toEqual({ ok: true });
    expect(h.refImageCreate).toHaveBeenCalledTimes(1);
  });

  it("still propagates a non-P2002 DB error", async () => {
    h.refImageCreate.mockRejectedValueOnce(new Error("db down"));
    await expect(addReferenceImages("e1", formWith(pngFile()))).rejects.toThrow("db down");
  });
});
