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
 *
 * 2026-09-05(接线盘点 L6,规格 `docs/specs/frontend-baseline.md` §5):目标地址再从
 * `SHELL_ROUTES.schedule` 改成 `SHELL_ROUTES.home`,与权威重定向表对齐 ——
 * `MERCHANT_NAV_REDIRECTS` 里 `/campaign/calendar` 那一行逐字写的就是
 * `SHELL_ROUTES.home`(理由栏:Campaigns are parked in the Beta),而那张表的契约是
 * 「每一条 `from` 都必须有一个真的 route 文件把人送到 `to`」。上面那段 W2-11 的理由今天
 * 已经不成立:Schedule 自己也在 Beta parked(`app/schedule/page.tsx` 同样 `redirect` 回
 * Home),把人送去 `/schedule` 只是多一跳。商家侧本来就看不出差别 ——
 * `app/campaign/layout.tsx` 的重定向抢在前面,这一页的 `redirect()` 实际跑不到;改的是
 * 「表说的」与「文件做的」不再是两句话。围栏:`lib/__tests__/route-redirects.test.ts`。
 */
export default async function CampaignCalendarRoute() {
  redirect(SHELL_ROUTES.home);
}
