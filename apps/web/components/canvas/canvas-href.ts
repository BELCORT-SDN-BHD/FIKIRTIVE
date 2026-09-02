/**
 * 一张画布的地址 —— 全仓只写这一处。
 *
 * 为什么单独一个模块:这条地址原来长在 `NorthstarHome.tsx`(一个 `"use client"` 模块)里。
 * `"use client"` 模块的每一个导出在服务端都是**客户端引用**,server component 拿到的不是
 * 函数本体,调不动 —— 所以 Home(W2-6,server component)要画「接着做」的画布链接时,
 * 唯一的选择要么是抄第二份,要么是把这一行搬到一个普通模块里。搬,是这个仓库反复付过学费
 * 的那一课(两个导航、两个日历、两个创作入口)给出的答案。
 *
 * 路径本身仍然只由导航权威源写(`CANVAS_HREF`),这里只负责把 project 挂上去。
 * W2-5 把 `/northstar-immersive/create/canvas` 改名成 `/create/canvas` 时,改的是那个常量,
 * 这里和它的每一个调用点都跟着换,没有第二处要找。
 */
import { CANVAS_HREF } from "@fikirtive/core/navigation";

export function canvasHref(
  projectId: string,
  options: { threadId?: string; handoffId?: string } = {},
): string {
  const query = new URLSearchParams({ project: projectId });
  if (options.threadId) query.set("thread", options.threadId);
  if (options.handoffId) query.set("handoff", options.handoffId);
  return `${CANVAS_HREF}?${query.toString()}`;
}
