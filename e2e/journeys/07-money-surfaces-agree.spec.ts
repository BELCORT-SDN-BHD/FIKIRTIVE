/**
 * Journey 7 — the two places a merchant reads their wallet say the same thing.
 *
 * The balance appears on /billing and on the rail the merchant carries with them on every
 * screen. They are different components reading through different actions; when they drift, the
 * merchant cannot tell which one is lying, and every later conversation about money starts from
 * distrust.
 *
 * 前端基线合并 FRONT-A1 —— 第二处钱面换了地方,断言没有换。换壳之前它是整屏的 Otto 设置面
 * (`/otto?view=account` → components/otto/OttoAccount.tsx)。新壳把 Settings 拆成四面之后,
 * 那一面没有任何路由渲染,余额、持有、花费上限、账号删除四块一起从商家面前消失,而服务端
 * 照旧按上限拒绝动作。修复把它们挂回已批准的落点:余额/持有/上限进 Billing & credits,
 * 删号进 Personal。所以这条旅程今天核的是**账单页 ↔ 导轨**这两处,两个数字断言逐字照旧。
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace, seedOpenHold, seedSettledJob } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { railCredits } from "../support/ui.js";

test("FRONT-A1 · MONEY-A1 — Billing and the rail report the same balance and the same hold", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "parity",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 300,
  });
  await seedSettledJob(ws, { held: 11, kind: "IMAGE" });
  await seedOpenHold(ws, { credits: 22, kind: "VIDEO" });
  // 300 − 11 charged − 22 held = 267 spendable, 22 on hold.

  await signIn(page, ws, "/billing");
  await expect(page.getByText("267").first()).toBeVisible();
  await expect(page.getByText("22 credits held")).toBeVisible();

  // The other wallet surface: the rail's credits row, on the same screen, read through a
  // different action. Same number or the merchant cannot trust either one.
  await expect(railCredits(page)).toContainText("267 credits");

  // The merchant's own spend cap is a money control, not a preference: it now sits beside the
  // balance it limits instead of on a surface nothing renders. Before this it was enforced
  // server-side while being invisible and unreachable — a refusal with no author.
  // This workspace never set one, so the honest state is "No cap set" — never a bare editable 0.
  await expect(page.getByText("No cap set")).toBeVisible();
  await page.getByRole("button", { name: "Set a cap" }).click();
  await expect(page.getByRole("spinbutton", { name: "Spend cap" })).toBeVisible();

  // And it agrees with itself across a reload: the rail keeps saying the same number on any
  // other screen, so the balance is not a story one page tells.
  await page.goto("/settings");
  await expect(railCredits(page)).toContainText("267 credits");
});
