"use server";
import { requireOwner } from "./auth-guard";
import { listBrandRevisions, type BrandRevisionRow } from "./brand-revision";

/**
 * 一条品牌上下文的改动史,给界面按需取(设计的 Change history 是可展开层级 ——
 * 一进页面就把每条记录的历史都查出来是白花的查询)。
 *
 * SECURITY:owner 来自 SESSION,调用方传来的任何 id 一律不认(同 memory-actions 的口径)。
 * 拿别人的 targetId 来问,查询里带的仍是自己的 ownerId,所以只会查到空。
 */
export async function listBrandRevisionsAction(
  raw: unknown,
): Promise<BrandRevisionRow[]> {
  const r = raw as { kind?: unknown; id?: unknown };
  const kind = r?.kind === "record" ? "record" : "memory";
  if (typeof r?.id !== "string") return [];
  const gate = await requireOwner();
  if ("error" in gate) return [];
  return listBrandRevisions(gate.ownerId, kind, r.id);
}
