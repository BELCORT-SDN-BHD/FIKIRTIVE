import "server-only";
import { prisma } from "@fikirtive/db";
import {
  BRAND_SECTIONS,
  brandSectionForCategory,
  brandSectionForRecordKind,
  brandSectionLabel,
  recordName,
  OTTO_AUTHOR_LABEL,
  type BrandSectionKey,
  type BrandContextStatus,
} from "@fikirtive/core";
import { labelsForUserIds, listBrandRevisions, type BrandRevisionRow } from "./brand-revision";
import { unpackBrandContent } from "./brand-context-format";

/**
 * brand-context-data —— Brand 五节的读模型(FRONT-A8;规格 §7.3④,Founder 2026-09-03
 * 裁决三＋十一)。
 *
 * 六节 → 五节是**读的时候算**的:`Memory.category` 的存量值一个字节都没改,归属由
 * `@fikirtive/core` 的 `brandSectionForCategory` / `brandSectionForRecordKind` 给出。
 * 这样 Otto 读到的正文与迁移前逐字相同(memory-actions 的 `compileBrandContext` 仍按
 * 老六节分段),而商家看到的是设计的五节。
 *
 * 「设计有、后端没有契约」的两样东西**不在这里出现**,也就不会被界面渲染出来:
 *   · usage(这条上下文被哪些面用到)—— 规格明写「由读模型算,不落列」,而今天没有一个
 *     真实的生产者能回答它;编一个「Not used yet」就是拿假话填版面。
 *   · instructions(Otto 该怎么用这条上下文)—— 没有这样一张表,也没有人写过它。
 */

export type BrandContextEntry = {
  id: string;
  /** 'memory' = 自由文本上下文(可在这一面编辑);'record' = 结构化记录(产品/客群/优惠)。 */
  kind: "memory" | "record";
  section: BrandSectionKey;
  name: string;
  /** 这个名字是这一行**自己**带的,还是分区标签兜的底(判官 P1-2)。编辑回写时要它:
   *  兜底来的名字一旦被打包进 `Memory.content`,那个占位词就成了 Otto 读到的正文。 */
  named: boolean;
  content: string;
  status: BrandContextStatus;
  /** 来源:'manual' | 'text' | 'url' | 'file'。 */
  origin: string;
  originDetail: string | null;
  /** 最后是**谁**写的:'otto' | 'user'。与 `origin`(材料从哪来)不是一回事;来路标签
   *  与作者兜底两处都要它 —— Otto 的写路径只写这一列(判官 P1-3)。 */
  source: string;
  updatedAt: Date;
  /** 「谁改的」。拿不到人时是 null —— 界面照直说不知道,而不是填一个名字。 */
  updatedByLabel: string | null;
  removed: boolean;
};

export type BrandSectionView = {
  key: BrandSectionKey;
  label: string;
  entries: BrandContextEntry[];
  removed: BrandContextEntry[];
};

const RECORD_LABEL_FALLBACK = "Untitled record";

function recordTitle(kind: string, data: unknown): string {
  const name = recordName(kind as never, (data ?? {}) as Record<string, unknown>);
  return typeof name === "string" && name.trim() ? name.trim() : RECORD_LABEL_FALLBACK;
}

function recordSummary(data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>;
  const bits = ["description", "details", "who", "wants", "pains", "sellingAngle"]
    .map((k) => (typeof d[k] === "string" ? (d[k] as string).trim() : ""))
    .filter(Boolean);
  return bits.join(" · ");
}

/**
 * 一个 org 的五节全景。**永远带 ownerId** —— 租户边界与 Memory / BrandRecord 同一条。
 * 调用方必须自己先过 `requireOwner()`,这个函数不认任何客户端传来的 id(它根本不是
 * Server Action,拿不到会话)。
 */
export async function loadBrandSections(ownerId: string): Promise<BrandSectionView[]> {
  const [memories, records] = await Promise.all([
    prisma.memory.findMany({
      where: { ownerId, brandId: null },
      orderBy: [{ updatedAt: "desc" }],
      take: 300,
      select: {
        id: true, category: true, content: true, contextStatus: true,
        origin: true, originDetail: true, source: true,
        updatedAt: true, updatedById: true, deletedAt: true,
      },
    }),
    prisma.brandRecord.findMany({
      where: { ownerId, brandId: null },
      orderBy: [{ updatedAt: "desc" }],
      take: 300,
      select: {
        id: true, kind: true, data: true, contextStatus: true,
        origin: true, originDetail: true, source: true,
        updatedAt: true, updatedById: true, deletedAt: true,
      },
    }),
  ]);

  const labels = await labelsForUserIds([
    ...memories.map((m) => m.updatedById ?? ""),
    ...records.map((r) => r.updatedById ?? ""),
  ]);

  const entries: BrandContextEntry[] = [];

  for (const m of memories) {
    const section = brandSectionForCategory(m.category);
    const { name, named, content } = unpackBrandContent(m.content, brandSectionLabel(section));
    entries.push({
      id: m.id,
      kind: "memory",
      section,
      name,
      named,
      content,
      status: (m.contextStatus as BrandContextStatus) ?? "Ready",
      origin: m.origin ?? "manual",
      originDetail: m.originDetail,
      source: m.source ?? "user",
      updatedAt: m.updatedAt,
      updatedByLabel: authorLabel(m.updatedById, m.source, labels),
      removed: m.deletedAt !== null,
    });
  }

  for (const r of records) {
    entries.push({
      id: r.id,
      kind: "record",
      section: brandSectionForRecordKind(r.kind),
      name: recordTitle(r.kind, r.data),
      // 结构化记录的名字来自它自己的 data,不是兜底来的。
      named: true,
      content: recordSummary(r.data),
      status: (r.contextStatus as BrandContextStatus) ?? "Ready",
      origin: r.origin ?? "manual",
      originDetail: r.originDetail,
      source: r.source ?? "user",
      updatedAt: r.updatedAt,
      updatedByLabel: authorLabel(r.updatedById, r.source, labels),
      removed: r.deletedAt !== null,
    });
  }

  return BRAND_SECTIONS.map((section) => {
    const mine = entries.filter((e) => e.section === section.key);
    return {
      key: section.key,
      label: section.label,
      entries: mine.filter((e) => !e.removed).sort(byRecency),
      removed: mine.filter((e) => e.removed).sort(byRecency),
    };
  });
}

/**
 * 「谁改的」(判官 P1-3)。`updatedById` 是本轮才加的列,Otto 的写路径不写它 —— 光看
 * 那一列,Otto 记下的每一条都会显示成「we don't have a record of who」,而库里其实
 * 答得出:`source = 'otto'`。顺序因此是「先认人,认不出再问是不是 Otto,都不是才照直
 * 说不知道」—— 不编一个人,也不把已经知道的事说成不知道。
 */
function authorLabel(
  updatedById: string | null,
  source: string | null,
  labels: Map<string, string>,
): string | null {
  if (updatedById) {
    const known = labels.get(updatedById);
    if (known) return known;
  }
  if (source === "otto") return OTTO_AUTHOR_LABEL;
  return null;
}

function byRecency(a: BrandContextEntry, b: BrandContextEntry): number {
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

export type { BrandRevisionRow };

/** 一条上下文的改动史(设计的 Change history 那一层)。租户边界同上。 */
export async function loadBrandRevisions(
  ownerId: string,
  kind: "memory" | "record",
  id: string,
): Promise<BrandRevisionRow[]> {
  return listBrandRevisions(ownerId, kind, id);
}
