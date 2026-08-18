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
 * Brand —— 换壳(Wave 2)的 W2-2,规格书 `docs/specs/wave2-shell.md` §4.4。
 *
 * 这一票只做两件事:**取消嵌套**与**说实话**。
 *
 * ① 取消嵌套:今天商家要看自己的品牌资料,得先落在 `/otto` 这个板块里,再从第二条导轨点
 *    「Brand memory」,地址栏一路写着 `/otto?view=memory` —— 刷新一次还在,但那是 Otto 的
 *    地址,不是商家的。这里把同一份内容摆成它自己的一扇门 `/brand`,组件一行没搬家:
 *    `OttoMemory` 背后仍是 `Memory` 与 `BrandRecord` 两张真有读写的表,零 schema 改动、
 *    零迁移、零钱路与租户改动。
 *
 * ② 说实话:那句诚实说明写在 `OttoMemory` 里(§4.4 的原话),因为旧的 `/otto?view=memory`
 *    今天还开着 —— 同一件事不许只在一扇门后面说。
 *
 * **Stack A 纪律**(规格书 §6.3):这一票只**新增**一条路由。`packages/core` 的导航权威
 * 一个字不动,`MERCHANT_NAV` 里还没有 Brand 这一格,所以今天只有直接输地址才到得了这里,
 * 旧壳的行为一点没变。导航指过来是切换总票(W2-11)的事,那一票同时把
 * `/otto?view=memory` 变成 307 到这里。
 *
 * **URL 形状**:agency 多品牌是真实的未来场景,所以门牌是 `/brand` 而不是 `/brand/me` ——
 * 它长得出 `/brand/[brandId]` 而不必改名。代码里**不预埋**任何 brand id 参数(§1.2)。
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Brand · Fikirtive" };

export default async function BrandPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; tab?: string }>;
}) {
  const sp = await searchParams;

  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { ownerId } = owner;

  // 品牌资料本身是 owner-scoped 的(`listMemory` / `listBrandRecords` 都只按 session 的
  // ownerId 查,连调用方传的 id 都不认)。projectId 在这一面只有一个用途:品牌聊天续的是
  // 哪一条会话。所以这里跟 `/otto` 用同一条口径 —— `?project=` 认得(且必须是自己的),
  // 否则落在同一个默认项目上,商家从哪扇门进来续的都是同一条对话。
  const ensured = await getOrCreateDefaultProject();
  if ("error" in ensured) redirect("/login");
  const projects = await getProjects(ownerId);
  const requested = sp?.project ? projects.find((p) => p.id === sp.project) : undefined;
  const projectId = requested?.id ?? projects[0]?.id ?? ensured.id;

  // `?project=` 指向一条不是自己的项目时,**改地址栏**,不静默回落(判官 P3-1)。
  // `/otto` 一直是这么做的(`app/otto/page.tsx` 同一段),两扇门必须是同一个行为:
  // 静默回落会把一个假 id 留在地址栏上,而商家看到的内容其实来自另一个项目 —— 他一刷新、
  // 一分享、一收藏,带走的都是那个假 id,下一次再落在别处。归一之后地址栏说的就是屏幕上的事。
  // `?tab=` 一起带过去:它是这一面自己的状态(哪个页签),纠正项目不该顺手把页签也丢了。
  if (sp?.project && !requested) {
    const corrected = new URLSearchParams();
    corrected.set("project", projectId);
    if (sp.tab) corrected.set("tab", sp.tab);
    redirect(`${SHELL_ROUTES.brand}?${corrected.toString()}`);
  }

  const [memory, records, entities, history, ads] = await Promise.all([
    listMemory(ownerId),
    listBrandRecords(ownerId),
    getEntities(ownerId),
    getRecentGenerationThumbs(ownerId).catch(() => [] as Awaited<ReturnType<typeof getRecentGenerationThumbs>>),
    getMyAds(ownerId).catch(() => [] as Awaited<ReturnType<typeof getMyAds>>),
  ]);

  // 产品图片选择器读的就是 Library 那一份统一清单 —— 组装函数原样复用(`OttoView` 也是拿
  // 它喂这个视图的),不在这里另写一遍「什么算一件素材」。
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
