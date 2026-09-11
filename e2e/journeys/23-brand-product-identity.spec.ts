/**
 * Journey 23 —— 一件产品从 Brand 页出生之后,Library、@ 菜单与出片确认卡认的是**同一个 id**
 * (规格 `docs/specs/brand-product-identity.md` §0;验收 PRODID-A1 / A2 / A4 / A6;票 #1323)。
 *
 * 为什么要一条真浏览器的旅程。这条规格的整句话是「一处建,处处可用」,而「处处」跨了四个面:
 * Brand 页的产品表单、Library 的 Elements、画布 Otto 输入框的 @ 菜单、出片确认卡里的芯片。
 * 单元测试逐条证过每一面读的是 `Entity`,但没有任何一条证得了**四面同时**指着同一行 ——
 * 那正是这条规格出事的形状:某一面读的是价签自己那份缓存,屏幕上看起来一样,id 已经分了家。
 *
 * 谱系那一格断言的是芯片的 `data-id`,不是名字。名字看起来一样是这条规格最容易通过的假绿;
 * 只有 id 说得出「是不是同一件东西」。
 *
 * 不花钱:旅程停在确认卡的芯片上,一次都没有按下生成。画布自己的第一轮对话是旅程 12 已经
 * 定性过的 hold(不是花费),这里照旧只等它把输入框放开。
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { prisma } from "../support/db.js";
import { waitUntilInteractive } from "../support/ui.js";

test("PRODID-A1 / PRODID-A2 / PRODID-A4 / PRODID-A6 Brand 页建的产品,Library、@ 菜单与确认卡是同一个 id;改名同步、删除两边一起消失", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "prodid",
    workspaceName: "Suria Kopitiam",
    personName: "Suria",
    openingGrant: 120,
  });

  // 名字刻意独特:菜单里命中它不可能是种子数据的巧合。
  const name = "Pandan kaya toast set";
  const renamed = "Pandan kaya toast set (large)";

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ws, "/brand/records?tab=products");

  // ── PRODID-A1 在 Brand 页新增产品 ────────────────────────────────────────────
  await page.getByRole("button", { name: "Add product" }).first().click();
  // 这张表单的 `FieldLabel` 没有绑到输入框上(它不是 `<label for>`),所以定位走 placeholder ——
  // 那是这两个控件今天真的对外可见的名字。旅程不替产品修 a11y,只如实按屏幕上的样子驱动它。
  await page.getByPlaceholder("Latte Blend").fill(name);
  await page.getByPlaceholder("RM 49").fill("RM 12.90");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // 卡片标题不是 heading(`CardTitle` 是 div),所以拿那颗每张卡都有、名字逐字在里面的
  // 操作键当锚点 —— 它同时证明这张卡真的画出来了。
  await expect(page.getByRole("button", { name: `Actions for ${name}` })).toBeVisible({ timeout: 60_000 });

  // 身份就是 Library 那张卡:价签的 `entityId` 与 `Entity` 的 id 是同一个值,
  // 而且名字与主图只住在身份那一行(价签的 data 里连这两个键都没有)。
  const record = await prisma.brandRecord.findFirstOrThrow({
    where: { ownerId: ws.orgId, kind: "product", deletedAt: null },
    select: { id: true, entityId: true, data: true },
  });
  expect(record.entityId).toBeTruthy();
  const entityId = record.entityId!;
  expect(Object.keys(record.data as Record<string, unknown>)).not.toContain("name");
  expect(Object.keys(record.data as Record<string, unknown>)).not.toContain("imageAssetId");
  await expect(
    prisma.entity.findFirstOrThrow({
      where: { id: entityId, ownerId: ws.orgId }, select: { name: true, type: true },
    }),
  ).resolves.toEqual({ name, type: "PRODUCT" });

  // ── PRODID-A1 Library Products 出现同一张卡 ──────────────────────────────────
  await page.goto("/library?view=elements&element=products");
  await expect(page.getByRole("button", { name: `Open ${name}` })).toBeVisible({ timeout: 60_000 });
  // 只有一张卡 —— 「Library 一份、Brand 页一份」这条老路会在这里现形。
  await expect(page.getByRole("button", { name: `Open ${name}` })).toHaveCount(1);

  // ── PRODID-A2 画布 @ 菜单认得它,来源标签是「Product」 ───────────────────────
  await page.goto("/");
  await page.getByRole("link", { name: "Create something new" }).click();
  await expect(page).toHaveURL(/\/create$/);
  const brief = page.getByRole("textbox", { name: "Otto creation prompt" });
  await waitUntilInteractive(brief);
  await brief.fill("A breakfast poster for the weekend");
  const start = page.getByRole("button", { name: "Send prompt" });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page).toHaveURL(/\/create\/canvas\?project=/);

  const composer = page.getByRole("textbox", { name: "Reply to Otto" });
  await waitUntilInteractive(composer);
  await expect(composer).toBeEnabled({ timeout: 30_000 });
  await composer.click();
  await composer.pressSequentially("@Pandan");
  const menu = page.getByRole("listbox", { name: "References" });
  await expect(menu).toBeVisible();
  const row = menu.getByRole("option", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Product");
  await expect(row).not.toContainText("Otto IQ");
  await composer.press("ArrowDown");
  await composer.press("Enter");
  await expect(composer).toHaveValue(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  // ── PRODID-A2 确认卡的芯片指向同一个 Entity id ──────────────────────────────
  // 谱系的起点就是这颗芯片:`resolveDoc` 把它的 id 原样交给生成,快照里那个 id 就是它。
  await page.getByRole("toolbar", { name: "Canvas tools" })
    .getByRole("button", { name: "Video", exact: true })
    .click();
  const shotPrompt = page.locator('[role="dialog"] .mention-input [contenteditable="true"]');
  await expect(shotPrompt).toBeVisible();
  await shotPrompt.click();
  await shotPrompt.pressSequentially("@Pandan");
  const canvasMenu = page.getByRole("listbox", { name: "References" });
  await expect(canvasMenu).toBeVisible();
  await expect(canvasMenu.getByRole("option", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first()).toBeVisible();
  await shotPrompt.press("ArrowDown");
  await shotPrompt.press("Enter");
  const chip = page.locator('[role="dialog"] .mention-input .mention').first();
  await expect(chip).toBeVisible();
  // 这一句是整条旅程的核心:确认卡里那颗芯片认的 id,逐字等于 Brand 页那条价签的 `entityId`。
  await expect(chip).toHaveAttribute("data-id", entityId);

  // ── PRODID-A4 在 Brand 页改名,Library 那一边跟着改(同一行 Entity) ──────────
  await page.goto("/brand/records?tab=products");
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByPlaceholder("Latte Blend").fill(renamed);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: `Actions for ${renamed}` })).toBeVisible({ timeout: 60_000 });

  await page.goto("/library?view=elements&element=products");
  await expect(page.getByRole("button", { name: `Open ${renamed}` })).toBeVisible({ timeout: 60_000 });
  // 没有第二份名字:旧名字那张卡不在了,而且身份还是同一行。
  await expect(page.getByRole("button", { name: `Open ${name}`, exact: true })).toHaveCount(0);
  await expect(
    prisma.brandRecord.findFirstOrThrow({
      where: { id: record.id, ownerId: ws.orgId }, select: { entityId: true },
    }),
  ).resolves.toEqual({ entityId });

  // ── PRODID-A6 在 Library 删掉它:Brand 页那一边同时消失 ──────────────────────
  await page.getByRole("button", { name: `Open ${renamed}` }).click();
  await page.getByRole("button", { name: "Remove from Library" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("button", { name: `Open ${renamed}` })).toHaveCount(0, { timeout: 60_000 });

  await page.goto("/brand/records?tab=products");
  await expect(page.getByRole("button", { name: `Actions for ${renamed}` })).toHaveCount(0);
  // 两边同一个 `deletedAt` —— 恢复那一半按它把两行一起接回来(动作层 `restoreBrandRecord`)。
  const dead = await prisma.brandRecord.findFirstOrThrow({
    where: { id: record.id, ownerId: ws.orgId }, select: { deletedAt: true },
  });
  expect(dead.deletedAt).not.toBeNull();
  await expect(
    prisma.entity.findFirstOrThrow({
      where: { id: entityId, ownerId: ws.orgId }, select: { deletedAt: true },
    }),
  ).resolves.toEqual({ deletedAt: dead.deletedAt });
});
