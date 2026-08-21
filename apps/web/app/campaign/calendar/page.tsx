import { redirect } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";

/**
 * 两个日历择一为准(#801)。
 *
 * 权威是**排期日历**(`SHELL_ROUTES.schedule`):它背后有真表(ScheduledPost)、真状态机、
 * 真审批,worker 照它把东西发出去。这一页从来不是那件事 —— 它只是把各战役计划条目的日期与
 * hook 摊平重编辑一遍,而那两个字段战役自己那一页早就能改(见 campaign-detail-page 的
 * Plan entries:改日期、改 hook、批准、撤批、删除,一样不少)。
 *
 * 留着两本日历,商家就得猜哪本算数;所以这一页收敛成重定向,不 404。计划日期去战役页改,
 * 真要发出去的东西只有排期这一本。
 *
 * W2-11:目标地址从 `/otto?view=schedule` 改成 `SHELL_ROUTES.schedule`(`/schedule`)——
 * `/otto` 换壳后是一张纯重定向表,不再是排期日历的真住址。
 */
export default async function CampaignCalendarRoute() {
  redirect(SHELL_ROUTES.schedule);
}
