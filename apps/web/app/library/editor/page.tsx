import { redirect } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getOrCreateDefaultProject } from "@/lib/actions";
import { getProjects } from "@/lib/data";
import { EditDesk } from "@/components/otto/edit/EditDesk";

export const dynamic = "force-dynamic";
export const metadata = { title: "Video editor · Fikirtive" };

/**
 * 剪辑台 —— 真路由(Wave 2 / W2-1,规格书 §4.3、Q6)。
 *
 * 拼接 / 字幕 / 配乐这套引擎自 #606 起一直在跑,#780 给了它一扇门 —— 但那扇门是
 * `/otto?view=edit`,一个藏在 query 里的视图。所以它有两个后果:地址栏说不出商家在哪,
 * 刷新一次就回聊天壳。这一票把它变成一条自己的路。
 *
 * 为什么它长在 Library 下面而不是自己占一格(规格书 Q6,Founder 已拍板):要剪的东西就在
 * Library 里,两格之间不隔第三样;而导航是七格的骨架,加回一格等于没换壳。
 *
 * **组件原样复用,不搬文件**:`components/otto/edit/EditDesk.tsx` 留在原处,旧壳
 * (`OttoView` 的 `view === "edit"`)照旧画它 —— 两条路,同一个组件,同一个动作层
 * (`lib/edit-desk-actions.ts`,`edit-desk-two-surfaces.test.ts` 钉着这一点)。
 * 旧壳这一票零行为变化,是 Stack A 的纪律(规格书 §6.3)。
 */
export default async function LibraryEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const sp = await searchParams;

  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { ownerId } = owner;

  // 剪辑台是**按项目**的(一个项目一条在剪的视频),所以这一页要一个项目 id。取法与
  // app/otto/page.tsx 一字不差:先保证至少有一个项目,再按 ?project= 挑,挑不中就用最早那个。
  const ensured = await getOrCreateDefaultProject();
  if ("error" in ensured) redirect("/login");
  const projects = await getProjects(ownerId);
  const requested = sp?.project ? projects.find((p) => p.id === sp.project) : undefined;
  const projectId = requested?.id ?? projects[0]?.id ?? ensured.id;
  // 地址里那个项目不是这个商家的(别人的 id、或者已经删掉的),就把地址改回干净的那条,
  // 而不是默默打开另一个项目的剪辑台 —— 屏幕上画的东西必须与地址栏说的是同一件事。
  if (sp?.project && !requested) redirect(SHELL_ROUTES.edit);

  return (
    // EditDesk 自己是 `flex: 1; overflow: auto`,与 Library 同一种包装。
    <div className="flex min-h-dvh flex-col">
      <EditDesk projectId={projectId} />
    </div>
  );
}
