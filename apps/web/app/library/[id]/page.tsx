import LibraryPage from "../page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Library · Fikirtive" };

/**
 * `/library/<generationId>` —— 一件素材的详情,**一条真地址**(清单 B3 / P1-007;
 * 规格 `docs/specs/frontend-baseline.md` §5 2026-09-05 行)。
 *
 * 改前详情只活在 `?asset=…&project=…` 两个查询参数里。那样的地址贴给别人会带上一个多余的
 * `project`(而归属本来就要由服务端按 id 重新解析)、刷新靠的是查询串、地址里读不出「现在
 * 开着的是哪一件」。已批准的 Library pattern §4 写的是 route-backed side panel:
 * 「Founder 可 deep-link,也可关闭返回原 grid state」—— 这条路径就是那句话缺的那一半。
 *
 * **画的就是 `/library` 那一页**(`../page` 的默认导出,一个普通的 async 函数),
 * 只是把路径段当成它的 `asset` 参数:同一张网格在后、同一个详情面在前,关掉回到
 * `/library`,网格、搜索与筛选原地不动。不复制第二份详情实现 —— 复制的那一天,两条
 * 地址会开始对同一件素材说两套话。
 *
 * 租户:这里一个字都不验 —— `id` 只是一个待验证的定位参数,`/library` 那一页的
 * `requireOwner()` 与详情面自己的 `getGeneration()` 各按当前 principal 解析一次;
 * 别人的 id 得到的是「这件素材不可用」,不是一次跨租户的读。
 */
export default async function LibraryAssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ collection?: string; element?: string; view?: string }>;
}) {
  const { id } = await params;
  const rest = (await searchParams) ?? {};
  return LibraryPage({ searchParams: Promise.resolve({ ...rest, asset: id }) });
}
