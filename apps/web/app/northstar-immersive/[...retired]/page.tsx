/**
 * 旧代号前缀底下的**其余**每一条路 —— 全部送回 `/create`(W2-5,规格书 §2.5)。
 *
 * 这个前缀下曾经还有一批设计稿页(#606 一刀删净,今天直开就是 404)。搬家不该让它们
 * 复活 —— 它们的**文件**一个都没回来,这里只是一条重定向:老书签落到创作面上,而不是撞
 * 一堵墙。这也是「每一条旧地址都 307,永不 404」这条老纪律在这个前缀上的收口。
 *
 * 静态段优先于 catch-all,所以 `/northstar-immersive` 与 `/northstar-immersive/create/canvas`
 * 仍然走它们自己那两条带 query 的重定向,这里接的是别的。
 */

import { redirect } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { withLegacySearch, type LegacySearchParams } from "../legacy-search-params";

export const dynamic = "force-dynamic";

export default async function RetiredCreateSubpath({
  searchParams,
}: {
  searchParams: Promise<LegacySearchParams>;
}) {
  redirect(withLegacySearch(SHELL_ROUTES.create, await searchParams));
}
