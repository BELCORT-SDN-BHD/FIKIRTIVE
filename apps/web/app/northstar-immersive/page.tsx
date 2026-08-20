/**
 * 旧创作面地址 —— 只剩一条重定向(W2-5,规格书 `docs/specs/wave2-shell.md` §2.2)。
 *
 * `northstar-immersive` 是内部代号。它出现在商家的地址栏里,本身就是一处「说的与做的不
 * 一致」,所以这一面搬去了 `/create`。搬家不许让任何一个旧书签撞墙:§2.5 的老纪律是
 * **每一条旧地址都 307,永不 404**。
 *
 * 为什么是 307 而不是 308:308 会被浏览器永久缓存,谁点过一次,以后就再也改不动他那一台
 * 机器上的这条路。地址的权威在 `SHELL_ROUTES`,不在别人的缓存里。
 *
 * 判官 P3-5:这一条也带 query 过去,和另外两条兄弟路由同一个形状。今天这一页没有哪个参数是
 * 它自己读的,所以「裸 redirect」当下不丢东西 —— 但三条重定向里两条保参、一条不保,就是一个
 * 迟早有人踩的差别:`/create` 明天长出第一个参数(锚点、来路、预填)的那一刻,丢参的是这一条,
 * 而没有任何东西会提醒他。形状一致比省一行重要。
 */

import { redirect } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { withLegacySearch, type LegacySearchParams } from "./legacy-search-params";

export const dynamic = "force-dynamic";

export default async function RetiredCreateHome({
  searchParams,
}: {
  searchParams: Promise<LegacySearchParams>;
}) {
  redirect(withLegacySearch(SHELL_ROUTES.create, await searchParams));
}
