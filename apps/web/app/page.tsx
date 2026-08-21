/**
 * `/` 是 Home,商家的总览(换壳切换总票 W2-11,规格书 §2.3 ①、§4.1)。
 *
 * 这一页原来长在 `/home`(W2-6,Stack A:新旧路由并存,导航还没指过去)。切换是这一票的活:
 * 把它挪到根,`/home` 那个临时地址随之撤下 —— 没有第二处商家能进得去同一个 Home。
 *
 * 路由文件本身不 import auth、DB 或 server action:数据只经 fenced tree 外的受控 Entry 按
 * 认证身份读(与 `app/northstar-immersive/page.tsx` 同一种做法)。
 */

import { HomeEntry } from "@/components/home/HomeEntry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home · Fikirtive" };

/** 等待态由同目录的 `loading.tsx` 提供 —— App Router 自己会拿它当这条路由的 Suspense 边界,
 *  所以这里不再手写第二个 fallback。 */
export default function Page() {
  return <HomeEntry />;
}
