/**
 * Once ReferenceImage_live_entity_asset_variant_key (migration 20260703000000) exists, the
 * upload path that creates ReferenceImage rows must survive the live-uniqueness collision —
 * content-addressed upload dedups identical files to ONE Asset, so createEntity with the same
 * image selected twice has the repeat targeting the same row. It previously created a silent
 * duplicate row, and it may never 500.
 *
 * createEntity commits its rows in ONE transaction (#698), where a P2002 would abort the whole
 * upload, so it skips the repeat BEFORE the insert rather than swallowing the index error after
 * the fact. A non-P2002 DB error must never be laundered into success either: it rolls back and
 * comes back as { error }.
 *
 * 钱引擎⑤A 2026-09-02: the second half of this file covered `addReferenceImages`, which had no
 * UI caller left and was deleted with its exclusive helper (变更登记「A9 披露入口补挂」的两个
 * 待清理导出). The post-hoc-swallow behaviour it pinned went with it; the transactional
 * skip-before-insert above is the only ReferenceImage dedup path the product still has.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  entityCreate: vi.fn(),
  entityUpdate: vi.fn(),
  refImageCreate: vi.fn(),
  assetUpsert: vi.fn(),
  actionEventCreate: vi.fn(),
  storagePut: vi.fn(),
  // Founder 2026-09-15 裁决:挂上第一张参考图就是封面。规则住在 `@fikirtive/db` 一处
  // (`reconcileEntityCover`),createEntity 挂完图调它一次 —— 这里把它也 mock 出来,
  // 否则这个模块 mock 少一个导出,那一句就是 undefined 调用。
  reconcileCover: vi.fn(),
}));

vi.mock("../auth-guard", async () => ({ requireOwner: h.requireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@fikirtive/db", () => {
  const prisma = {
    entity: { create: h.entityCreate, update: h.entityUpdate },
    referenceImage: { create: h.refImageCreate },
    asset: { upsert: h.assetUpsert },
    actionEvent: { create: h.actionEventCreate },
    // #698 — createEntity now commits every row write together; the tx client is this same
    // mock so the assertions below still see each call.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  return { prisma, reconcileEntityCover: h.reconcileCover };
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
  RENDER_QUEUE: "", CAPTION_QUEUE: "",
}));
vi.mock("../storage", () => ({
  storage: { put: h.storagePut },
  extFromFilename: (name: string) => name.split(".").pop() ?? "bin",
  mimeOf: (ext: string) => `image/${ext}`,
}));
// sibling modules imported at the top of actions.ts but unused by this action:
vi.mock("../queue", () => ({ getBoss: vi.fn() }));
vi.mock("../edit", () => ({ buildBoardEdit: vi.fn(), transitionFor: vi.fn() }));
vi.mock("../data", () => ({ getShots: vi.fn(), getLooseVideoClips: vi.fn(), getMediaPage: vi.fn() }));

import { createEntity } from "../actions";

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
  h.entityUpdate.mockResolvedValue({});
  h.actionEventCreate.mockResolvedValue({});
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
    // 挂完图之后,封面规则在**同一个事务**里跑过一次(Founder 2026-09-15 裁决;PRODID-A4):
    // 挂上第一张图的那一刻它就成了封面,商家不必再自己去钉一次。
    expect(h.reconcileCover).toHaveBeenCalledWith(
      expect.anything(), // 事务里的那个 client(这个 mock 里就是 prisma 自己)
      { ownerId: "o1", entityId: (res as { id: string }).id },
    );
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
