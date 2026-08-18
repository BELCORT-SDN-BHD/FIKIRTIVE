/**
 * Home 的**落位**(换壳规格书 §4.1 / §6.3 Stack A,W2-6)。
 *
 * 为什么在 `/home` 而不是 `/`:`app/page.tsx` 今天是 `redirect("/otto")`,而 Stack A 的
 * 规矩是「新路由与旧路由并存,导航还没指过去,只有输 URL 才到得了」—— 旧壳零行为变化是这一
 * 波的最高原则。所以这一票只把 Home 建起来并让它真的跑得起来(`next build` 也就真的编译
 * 得到它),**一个字都不动 `/`**。
 *
 * 切换归 W2-11(切换总票):它把 `/` 换成这一页,并删掉这个临时地址。在那之前,这里是给
 * Founder 走查用的门 —— 输 `/home` 就看得到真的 Home,不必等整波换壳落地。
 *
 * 路由文件本身不 import auth、DB 或 server action:数据只经 fenced tree 外的受控 Entry 按
 * 认证身份读(与 `app/northstar-immersive/page.tsx` 同一种做法)。
 */

import { Suspense } from "react";
import { HomeEntry } from "@/components/home/HomeEntry";
import HomeLoading from "./loading";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home · Fikirtive" };

export default function Page() {
  return (
    <Suspense fallback={<HomeLoading />}>
      <HomeEntry />
    </Suspense>
  );
}
