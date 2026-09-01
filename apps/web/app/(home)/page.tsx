/**
 * `/` 是 Home,商家的总览(换壳切换总票 W2-11,规格书 §2.3 ①、§4.1)。
 *
 * 这一页原来长在 `/home`(W2-6,Stack A:新旧路由并存,导航还没指过去)。切换是这一票的活:
 * 把它挪到根,`/home` 那个临时地址随之撤下 —— 没有第二处商家能进得去同一个 Home。
 *
 * 路由文件本身不 import auth、DB 或 server action:数据只经 fenced tree 外的受控 Entry 按
 * 认证身份读(与 `app/northstar-immersive/page.tsx` 同一种做法)。
 *
 * **为什么住在 `(home)` 路由组里**:路由组不进地址(这一页仍然就是 `/`),它存在只为把
 * 同目录那份 `loading.tsx` 的 Suspense 边界圈在这一页身上。直接摆在 `app/` 根上时,
 * App Router 会把那份等待态当成**整个 app 的**边界 —— /billing、/create、/login…… 每一条
 * 没有自己 `loading.tsx` 的路由,加载时都会先闪一屏 Home 的骨架(问候 + 开工框 + 画布列),
 * 那正是这份骨架自己的注释在禁止的事:画一个这一页不会有的形状,等于在加载的那一秒说大话。
 * e2e 上它还有第二个可见后果:被这道边界流式送达的页面内容会在文档里留下一份
 * `<div hidden id="S:…">` 副本,同一句文案因此在 DOM 里出现两次。
 */

import { HomeEntry } from "@/components/home/HomeEntry";
import { parseHomeSearchState } from "@/lib/home-marketing-health";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home · Fikirtive" };

/** 等待态由同目录的 `loading.tsx` 提供 —— App Router 自己会拿它当这条路由的 Suspense 边界,
 *  所以这里不再手写第二个 fallback。 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <HomeEntry filters={parseHomeSearchState(await searchParams)} />;
}
