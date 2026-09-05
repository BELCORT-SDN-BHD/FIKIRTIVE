/**
 * SAVE_FAILED —— 「请求根本没拿到回答」时,这个产品对商家说的那一句,全仓只有这一份。
 *
 * 为什么要有这个文件(7.3 单一源)。这句话原本是**八份互相抄写的字面量**:画布
 * (`components/canvas/FlowCanvas.tsx`)、排程卡(`components/otto/OttoSchedule.tsx`)、
 * 记忆/排程/品牌三处服务器动作(`lib/memory-actions.ts` 两处、`lib/schedule-actions.ts`、
 * `lib/brand-record-actions.ts`)与排程服务层(`lib/schedule-service.ts`)。判官 #1197 P2-3 把
 * 画布那一份记成「第 7 份」并要求收口:抄件之间只会越漂越远,而商家读到的是同一个产品在
 * 同一种失败下说了两种话。
 *
 * 这句话说什么、不说什么。它**只**用于「动作抛了,连服务端的一句话都没拿到」那一档 ——
 * 服务端真的答了话(`Not authorized.` / `Node not found.` / `Project not found.`)就照读原话,
 * 那是更准的信息。它也不承诺「没扣钱」:这一档根本不知道服务端有没有落地,所以不写
 * 「You weren't charged.」(那是终局卡 `lib/canvas-terminal-copy.ts` 才敢说的话,因为
 * worker 真的退过款)。
 *
 * 叶子模块:不 import next/、不 import server-only、不 import prisma —— 两侧的调用者一半是
 * `"use server"` 动作、一半是 `"use client"` 组件,只有叶子才能被两边同时引用而不把服务端
 * 运行时拖进浏览器包或测试进程。
 *
 * 变体不在这里:`Couldn't save that draft — please try again.`(草稿)与
 * `Couldn't save that contact — please try again.`(联系人)是另外两句话,各自说的是另一样
 * 东西被拒了,不是这一句的抄件。
 */
export const SAVE_FAILED = "Couldn't save that — please try again.";
