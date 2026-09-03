import { redirect } from "next/navigation";
import { isBrandSectionKey, type BrandSectionKey } from "@fikirtive/core";
import { requireOwner } from "@/lib/auth-guard";
import { loadBrandSections } from "@/lib/brand-context-data";
import { BrandWorkspace } from "./BrandWorkspace";

/**
 * Brand —— 五节品牌上下文(FRONT-A8 / FRONT-A9;规格 `docs/specs/frontend-baseline.md`
 * §7.3④,Founder 2026-09-03 裁决三 / 四 / 十一)。
 *
 * ── 这一面从「六节旧壳」换成「五节设计」的两件事 ───────────────────────────────
 * ① **分节**:生产存的仍是 2026-07-02 批的六节,商家看到的是设计的五节
 *    (Brand voice / Audiences / Knowledge base / Style guide / Visual guidelines)。
 *    六→五的对应由裁决三＋十一定死,**在读的时候算**(`@fikirtive/core` 的
 *    `brandSectionForCategory`),`Memory.category` 的存量值一个字节都没改 ——
 *    所以 Otto 读到的品牌上下文与换壳前逐字相同(测试逐字断言,不是靠相信)。
 * ② **草稿流**:加来源 → 抽取 → 生成草稿 → 预览效果 → 确认保存。商家按下 Save 之前,
 *    库里最多只有一条 `contextStatus='Draft'` 的行,而 Otto 的读路径写死了只取 `Ready`。
 *
 * 路由形状沿用旧壳:`?section=` 决定看哪一节(可刷新、可分享、可收藏);
 * `/brand/[brandId]` 是 agency 多品牌的未来形状,今天不预埋任何 brand id 参数。
 *
 * 旧壳的 `/otto?view=memory` 一个字没动 —— 那一面是 Otto 引擎自己的门,不在本段写集内。
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Brand · Fikirtive" };

export default async function BrandPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const sp = await searchParams;

  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  const sections = await loadBrandSections(owner.ownerId);
  const initialSection: BrandSectionKey = isBrandSectionKey(sp?.section) ? sp.section : "brand-voice";

  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <BrandWorkspace sections={sections} initialSection={initialSection} />
    </main>
  );
}
