/**
 * Once ReferenceImage_live_entity_asset_variant_key (migration 20260703000000) exists,
 * the two upload paths that create ReferenceImage rows must tolerate the live-uniqueness
 * P2002 — content-addressed upload dedups identical files to ONE Asset, so:
 *   - createEntity with the same image selected twice → 2nd create hits the index
 *   - addReferenceImages re-uploading an already-attached image → create hits the index
 * Both previously created a silent duplicate row; with the index the 2nd create throws
 * P2002. The action must skip that row and still succeed (never 500). A non-P2002 DB
 * error must still propagate.
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

vi.mock("../auth-guard", () => ({ requireOwner: h.requireOwner }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    entity: { create: h.entityCreate, findFirst: h.entityFindFirst, update: h.entityUpdate },
    referenceImage: { create: h.refImageCreate, count: h.refImageCount, findFirst: h.refImageFindFirst },
    asset: { upsert: h.assetUpsert },
    actionEvent: { create: h.actionEventCreate },
  },
}));
vi.mock("@fikirtive/core", () => ({
  newId: () => `id-${Math.random().toString(36).slice(2)}`,
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

describe("createEntity — same image selected twice (content-deduped) hits the live index", () => {
  it("skips the P2002 duplicate row and still creates the entity", async () => {
    h.refImageCreate.mockResolvedValueOnce({ id: "ref1" }).mockRejectedValueOnce(P2002);

    const res = await createEntity(createForm(pngFile(), pngFile()));

    expect(res).toEqual({ id: "e1" });
    expect(h.refImageCreate).toHaveBeenCalledTimes(2); // both attempted; 2nd swallowed
  });

  it("still propagates a non-P2002 DB error", async () => {
    h.refImageCreate.mockRejectedValueOnce(new Error("db down"));
    await expect(createEntity(createForm(pngFile()))).rejects.toThrow("db down");
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
