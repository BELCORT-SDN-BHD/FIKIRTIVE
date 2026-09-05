import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getProjects } from "@/lib/data";
import { getGenerationHistory } from "@/lib/library-actions";
import { getLibraryElements } from "@/lib/library-elements";
import { parseLibraryElementView } from "@/lib/library-elements-model";
import { parseLibraryView } from "@/lib/library-view-model";
import { LibraryView } from "@/components/library/LibraryView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Library · Fikirtive" };

/**
 * Library —— 商家找回、整理与重用自己作品的那一面(前端基线规格
 * `docs/specs/frontend-baseline.md` §7.1 段②「对齐轮」)。
 *
 * 这一票之前,这条路由画的是聊天壳时代的 `OttoStuff`(元素、素材、品牌记录、失败任务
 * 混在一张列表里)。Founder 2026-09-03 的令是「生产界面必须与已批准的前端基线一模一样」,
 * 所以屏幕上的东西改由 `components/library/LibraryView` 按已批准的 Library pattern 画
 * (`design-system/patterns/library/`)。
 *
 * 生成历史与上传都来自同一张 `Generation` 表(`Generation.source` 区分两者),Elements
 * 来自 `Entity`(含 `catalogKey` 标出来的演员库)。Favorites 与 Collections 由段②第②③刀
 * 建起来的三张表供数据(`Favorite` / `Collection` / `CollectionItem`);它们各有自己的
 * 读模型与游标,所以不在这里预取 —— 切到那一格再向服务器要第一页。
 *
 * 首屏那一页在服务端取好,后续的搜索、筛选、排序与「加载更多」由客户端再向同一个
 * owner-gated server action 要 —— 一切筛选都作用在完整结果集上,不在浏览器里过滤已加载的
 * 那几条(`patterns/library/backend-handoff-contract.md` §8.3①)。
 *
 * 租户:`requireOwner()` 一处守门,三个读取各自再按服务端 principal 收口;这一页不接受、
 * 也不转发任何客户端传来的 `ownerId`。
 */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams?: Promise<{
    asset?: string;
    collection?: string;
    element?: string;
    project?: string;
    view?: string;
  }>;
}) {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { ownerId } = owner;

  const { asset, collection, element, project, view } = (await searchParams) ?? {};
  const initialView = parseLibraryView(view);
  const initialElementView = parseLibraryElementView(element);

  const [page, projects, elements] = await Promise.all([
    getGenerationHistory({
      take: 40,
      // Uploads 页签就是一次来源约束,和客户端后续发的那一次同一个口径。
      sources: initialView === "uploads" ? ["upload"] : undefined,
    }),
    // 「Source Canvas」筛选的选项表 —— 名字是商家自己给画布起的,不是我们编的。
    getProjects(ownerId).catch(() => [] as Awaited<ReturnType<typeof getProjects>>),
    getLibraryElements(),
  ]);

  return (
    <LibraryView
      initialView={initialView}
      initialElementView={initialElementView}
      initialPage={"error" in page ? page : { items: page.items, nextCursor: page.nextCursor }}
      projects={projects.map((row) => ({ id: row.id, name: row.name }))}
      // 这个 `[]` 不是「读挂了就画成空库」:`getLibraryElements()` 唯一的 `{ error }` 出口
      // 就是它自己那句 `requireOwner()`,而本页第 38-39 行已经先过了同一道门并 redirect 掉了
      // ——所以走到这里时这一支不可达,`[]` 只是让类型收窄,不是一次沉默的降级。
      elements={"error" in elements ? [] : elements}
      // 深链:两个 id 都只是**待验证的定位参数**,详情面自己按当前 principal 再解析一次
      // (§8.3③:目标被删除或不可访问时说不可用,而不是画成空库)。
      initialAsset={asset && project ? { generationId: asset, projectId: project } : undefined}
      initialCollectionId={collection}
    />
  );
}
