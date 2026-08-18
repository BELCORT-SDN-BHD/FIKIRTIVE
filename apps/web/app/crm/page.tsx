import { redirect } from "next/navigation";

/**
 * CRM 整段收起来了(W2-13 / #993,Founder 裁决 2026-08-18 裁决2)。
 *
 * 导航里已经没有 Customers 那一格(见 packages/core/src/navigation.ts 文件头 ④):
 * 一个消息渠道都连不上,那扇门后面发不出也收不到消息,再诚实的预览门也仍然是一扇通向
 * 空房间的门。所以整段从商家看得见的表面消失。
 *
 * **文件保留、内容换成重定向,不 404**:测试账号的书签里还有 /crm 这一串地址,撞墙会让
 * 商家以为自己的东西丢了。CRM 引擎(4600 行)与 packages/otto 的 CRM 技能一行没删,页面
 * 组件也都在 components/crm/ 原地放着。
 *
 * **恢复触发条件 = Meta verification 通过**,登记在延期台账 issue #359。接回来那天要做的
 * 是两件事:把 navigation.ts 那一格加回去,并把这 14 个路由文件的取数逻辑从 git 历史里
 * 取回(它们随本票删掉了 —— 重定向页不取数)。
 */
export default async function CrmRoute() {
  redirect("/");
}
