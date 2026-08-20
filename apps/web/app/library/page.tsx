import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getEntities, getMyAds, getMyAdJobs, getRecentGenerationThumbs } from "@/lib/data";
import { toEntityDTO } from "@/lib/dto";
import { listBrandRecords } from "@/lib/brand-record-actions";
import { OttoStuff } from "@/components/otto/OttoStuff";

export const dynamic = "force-dynamic";
export const metadata = { title: "Library · Fikirtive" };

/**
 * Library —— 真路由(Wave 2 / W2-1,规格书 `docs/specs/wave2-shell.md` §4.3)。
 *
 * 这个文件在这一票之前是一段 redirect shim:`/library` 立刻把商家甩去
 * `/otto?view=library`。后果商家每天都撞得到 —— 站在素材库上刷新一次页面,回来的是聊天壳。
 * 「换壳」的第一个目标(§1.1 G1)就是这句话的反面:**在 Library 上刷新页面,回来还在
 * Library**。所以 shim 撤了,这里变回一个自己有身份的页面。
 *
 * **搬的是位置,不是逻辑**:屏幕上的东西仍然由 `OttoStuff` 画,列表仍然由
 * `buildStuffItems({entities, history, ads, records})` 在它内部组装 —— 这一票一行都没碰。
 * 这里只做一件事:把那四份数据按 `/otto` 页面本来就在用的同一批读取函数取出来交给它。
 * (`/otto` 那一页还在,W2-11 才缩成重定向表;在那之前两条路并存,画的是同一个组件。)
 *
 * 为什么不取 `?project=`:Library 是**跨项目**的 —— 它的那句副标题写着 “across every
 * project”,四个读取函数也全部只按 ownerId 取。要一个项目 id 才是多的。
 *
 * 导轨(MerchantAppShell)这一票**故意还没围过来**:导航权威 `MERCHANT_NAV` 仍然指着
 * `/otto?view=library`,而壳的表面名单是从它派生的(见 `global-navigation.tsx` 的
 * `MERCHANT_SURFACE_PATHS`)。规格书 §6.3 的 Stack A 就是这个形状:新路由先建好、只有输
 * URL 才到得了,导航整棵树在切换总票(W2-11)里一次改完 —— 那一刻这一页自动进名单,
 * 六条新路由谁也不用在壳里手加一行自己的地址。
 */
export default async function LibraryPage() {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { ownerId } = owner;

  // 与 app/otto/page.tsx 完全同一批读取(同样的容错:两个「锦上添花」的读取失败就退回空
  // 列表,不该让整个 Library 打不开)。
  const [entities, ads, adJobs, records, history] = await Promise.all([
    getEntities(ownerId),
    getMyAds(ownerId),
    getMyAdJobs(ownerId).catch(() => [] as Awaited<ReturnType<typeof getMyAdJobs>>),
    listBrandRecords(ownerId),
    getRecentGenerationThumbs(ownerId).catch(() => [] as Awaited<ReturnType<typeof getRecentGenerationThumbs>>),
  ]);

  return (
    // OttoStuff 自己是 `flex-1 overflow-auto`,所以外面给它一个有高度的纵向 flex 容器 ——
    // 与 OttoView 里那一层包装等价,只是这里的高度来自视窗而不是聊天壳。
    <div className="flex min-h-dvh flex-col">
      {/* onOpenThread / onRetryWithOtto 两个 handler 这里**刻意不传**:它们都是「跳进聊天
          里」,而这一页上没有聊天面(Otto 面板是 W2-7)。AdJobCard 现在按 handler 在不在
          决定画不画那两颗键,所以商家在这里看不到一颗按不动的按钮 —— 面板落地时把 handler
          接上,键自己就回来。 */}
      <OttoStuff
        entities={entities.map(toEntityDTO)}
        ads={ads}
        adJobs={adJobs}
        records={records}
        history={history}
      />
    </div>
  );
}
