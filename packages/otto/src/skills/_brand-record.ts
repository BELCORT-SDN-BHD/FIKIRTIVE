/**
 * _brand-record — shared $0 upsert for the three living-collection write skills.
 * Spends NO money, creates NO GenJob. Identity from ctx only (never tool input).
 * Upsert-by-name: find live row (ownerId+kind+nameKey) → merge-update; else create.
 */
import type { RunContext } from "@openai/agents";
import { prisma, Prisma, createProduct, confirmProductDraft, updateProductRecord } from "@fikirtive/db";
import {
  newId, recordSchemaFor, recordName, normalizeNameKey, type RecordKind,
} from "@fikirtive/core";
import type { OttoContext } from "../context.js";

export interface UpsertBrandRecordInput {
  kind: RecordKind;
  /** Partial per-kind fields, already shape-checked by the skill's zod parameters. */
  fields: Record<string, unknown>;
  status?: "active" | "archived";
  startsAt?: string; // YYYY-MM-DD (offers)
  endsAt?: string;
}

const stripUndefined = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const toDate = (v?: string): Date | undefined => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

export async function upsertBrandRecordFromOtto(
  input: UpsertBrandRecordInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ ok: true; id: string; updated: boolean }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  const name = recordName(input.kind, input.fields);
  const nameKey = normalizeNameKey(name);
  if (!nameKey) throw new Error(`A ${input.kind} needs a name.`);

  const existing = await prisma.brandRecord.findFirst({
    where: { ownerId: ctx.orgId, brandId: null, kind: input.kind, nameKey, deletedAt: null },
    select: { id: true, data: true, contextStatus: true },
  });

  // Merge (update) or take as-is (create), then validate the FULL shape.
  const mergedRaw = existing
    ? { ...(existing.data as Record<string, unknown>), ...stripUndefined(input.fields) }
    : stripUndefined(input.fields);
  const parsed = recordSchemaFor(input.kind).safeParse(mergedRaw);
  if (!parsed.success) {
    throw new Error(`Invalid ${input.kind}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  const data = parsed.data as unknown as Prisma.InputJsonObject;

  const dates = stripUndefined({ startsAt: toDate(input.startsAt), endsAt: toDate(input.endsAt) });
  const status = input.status;

  if (existing) {
    // 撞上的是一条**草稿产品**(理解 worker 从菜单里读出来的那种):商家现在开口说「记下产品 X」
    // 就是在确认它 —— 走共享动作补身份、抬 Ready(规格 §1.9;PRODID-A7 前半句「两边出现」)。
    // 判官第 2 轮 P0(PR #1337):少了这一步,Otto 回「saved」,但不建身份、不进 Library/@ 菜单,
    // 也不进 Otto 自己那条只读 Ready 的上下文 —— 它事后连自己说保存过的产品都读不到。
    if (input.kind === "product" && existing.contextStatus === "Draft") {
      const done = await confirmProductDraft({
        ownerId: ctx.orgId, id: existing.id, data: parsed.data as Record<string, unknown>, source: "otto",
      });
      if (!done.ok) throw new Error(`Couldn't save that ${input.kind}.`);
      return { ok: true, id: existing.id, updated: true };
    }
    if (input.kind === "product") {
      // 名字与主图的权威是身份(规格 §1.4;PRODID-A4)。Otto 面改产品也走共享动作,一个事务
      // 同时写身份与价签 —— 否则 Otto 改个名字,Library 那张卡还是旧名字(判官第 3 轮 P1-1)。
      const done = await updateProductRecord({
        ownerId: ctx.orgId, id: existing.id, data: parsed.data as Record<string, unknown>,
        source: "otto", ...(status ? { status } : {}),
      });
      if (!done.ok) throw new Error(`Couldn't save that ${input.kind}.`);
      return { ok: true, id: existing.id, updated: true };
    }
    await prisma.brandRecord.update({
      where: { id: existing.id },
      data: { data, nameKey, source: "otto", ...(status ? { status } : {}), ...dates },
    });
    return { ok: true, id: existing.id, updated: true };
  }

  if (input.kind === "product") {
    // 产品有身份那一半:Entity(PRODUCT) 与价签同事务出生。Otto 与人工 UI 走同一条共享动作
    // (规格 docs/specs/brand-product-identity.md §1.4)。product 从来没有 offer 的起止日期。
    const made = await createProduct({
      ownerId: ctx.orgId, brandId: null, data: parsed.data as Record<string, unknown>,
      source: "otto", status: status ?? "active",
    });
    if (made.created) return { ok: true, id: made.id, updated: false };
    // 撞名 —— 与下面 create 分支的那次重试同一个语义:另一条同名活跃行赢了,转成 update。
    // 判官第 3 轮 P2-d:这条回退原先直接 update,而赢下名字槽位的那一行**可能是一条草稿**
    // (理解 worker 从菜单里读出来的那种)—— 那就跟上面 `existing` 那一支同一个分流:
    // 草稿要**转正**(补身份、抬 Ready),不是往一条永远没有身份的行上写 data。
    if (!made.existingId) throw new Error(`Couldn't save that ${input.kind}.`);
    const raced = await prisma.brandRecord.findFirst({
      where: { id: made.existingId, ownerId: ctx.orgId, deletedAt: null },
      select: { contextStatus: true },
    });
    if (raced?.contextStatus === "Draft") {
      const promoted = await confirmProductDraft({
        ownerId: ctx.orgId, id: made.existingId, data: parsed.data as Record<string, unknown>, source: "otto",
      });
      if (!promoted.ok) throw new Error(`Couldn't save that ${input.kind}.`);
      return { ok: true, id: made.existingId, updated: true };
    }
    const done = await updateProductRecord({
      ownerId: ctx.orgId, id: made.existingId, data: parsed.data as Record<string, unknown>,
      source: "otto", ...(status ? { status } : {}),
    });
    if (!done.ok) throw new Error(`Couldn't save that ${input.kind}.`);
    return { ok: true, id: made.existingId, updated: true };
  }

  const id = newId();
  try {
    await prisma.brandRecord.create({
      data: {
        id, ownerId: ctx.orgId, brandId: null,
        kind: input.kind, nameKey, data,
        status: status ?? "active",
        startsAt: (dates.startsAt as Date | undefined) ?? null,
        endsAt: (dates.endsAt as Date | undefined) ?? null,
        source: "otto", pinned: false,
      },
    });
  } catch (e) {
    // Unique-index race (two turns saving the same name): retry once as an update.
    const again = await prisma.brandRecord.findFirst({
      where: { ownerId: ctx.orgId, brandId: null, kind: input.kind, nameKey, deletedAt: null },
      select: { id: true },
    });
    if (!again) throw e;
    await prisma.brandRecord.update({ where: { id: again.id }, data: { data, source: "otto", ...(status ? { status } : {}), ...dates } });
    return { ok: true, id: again.id, updated: true };
  }
  return { ok: true, id, updated: false };
}
