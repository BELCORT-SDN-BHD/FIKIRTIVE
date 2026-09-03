/**
 * Journey 15 — FRONT-A8 / FRONT-A9:商家在 Brand 五个分区写下品牌事实,而在他按下
 * Save 之前,那句话既不在正式记录里,也不在 Otto 读到的上下文里。
 *
 * 规格 docs/specs/frontend-baseline.md §7.3④(Founder 2026-09-03 裁决三 / 四 / 十一)。
 *
 * 这一趟走的是真界面上的整条链:加来源 → 抽取 → 生成草稿 → 预览效果 → 确认保存,
 * 然后删除、恢复。断言压在**商家看得见的东西**上(状态字样、预览两栏、列表里的名字),
 * 因为草稿泄漏与租户泄漏都是在这里以「别人的话出现在我的屏幕上」的样子现形的。
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace } from "../support/seed.js";
import { signIn } from "../support/auth.js";

test("FRONT-A8 / FRONT-A9 商家在五个分区写品牌事实,确认之前不落正式记录", async ({ page }) => {
  const nadia = await seedWorkspace({
    slug: "brand-a",
    workspaceName: "Nadia Bakery",
    personName: "Nadia",
    openingGrant: 200,
  });

  await signIn(page, nadia, "/brand");

  // 默认落在 Brand voice,没有 Brand overview / dashboard(设计 §7 验收 1)。
  await expect(page.getByRole("heading", { name: "Brand voice", level: 1 })).toBeVisible();
  for (const section of ["Brand voice", "Audiences", "Knowledge base", "Style guide", "Visual guidelines"]) {
    await expect(page.getByRole("tab", { name: section })).toBeVisible();
  }

  // ① 加来源 ＋ ② 抽取 ＋ ③ 生成草稿 —— 一个对话框走完前三步。
  await page.getByRole("button", { name: "Add brand voice" }).first().click();
  await page.getByLabel("Name").fill("Kampung warmth");
  await page.getByLabel("Source text").fill("We speak like a neighbour, never like a brochure.");
  await page.getByRole("button", { name: "Review draft" }).click();

  // 草稿就是草稿:它带着 Draft 的字样,而不是冒充成已保存。
  //
  // 这一步给的时间比别处长:「Review draft」一下按出去的是**三个**服务端动作
  // (加来源 → 抽取 → 生成草稿),再加一次服务端重取列表。三步分开是裁决四的要求
  // (前两步一个字节都不写库),所以这里的四趟往返是设计的一部分,不是慢在实现上;
  // CI runner 慢的那一趟实测跑到 17.9s,默认的 15s 会在链还没走完时判死。
  await expect(page.getByRole("heading", { name: "Kampung warmth", level: 2 })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

  // ④ 预览效果 —— 摆的是保存前后 Otto 真读到的两段,免费、不调模型。
  await page.getByRole("button", { name: "Preview effect" }).click();
  await expect(page.getByRole("heading", { name: "Preview effect" })).toBeVisible();
  await expect(page.getByText("Without context")).toBeVisible();
  await expect(page.getByText("With context")).toBeVisible();
  // 弹层右上角的图标按钮也叫 Close(design-system 的 Dialog 自带),所以要点的是页脚那一个。
  await page.getByRole("button", { name: "Close" }).first().click();

  // ⑤ 确认保存 —— 到这一刻它才成为正式记录。
  await page.getByRole("button", { name: "Save context" }).click();
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible({ timeout: 60000 });

  // FRONT-A8:刷新仍在,而且答得出「谁改的、何时改的」。
  await page.reload();
  await expect(page.getByRole("heading", { name: "Kampung warmth", level: 2 })).toBeVisible();
  await expect(page.getByText(/Updated by Nadia/)).toBeVisible();

  // 分区之间是 route-backed 的:换一节、刷新,还在那一节。
  await page.getByRole("tab", { name: "Knowledge base" }).click();
  await expect(page.getByRole("heading", { name: "Knowledge base", level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Knowledge base", level: 1 })).toBeVisible();

  // FRONT-A8:删除可以恢复,恢复之后内容完整。
  await page.getByRole("tab", { name: "Brand voice" }).click();
  await page.getByRole("button", { name: "Remove this context" }).click();
  // 「Removed. You can restore it from the list.」那句 toast 也含 Removed —— 要的是列表底部
  // 那个分区标题,所以 exact。
  await expect(page.getByText("Removed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("heading", { name: "Kampung warmth", level: 2 })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("We speak like a neighbour, never like a brochure.")).toBeVisible();
});
