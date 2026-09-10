"use server";
import { revalidatePath } from "next/cache";
import { SAVE_FAILED } from "./save-failed-copy";
import { prisma, Prisma, createProduct, confirmProductDraft } from "@fikirtive/db";
import {
  newId, RECORD_KINDS, recordSchemaFor, recordName, normalizeNameKey, type RecordKind,
} from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { resolveActor, recordBrandRevision, stampOf, actorStamp } from "./brand-revision";

export type BrandRecordRow = {
  id: string;
  kind: RecordKind;
  data: Record<string, unknown>;
  status: "active" | "archived";
  startsAt: Date | null;
  endsAt: Date | null;
  source: "otto" | "user";
  pinned: boolean;
  updatedAt: Date;
};

const SELECT = {
  id: true, kind: true, data: true, status: true,
  startsAt: true, endsAt: true, source: true, pinned: true, updatedAt: true,
} as const;

/** Client-callable list (Memory-screen refetch after a chat turn). Session-scoped. */
export async function listMyBrandRecords(): Promise<BrandRecordRow[]> {
  return listBrandRecords();
}

export async function listBrandRecords(_ownerId?: string, brandId?: string | null): Promise<BrandRecordRow[]> {
  // SECURITY: "use server" export — owner comes from the SESSION, caller ids ignored (see memory-actions listMemory).
  const gate = await requireOwner();
  if ("error" in gate) return [];
  const rows = await prisma.brandRecord.findMany({
    // 与 Memory 同一条纪律:只有 Ready 是正式记录(FRONT-A8,规格 §7.3④)。
    where: { ownerId: gate.ownerId, brandId: brandId ?? null, deletedAt: null, contextStatus: "Ready" },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    select: SELECT,
  });
  return rows as unknown as BrandRecordRow[];
}

function parseInput(raw: unknown):
  | { kind: RecordKind; data: Record<string, unknown>; id?: string; status?: "active" | "archived"; startsAt?: Date | null; endsAt?: Date | null }
  | { error: string } {
  const r = raw as { id?: unknown; kind?: unknown; data?: unknown; status?: unknown; startsAt?: unknown; endsAt?: unknown };
  const kind = r?.kind as RecordKind;
  if (!RECORD_KINDS.includes(kind)) return { error: "Unknown record type." };
  const parsed = recordSchemaFor(kind).safeParse(r.data);
  if (!parsed.success) return { error: "That record is missing something — please fill in the required fields." };
  const toDate = (v: unknown): Date | null | undefined => {
    if (v === null) return null;                       // explicit clear
    if (typeof v !== "string" || !v.trim()) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  return {
    kind,
    data: parsed.data as Record<string, unknown>,
    id: typeof r.id === "string" ? r.id : undefined,
    status: r.status === "archived" ? "archived" : r.status === "active" ? "active" : undefined,
    startsAt: kind === "offer" ? toDate(r.startsAt) : undefined,
    endsAt: kind === "offer" ? toDate(r.endsAt) : undefined,
  };
}

/**
 * 撞上的那条同名活跃行是一条**草稿产品**时,商家这次「新增产品」就是在确认它 —— 把身份补上、
 * 把价签抬成 Ready,而不是往一条永远没有身份的行上写 data。
 *
 * 判官第 2 轮 P0(PR #1337):理解 worker 现在把菜单读出来的产品落成草稿,而草稿占住
 * `(ownerId, brandId, kind, nameKey)` 这个活跃唯一名字槽位。少了这一步,商家在 Brand 页
 * 新增同名产品会静默变成对草稿的 update:返回 ok,但 Library 没有卡、@ 菜单没有项,
 * `/brand/records` 也看不到它(那条列表只认 Ready)—— PRODID-A1 在这条路径上不成立。
 *
 * 不是草稿(或不是产品)时返回 null,调用方照旧走 update 分支。
 */
async function promoteDraftProduct(
  id: string,
  kind: RecordKind,
  data: Record<string, unknown>,
  ownerId: string,
  actor: Awaited<ReturnType<typeof resolveActor>>,
): Promise<{ ok: true; id: string } | { error: string } | null> {
  if (kind !== "product") return null;
  const done = await confirmProductDraft({ ownerId, id, data, source: "user", updatedById: actor.userId });
  if (!done.ok) return done.reason === "invalid" ? { error: SAVE_FAILED } : null;
  await recordBrandRevision({
    ownerId, targetKind: "record", targetId: id, action: "confirmed",
    stamp: await stampOf(ownerId, id, "record"), actor, summary: "Saved this context for Otto.",
  });
  revalidatePath("/", "layout");
  return { ok: true, id };
}

/** Create (no id) or full-data update (id). User writes stamp source:"user". */
export async function saveBrandRecord(raw: unknown): Promise<{ ok: true; id: string } | { error: string }> {
  const input = parseInput(raw);
  if ("error" in input) return input;
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const actor = await resolveActor(gate.email);
  const nameKey = normalizeNameKey(recordName(input.kind, input.data));
  if (!nameKey) return { error: "A record needs a name." };

  try {
    if (input.id) {
      const { count } = await prisma.brandRecord.updateMany({
        where: { id: input.id, ownerId: gate.ownerId, deletedAt: null },
        data: {
          data: input.data as unknown as Prisma.InputJsonObject, nameKey, source: "user",
          updatedById: actor.userId,
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
          ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        },
      });
      if (!count) return { error: "Record not found." };
      await recordBrandRevision({
        ownerId: gate.ownerId, targetKind: "record", targetId: input.id, action: "updated",
        stamp: await stampOf(gate.ownerId, input.id, "record"), actor, summary: "Edited this record.",
      });
      revalidatePath("/", "layout");
      return { ok: true, id: input.id };
    }
    const existing = await prisma.brandRecord.findFirst({
      where: { ownerId: gate.ownerId, brandId: null, kind: input.kind, nameKey, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      const promoted = await promoteDraftProduct(existing.id, input.kind, input.data, gate.ownerId, actor);
      if (promoted) return promoted;
      return saveBrandRecord({ ...(raw as object), id: existing.id });
    }
    let id: string;
    if (input.kind === "product") {
      // 产品有身份那一半:Entity(PRODUCT) 与这条价签在同一个事务里一起出生,所以这条入口
      // 不自己 create,而是走共享动作(规格 §1.4;PRODID-A1)。人工 UI 与 Otto 同一层。
      const made = await createProduct({
        ownerId: gate.ownerId, brandId: null,
        data: input.data,
        source: "user",
        status: input.status ?? "active",
        updatedById: actor.userId,
      });
      // 上面的 findFirst 到这里之间,另一条同名行刚落地(双击、另一个 tab、Otto 同时在写):
      // 结果与 existing 分支一样 —— 转成对那一行的 update,不造第二件同名产品。
      if (!made.created) {
        if (!made.existingId) return { error: SAVE_FAILED };
        const promoted = await promoteDraftProduct(made.existingId, input.kind, input.data, gate.ownerId, actor);
        if (promoted) return promoted;
        return saveBrandRecord({ ...(raw as object), id: made.existingId });
      }
      id = made.id;
    } else {
      id = newId();
      await prisma.brandRecord.create({
        data: {
          id, ownerId: gate.ownerId, brandId: null,
          kind: input.kind, nameKey, data: input.data as unknown as Prisma.InputJsonObject,
          status: input.status ?? "active",
          startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null,
          source: "user", pinned: false,
          updatedById: actor.userId,
        },
      });
    }
    await recordBrandRevision({
      ownerId: gate.ownerId, targetKind: "record", targetId: id, action: "created",
      stamp: await stampOf(gate.ownerId, id, "record"), actor, summary: "Added this record.",
    });
    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch {
    return { error: SAVE_FAILED };
  }
}

export async function deleteBrandRecord(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown };
  if (typeof r?.id !== "string") return { error: "Invalid request." };
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const actor = await resolveActor(gate.email);
  let removed = false;
  try {
    const { count } = await prisma.brandRecord.updateMany({
      // 判官 P2-1:`deletedAt: null` 少不得 —— 少了它,连按 Remove 会把 `deletedAt` 一次次
      // 盖成新时间,幂等键(含 updatedAt)跟着变,改动史里一次删除被讲成三次。
      where: { id: r.id, ownerId: gate.ownerId, deletedAt: null },
      // 判官 P2-4:认不出人时 `actor.userId` 是 null,无条件写会把这一行已知的作者抹掉。
      data: { deletedAt: new Date(), ...actorStamp(actor) },
    });
    removed = count > 0;
    if (!removed) {
      // 回查真实状态(照 memory 那条同一口径):已经删掉的行,重发仍然算成功,不再写历史。
      const already = await prisma.brandRecord.findFirst({
        where: { id: r.id, ownerId: gate.ownerId, deletedAt: { not: null } },
        select: { id: true },
      });
      if (!already) return { error: "Record not found." };
    }
  } catch { return { error: "Couldn't delete — please try again." }; }
  if (removed) {
    await recordBrandRevision({
      ownerId: gate.ownerId, targetKind: "record", targetId: r.id, action: "deleted",
      stamp: await stampOf(gate.ownerId, r.id, "record"), actor, summary: "Removed this record.",
    });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Undo of an OTTO-removed record: bring the soft-deleted row back. */
export async function restoreBrandRecord(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown };
  if (typeof r?.id !== "string") return { error: "Invalid request." };
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const actor = await resolveActor(gate.email);
  let broughtBack = false;
  try {
    const { count } = await prisma.brandRecord.updateMany({
      // 判官 P2-1:镜像的那一半 —— 只有还在删除态的行才需要恢复。
      where: { id: r.id, ownerId: gate.ownerId, deletedAt: { not: null } },
      // 判官 P2-4:同上。
      data: { deletedAt: null, ...actorStamp(actor) },
    });
    broughtBack = count > 0;
    if (!broughtBack) {
      const already = await prisma.brandRecord.findFirst({
        where: { id: r.id, ownerId: gate.ownerId, deletedAt: null },
        select: { id: true },
      });
      if (!already) return { error: "Record not found." };
    }
  } catch { return { error: "Couldn't restore — please try again." }; }
  if (broughtBack) {
    await recordBrandRevision({
      ownerId: gate.ownerId, targetKind: "record", targetId: r.id, action: "restored",
      stamp: await stampOf(gate.ownerId, r.id, "record"), actor, summary: "Brought this record back.",
    });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * 确认一条**记录**草稿(今天只有产品会是草稿:理解 worker 从网站/菜单里读出来的那些)。
 *
 * 判官第 2 轮 P1(PR #1337):Brand 页对任何 `status === "Draft"` 的条目都渲染 Save context /
 * Discard,而那两个动作原先只认 Memory 表 —— 记录草稿点下去一律报「That draft is no longer
 * here.」,草稿既转不了正也放弃不掉。这一条与下面的 discard 是记录这一半的落点;
 * 界面按 `kind` 分流(`apps/web/app/brand/BrandWorkspace.tsx`)。
 *
 * 产品的转正 = 补身份 + 抬 Ready,走共享动作 `confirmProductDraft`(7.3 单一权威,
 * 与 Brand 页新增同名产品那条路同一处)。
 */
export async function confirmBrandRecordDraft(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown };
  if (typeof r?.id !== "string") return { error: "Invalid request." };
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const actor = await resolveActor(gate.email);
  let confirmed = false;
  try {
    const row = await prisma.brandRecord.findFirst({
      where: { id: r.id, ownerId: gate.ownerId, deletedAt: null },
      select: { kind: true, contextStatus: true },
    });
    if (!row) return { error: "That draft is no longer here." };
    // 已经是 Ready:重发的确认,结果仍然是「已保存」,不是错误,也不该再写一行历史
    // (与 memory 那条 confirmBrandDraft 同一口径)。
    if (row.contextStatus === "Draft") {
      if (row.kind === "product") {
        const done = await confirmProductDraft({
          ownerId: gate.ownerId, id: r.id, source: "user", updatedById: actor.userId,
        });
        if (!done.ok) {
          return done.reason === "invalid"
            ? { error: "That record is missing something — please fill in the required fields." }
            : { error: "That draft is no longer here." };
        }
        confirmed = true;
      } else {
        const { count } = await prisma.brandRecord.updateMany({
          where: { id: r.id, ownerId: gate.ownerId, deletedAt: null, contextStatus: "Draft" },
          data: { contextStatus: "Ready", ...actorStamp(actor) },
        });
        confirmed = count > 0;
      }
    }
  } catch { return { error: SAVE_FAILED }; }
  if (confirmed) {
    await recordBrandRevision({
      ownerId: gate.ownerId, targetKind: "record", targetId: r.id, action: "confirmed",
      stamp: await stampOf(gate.ownerId, r.id, "record"), actor,
      summary: "Saved this context for Otto.",
    });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** 放弃一条记录草稿。软删除,不是硬删 —— 与这一面其他删除同一个语义,还留着后悔的余地。 */
export async function discardBrandRecordDraft(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown };
  if (typeof r?.id !== "string") return { error: "Invalid request." };
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const actor = await resolveActor(gate.email);
  try {
    const { count } = await prisma.brandRecord.updateMany({
      // `deletedAt: null` 少不得:已经放弃过的行还留着 Draft 状态,少了它重复调用会把
      // `deletedAt` 一次次盖成新时间,幂等键(含 updatedAt)跟着变,一次放弃被讲成三次。
      where: { id: r.id, ownerId: gate.ownerId, contextStatus: "Draft", deletedAt: null },
      data: { deletedAt: new Date(), ...actorStamp(actor) },
    });
    if (!count) return { error: "That draft is no longer here." };
  } catch { return { error: "Couldn't discard that — please try again." }; }
  await recordBrandRevision({
    ownerId: gate.ownerId, targetKind: "record", targetId: r.id, action: "discarded",
    stamp: await stampOf(gate.ownerId, r.id, "record"), actor,
    summary: "Discarded this draft.",
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
