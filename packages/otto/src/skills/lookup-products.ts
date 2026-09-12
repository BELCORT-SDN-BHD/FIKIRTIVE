/** lookupProducts — $0 read skill: on-demand catalog retrieval so a growing product list never bloats the prompt. */
import type { RunContext } from "@openai/agents";
import { defineOttoSkill } from "../skill.js";
import { z } from "zod";
import { prisma } from "@fikirtive/db";
import { withProductIdentity } from "@fikirtive/core";
import type { OttoContext } from "../context.js";

const params = z.object({ query: z.string().min(1).max(80) });

export async function executeLookupProducts(
  input: z.infer<typeof params>,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ matches: Record<string, unknown>[] }> {
  const ctx = runContext.context as OttoContext;
  const q = input.query.trim().toLowerCase();
  const rows = await prisma.brandRecord.findMany({
    // `contextStatus: "Ready"` —— 规格 §1.9 第三句「Otto 在确认前不把草稿当事实」。理解 worker
    // 猜出来、商家从没确认过的草稿产品不是商家的在售商品,不能拿去命名、定价、写文案
    // (判官第 2 轮 P1,PR #1337)。同 memory-actions 的 compileBrandContext 那条 READY_ONLY。
    where: {
      ownerId: ctx.orgId, brandId: null, kind: "product",
      deletedAt: null, status: "active", contextStatus: "Ready",
    },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    // 名字与主图的权威是身份(规格 §1.4;PRODID-A4)。Otto 说出口的产品名必须和商家在
    // Library 看到的那一个逐字相同,所以这里 join 身份把 data 里的缓存盖掉。
    //
    // FSE-210(判官 P2-3,PR #1420)—— 这一份 select 从前只取了身份的 `name` / `baseAssetId`,
    // 没有 `id`。查到的每一件产品因此没有一个 id 能让 Otto 把它 `@` 进 propose 的 `entityIds`——
    // 一件没挂参考图的产品从 `availableRefs`(`loadAvailableRefsForAgent`)的 `@` 候选名单里被
    // 过滤掉之后,`lookupProducts` 本该是 Otto 唯一还找得到它身份的路,却在这里把 id 漏掉了。
    select: { kind: true, data: true, entity: { select: { id: true, name: true, baseAssetId: true } } },
    take: 200, // catalog design bound (founder decision 6); substring match in app code
  });
  const hit = (d: Record<string, unknown>): boolean => {
    const hay = [d.name, d.description, d.sellingAngle, d.category, ...(Array.isArray(d.tags) ? d.tags : [])]
      .filter((v): v is string => typeof v === "string").join(" ").toLowerCase();
    return hay.includes(q);
  };
  const matches = rows
    .map((r) => ({
      ...withProductIdentity(r.kind, r.data as Record<string, unknown>, r.entity),
      // FSE-210(判官 P2-3)—— 身份 id,与 name / imageAssetId 同一趟 join 读出来。
      ...(r.entity?.id ? { entityId: r.entity.id } : {}),
    }))
    .filter(hit)
    .slice(0, 5);
  return { matches };
}

export const lookupProductsSkill = defineOttoSkill({
  name: "lookupProducts",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Look up the user's saved products by name, category, tag or description (returns up to 5 full records). $0. " +
    "Your context only shows a summary of the catalog — call this BEFORE naming, pricing or featuring a specific product that isn't already in your context. " +
    "Each match carries entityId — pass it in propose's entityIds when the product doesn't have a reference image yet (so it never showed up as an @-able entity), " +
    "so the generation still conditions on the right product.",
  parameters: params,
  execute: executeLookupProducts,
});
