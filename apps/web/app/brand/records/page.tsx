import { redirect } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getOrCreateDefaultProject } from "@/lib/actions";
import { getEntities, getMyAds, getProjects, getRecentGenerationThumbs } from "@/lib/data";
import { toEntityDTO } from "@/lib/dto";
import { listMemory } from "@/lib/memory-actions";
import { listBrandRecords } from "@/lib/brand-record-actions";
import { buildStuffItems } from "@/lib/stuff-items";
import { OttoMemory } from "@/components/otto/OttoMemory";

/**
 * `/brand/records` —— 产品、优惠与客群这三类**结构化记录**的编辑器。
 *
 * ── 这一页为什么存在(过渡件,请 Founder 定去留)──────────────────────────────
 * 换成五节之前,`/brand` 渲染的是 `OttoMemory`,而 `/otto?view=memory` 已经 307 到
 * `/brand`(W2-11)。也就是说 `OttoMemory` 今天是产品 / 优惠 / 客群**唯一**的编辑入口。
 * 五节页面(裁决三)只把这些记录**列出来**并可删除 / 恢复 —— 结构化编辑器不在设计里,
 * 也不在本段写集内(`components/otto/` 是第⑨段的地盘)。
 *
 * 于是只剩两条路:要么把一件商家今天真在用的能力**悄悄删掉**,要么给它留一扇门。
 * 这里选后者。这一页一行组件都没改,只是把同一份实现挂在一个稳定地址上,
 * 让五节页面从 Knowledge base / Audiences 指过来。
 *
 * 它**不是**第二张 Brand home:导航(`MERCHANT_NAV`)里没有它,商家只能从五节页面
 * 的那一行链接进来。设计的归属是「产品由 Library → Elements → Products 管」,
 * 等第②段 Library 把结构化记录接过去,这一页连同那行链接一起删。
 * 规格 docs/specs/frontend-baseline.md §7.3④;去留在 PR 的未决项里请 Founder 裁。
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Products, offers and audiences · Fikirtive" };

export default async function BrandRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; tab?: string }>;
}) {
  const sp = await searchParams;

  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { ownerId } = owner;

  // 与换壳前的 `/brand` 逐行相同的一段:`?project=` 认得(且必须是自己的),
  // 否则落在同一个默认项目上;指向不是自己的项目时**改地址栏**,不静默回落。
  const ensured = await getOrCreateDefaultProject();
  if ("error" in ensured) redirect("/login");
  const projects = await getProjects(ownerId);
  const requested = sp?.project ? projects.find((p) => p.id === sp.project) : undefined;
  const projectId = requested?.id ?? projects[0]?.id ?? ensured.id;

  if (sp?.project && !requested) {
    const corrected = new URLSearchParams();
    corrected.set("project", projectId);
    if (sp.tab) corrected.set("tab", sp.tab);
    redirect(`${SHELL_ROUTES.brand}/records?${corrected.toString()}`);
  }

  const [memory, records, entities, history, ads] = await Promise.all([
    listMemory(ownerId),
    listBrandRecords(ownerId),
    getEntities(ownerId),
    getRecentGenerationThumbs(ownerId).catch(() => [] as Awaited<ReturnType<typeof getRecentGenerationThumbs>>),
    getMyAds(ownerId).catch(() => [] as Awaited<ReturnType<typeof getMyAds>>),
  ]);

  const stuffItems = buildStuffItems({
    entities: entities.map(toEntityDTO),
    history,
    ads,
    records,
  });

  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <OttoMemory
        initialMemory={memory}
        initialRecords={records}
        projectId={projectId}
        stuffItems={stuffItems}
      />
    </main>
  );
}
