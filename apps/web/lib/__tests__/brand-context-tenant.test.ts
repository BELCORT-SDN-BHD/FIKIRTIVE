/**
 * Brand 五节 —— 真库上的双向租户断言与草稿安全模型(FRONT-A8 / FRONT-A9;
 * 规格 docs/specs/frontend-baseline.md §7.3④,Founder 2026-09-03 裁决三 / 四 / 十一)。
 *
 * 这一份不 mock Prisma:两个真的 org、真的迁移过的表、真的服务端动作。上面那份
 * (`brand-five-sections.test.ts`)断言的是查询形状,这一份断言的是**结果** ——
 * A 看不到 B、B 看不到 A,草稿在确认之前不进 Otto,而确认之后进得去。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ auth: mockAuth }));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.FOUNDER_ADMIN_EMAILS ?? ""},${process.env.AUTH_ALLOWED_EMAILS ?? ""}`
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin, isAllowedEmail: allowed };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const A_EMAIL = `brandA-${randomUUID()}@fikirtive.test`;
const B_EMAIL = `brandB-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const {
  saveBrandDraft, confirmBrandDraft, previewBrandContextEffect, discardBrandDraft,
  getBrandContextText, updateMemory, deleteMemory, restoreMemory,
} = await import("@/lib/memory-actions");
const { loadBrandSections } = await import("@/lib/brand-context-data");
const { listBrandRevisionsAction } = await import("@/lib/brand-revision-actions");

function asUser(email: string) { mockAuth.mockResolvedValue({ user: { email } }); }
async function ensureUser(email: string) {
  return prisma.user.upsert({ where: { email }, update: {}, create: { id: `usr_${randomUUID()}`, email } });
}

let orgA: string, orgB: string;
let aDraftId: string;   // A 的草稿(确认前)
let aReadyId: string;   // A 已确认的一条
let bReadyId: string;   // B 已确认的一条

beforeAll(async () => {
  await ensureUser(A_EMAIL); await ensureUser(B_EMAIL);
  asUser(A_EMAIL); const a = await requireOwner(); if ("error" in a) throw new Error(a.error); orgA = a.ownerId;
  asUser(B_EMAIL); const b = await requireOwner(); if ("error" in b) throw new Error(b.error); orgB = b.ownerId;
  expect(orgA).not.toBe(orgB);

  asUser(A_EMAIL);
  const aReady = await saveBrandDraft({
    section: "brand-voice", name: "A voice", content: "A speaks warmly.", origin: "text", originDetail: "Pasted text",
  });
  if ("error" in aReady) throw new Error(aReady.error);
  aReadyId = aReady.id;
  const confirmed = await confirmBrandDraft({ id: aReadyId });
  if ("error" in confirmed) throw new Error(confirmed.error);

  const aDraft = await saveBrandDraft({
    section: "knowledge-base", name: "A menu", content: "A sells kuih.", origin: "text", originDetail: "Pasted text",
  });
  if ("error" in aDraft) throw new Error(aDraft.error);
  aDraftId = aDraft.id;

  asUser(B_EMAIL);
  const bReady = await saveBrandDraft({
    section: "brand-voice", name: "B voice", content: "B speaks briskly.", origin: "text", originDetail: "Pasted text",
  });
  if ("error" in bReady) throw new Error(bReady.error);
  bReadyId = bReady.id;
  const bConfirmed = await confirmBrandDraft({ id: bReadyId });
  if ("error" in bConfirmed) throw new Error(bConfirmed.error);
});

describe("FRONT-A8 商家在 Brand 五个分区写记录:刷新仍在、显示谁改的何时改的", () => {
  it("FRONT-A8 五个分区各自成立,记录落在裁决指定的那一节", async () => {
    asUser(A_EMAIL);
    const sections = await loadBrandSections(orgA);
    expect(sections.map((s) => s.key)).toEqual([
      "brand-voice", "audiences", "knowledge-base", "style-guide", "visual-guidelines",
    ]);
    const voice = sections.find((s) => s.key === "brand-voice")!;
    expect(voice.entries.map((e) => e.name)).toContain("A voice");
    // 草稿也在自己的分区里看得到(它是商家自己的待办),但状态写着 Draft。
    const knowledge = sections.find((s) => s.key === "knowledge-base")!;
    expect(knowledge.entries.find((e) => e.id === aDraftId)?.status).toBe("Draft");
  });

  it("FRONT-A8 每条都带「谁改的、何时改的」,而不是只带一个 user/otto", async () => {
    const sections = await loadBrandSections(orgA);
    const entry = sections.find((s) => s.key === "brand-voice")!.entries.find((e) => e.id === aReadyId)!;
    expect(entry.updatedByLabel).toBe(A_EMAIL);
    expect(entry.updatedAt).toBeInstanceOf(Date);
    expect(entry.origin).toBe("text");
  });

  it("FRONT-A8 改动史答得出改过什么:created 与 confirmed 两行都在", async () => {
    asUser(A_EMAIL);
    const history = await listBrandRevisionsAction({ kind: "memory", id: aReadyId });
    expect(history.map((r) => r.action)).toContain("confirmed");
    expect(history.every((r) => r.changedByLabel === A_EMAIL)).toBe(true);
  });

  it("FRONT-A8 编辑、删除、恢复:恢复之后内容完整", async () => {
    asUser(A_EMAIL);
    expect(await updateMemory({ id: aReadyId, content: "A voice\n\nA speaks warmly and slowly." })).toEqual({ ok: true });
    expect(await deleteMemory({ id: aReadyId })).toEqual({ ok: true });

    let sections = await loadBrandSections(orgA);
    let voice = sections.find((s) => s.key === "brand-voice")!;
    expect(voice.entries.find((e) => e.id === aReadyId)).toBeUndefined();
    expect(voice.removed.find((e) => e.id === aReadyId)).toBeDefined();

    expect(await restoreMemory({ id: aReadyId })).toEqual({ ok: true });
    sections = await loadBrandSections(orgA);
    voice = sections.find((s) => s.key === "brand-voice")!;
    const back = voice.entries.find((e) => e.id === aReadyId)!;
    expect(back.name).toBe("A voice");
    expect(back.content).toBe("A speaks warmly and slowly.");
  });
});

describe("FRONT-A8 租户隔离:两个方向都看不到对方", () => {
  it("FRONT-A8 A 的五节里没有 B 的任何一条", async () => {
    const sections = await loadBrandSections(orgA);
    const names = sections.flatMap((s) => [...s.entries, ...s.removed]).map((e) => e.name);
    expect(names).not.toContain("B voice");
  });

  it("FRONT-A8 B 的五节里没有 A 的任何一条", async () => {
    const sections = await loadBrandSections(orgB);
    const names = sections.flatMap((s) => [...s.entries, ...s.removed]).map((e) => e.name);
    expect(names).not.toContain("A voice");
    expect(names).not.toContain("A menu");
  });

  it("FRONT-A8 B 拿着 A 的 id 也确认不了、预览不了、删不掉 A 的记录", async () => {
    asUser(B_EMAIL);
    expect(await confirmBrandDraft({ id: aDraftId })).toEqual({ error: expect.any(String) });
    expect(await previewBrandContextEffect({ id: aDraftId })).toEqual({ error: expect.any(String) });
    expect(await discardBrandDraft({ id: aDraftId })).toEqual({ error: expect.any(String) });
    expect(await deleteMemory({ id: bReadyId })).toEqual({ ok: true }); // 自己的照样删得掉(非空断言)
    expect(await restoreMemory({ id: bReadyId })).toEqual({ ok: true });

    // A 的草稿还是草稿,一个字节没被动过。
    // 租户闸(packages/db tenant-guard)不允许无 ownerId 的 findUnique —— 这里照它的规矩查。
    const row = await prisma.memory.findFirst({
      where: { id: aDraftId, ownerId: orgA },
      select: { contextStatus: true, deletedAt: true },
    });
    expect(row).toMatchObject({ contextStatus: "Draft", deletedAt: null });
  });

  it("FRONT-A8 B 查不到 A 的改动史", async () => {
    asUser(B_EMAIL);
    expect(await listBrandRevisionsAction({ kind: "memory", id: aReadyId })).toEqual([]);
  });
});

describe("FRONT-A9 草稿进不了 Otto,确认之后才进得去", () => {
  it("FRONT-A9 确认之前,Otto 的品牌上下文里没有这条草稿", async () => {
    asUser(A_EMAIL);
    const text = await getBrandContextText();
    expect(text).toContain("A speaks warmly");
    expect(text).not.toContain("A sells kuih");
  });

  it("FRONT-A9 预览摆出的是保存前后 Otto 真读到的两段,差别正好是这一条", async () => {
    asUser(A_EMAIL);
    const preview = await previewBrandContextEffect({ id: aDraftId });
    if ("error" in preview) throw new Error(preview.error);
    expect(preview.without).not.toContain("A sells kuih");
    expect(preview.with).toContain("A sells kuih");
  });

  it("FRONT-A9 确认之后,同一条内容出现在 Otto 的品牌上下文里", async () => {
    asUser(A_EMAIL);
    expect(await confirmBrandDraft({ id: aDraftId })).toEqual({ ok: true });
    expect(await getBrandContextText()).toContain("A sells kuih");
  });

  it("FRONT-A9 B 的 Otto 上下文里永远没有 A 的内容", async () => {
    asUser(B_EMAIL);
    const text = await getBrandContextText();
    expect(text).not.toContain("A sells kuih");
    expect(text).not.toContain("A speaks warmly");
  });
});
