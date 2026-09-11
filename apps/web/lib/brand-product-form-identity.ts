import type { ProductIdentityIntent } from "@/lib/brand-record-actions";

/**
 * Brand 页那张产品表单交上来的**身份意图** —— 表单里有哪一格,这里就交哪一格。
 *
 * 身份(`Entity`)那两格的写路只认显式意图:递了哪一格才写哪一格,没递 = 这一趟不碰
 * (`lib/brand-record-actions.ts` 的 `ProductIdentityIntent`;票 #1322,PRODID-R6)。
 * 所以「表单交什么」必须有唯一一处说了算,不能由每个调用点各自从手里那份 `data` 里猜。
 *
 * 表单只有 Name* / Price / Description / Selling angle / Link / Tags / Category 七格
 * (`components/otto/memory/ProductShowcase.tsx` 的 `ProdForm`),**没有主图那一格**。
 * 主图只从卡片上的「换封面 / 移除封面」走(`OttoMemory.tsx` 的 `prodSetImage`)。
 * 表单手里那份 `data.imageAssetId` 是读路 `withProductIdentity` 补进去的客户端快照
 * (`packages/core/src/brand-records.ts`),不是商家这一次的意思:把它当意图递下去,
 * 另一个标签页(或 Otto 的 `linkProductImage`)刚挑的封面,会被一次「只改价格」静默写回旧值;
 * 无 id 新增撞名递归成 update 时,那个 `null` 更等于显式清掉一张已有的封面。
 * (票 #1322,PRODID-R9)
 */
export function productFormIdentityIntent(data: Record<string, unknown>): ProductIdentityIntent {
  // 只交名字这一格。`imageAssetId` 这个键连出现都不许出现 —— `undefined` 与 `null` 在写路那边
  // 是两个意思:没这个键 = 这一趟不碰封面,`null` = 显式清掉封面。
  return { name: typeof data.name === "string" ? data.name : "" };
}
