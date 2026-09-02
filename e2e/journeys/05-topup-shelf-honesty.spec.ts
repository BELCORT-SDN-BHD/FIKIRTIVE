/**
 * Journey 5 — an empty top-up shelf is never a full stop.
 *
 * This suite has no payment credential by design, so nothing is on sale here. That is the state
 * #687 is about: a merchant on this page has ALREADY decided to pay, so "there is nothing here"
 * cannot be the last thing the product says to them — the sentence has to come with a way to
 * reach a person.
 *
 * It is also the browser-level proof that opening Billing contacts no payment provider. With no
 * key present, a page that had reached for one would be an error, not this sentence — and the
 * balance beside it would have gone down with it.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace } from "../support/seed.js";
import { signIn } from "../support/auth.js";

test("An empty shelf says so and still offers a way through", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "shelf",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 60,
  });

  await signIn(page, ws, "/billing");

  await expect(page.getByRole("heading", { name: "Top up" })).toBeVisible();
  await expect(page.getByText("No credit packs are available right now.")).toBeVisible();
  const exit = page.getByRole("link", { name: "Email support" });
  await expect(exit).toBeVisible();
  await expect(exit).toHaveAttribute("href", /^mailto:.*subject=I%20want%20to%20buy%20credits$/);

  // The balance is still readable — one empty read must not take the rest of the page with it.
  await expect(page.getByText("Available balance")).toBeVisible();
  await expect(page.getByText("60").first()).toBeVisible();
  // 前端基线① 判官登记(#1139):这一行原本钉的是旧壳的 "Could not load balance. Please
  // refresh." —— 换壳之后那句话在仓里一个字都不剩,于是这条负向断言**永远绿**,余额真的
  // 读失败它也不会红。改钉新壳自己的失败文案。标题("Balance unavailable")是余额那张卡
  // 独有的;描述("Refresh to try reading it again.")花费历史那张卡也在用,所以只在余额那
  // 张 alert 的范围内断言 —— 不把另一块面板的状态混进这条旅程。
  const balanceFailure = page.getByRole("alert").filter({ hasText: "Balance unavailable" });
  await expect(balanceFailure).toHaveCount(0);
  await expect(balanceFailure.getByText("Refresh to try reading it again.")).toHaveCount(0);
});
