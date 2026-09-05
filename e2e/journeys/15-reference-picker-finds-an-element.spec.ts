/**
 * Journey 15 — a merchant types `@` in Otto and finds the exact thing they mean (FRONT-A10).
 *
 * WHAT THIS CLOSES. Until this slice the `@` menu was a name-only list filtered in the browser out
 * of whatever entity array the page happened to have already loaded, and there were two of them —
 * one in the Tiptap canvas editor, one in the Otto composers. Nothing about that is visible to a
 * unit test of either half: the question this journey asks is whether a real signed-in browser,
 * with a real workspace, gets rows out of the SERVER for the objects that workspace actually owns,
 * and can pick one with the keyboard alone.
 *
 * WHY THE KEYBOARD PATH IS THE ASSERTION. A reference picker that only answers to the mouse is a
 * picker a merchant fights: the caret is already in the composer, and moving to the mouse to pick
 * a name they are halfway through typing is the whole reason the menu exists. Arrow + Enter is
 * therefore what this presses, not a click.
 *
 * COSTS NOTHING BEYOND THE CANVAS ITSELF. The journey stops before Send — it proves the reference
 * lands in the draft, not that a generation ran. The only metered step is the canvas's own first
 * turn, which journey 12 already characterises as a hold, never a spend.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace, seedElement, seedElementVariant } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { waitUntilInteractive } from "../support/ui.js";

test("FRONT-A10 — @ in Otto finds this workspace's own element and the keyboard picks it", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "refpick",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 75,
  });
  // A product only THIS workspace owns — the row the menu must find, and the name is distinctive
  // so a match cannot be a coincidence of seed data.
  const elementName = "Pandan kopi gift set";
  const element = await seedElement(ws, elementName);
  // One named variant WITH a picture — the row only the canvas editor can offer (a shot prompt's
  // chip binds a variant for conditioning; a chat turn has no column for one). A variant without
  // an image is never mentionable, so the fixture seeds a real asset behind it.
  const variantName = "Raya edition";
  await seedElementVariant(ws, element.entityId, { name: variantName, handle: "raya" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ws, "/");

  // The one production entry into a canvas, walked rather than deep-linked (journey 12).
  await page.getByRole("link", { name: "Create something new" }).click();
  await expect(page).toHaveURL(/\/create$/);
  // 这两个无障碍名跟着旅程 12／14 走(`StartSomething.tsx` 的 `Otto creation prompt` 与
  // `Send prompt`)。这一条旅程写在主干把它们改名之前,合主干时按现名对齐——只动定位器,
  // 这一步要证明的事一个字没改。
  const brief = page.getByRole("textbox", { name: "Otto creation prompt" });
  await waitUntilInteractive(brief);
  await brief.fill("A poster for our weekend kopi set");
  const start = page.getByRole("button", { name: "Send prompt" });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page).toHaveURL(/\/create\/canvas\?project=/);

  const composer = page.getByRole("textbox", { name: "Reply to Otto" });
  await waitUntilInteractive(composer);
  // the canvas's own first turn is in flight on arrival and disables the composer while it runs
  await expect(composer).toBeEnabled({ timeout: 30_000 });

  // Typing `@` alone opens the menu — bare `@` is Recent plus the type entries, not a full library
  // dump (reference-picker-contract.md §2).
  await composer.click();
  await composer.pressSequentially("@");
  const menu = page.getByRole("listbox", { name: "References" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("option", { name: /Products/ })).toBeVisible();

  // Typing the name reaches the server: the seeded product is a row, with the one-line source the
  // contract's row anatomy asks for (§3).
  await composer.pressSequentially("Pandan");
  const row = menu.getByRole("option", { name: new RegExp(elementName) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Product · Otto IQ");

  // Keyboard only, from here to the token.
  await composer.press("ArrowDown");
  await composer.press("Enter");
  await expect(composer).toHaveValue(new RegExp(`@${elementName}`));
  await expect(menu).toBeHidden();

  // The draft is still the merchant's — picking a reference did not send anything.
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();

  // ── 画布那一半:同一个菜单,不是第二套 ──────────────────────────────────────────
  // 收口前画布的提示词编辑器有自己的一版弹层(一颗色点 + 一个 badge,没有缩略图也没有来源行)。
  // 这一段证明它现在开的是**同一个** `References` listbox,并且带上了 Otto 输入框拿不到的那一行:
  // 元素的具名 variant。没有这几行,画布那一半只有源码子串围栏在盯(overlay-design-system 那份),
  // 而「两处渲染同一个组件」这句话,只有真浏览器能证。
  // ENGINE-A3(otto-engine.md §7.2⑦):这一半从前开的是工具条 `Generate image` 掀出来的直出
  // composer。那条路已退役(画布只留 Otto 对话那一个输入),板上仍然带着同一个 `MentionInput`
  // 的地方是出片确认框 —— 换的是哪一扇门,要证的事(两处开的是同一个 References 菜单、
  // 画布这一半多出具名 variant 那一行)一个字没改。
  await page.getByRole("toolbar", { name: "Canvas tools" })
    .getByRole("button", { name: "Video", exact: true })
    .click();
  const shotPrompt = page.locator('[role="dialog"] .mention-input [contenteditable="true"]');
  await expect(shotPrompt).toBeVisible();
  await shotPrompt.click();
  await shotPrompt.pressSequentially("@Pandan");

  const canvasMenu = page.getByRole("listbox", { name: "References" });
  await expect(canvasMenu).toBeVisible();
  await expect(canvasMenu.getByRole("option", { name: new RegExp(elementName) }).first()).toBeVisible();
  // The variant row: the entity's name, the variant's own source line, and the trailing tag.
  const variantRow = canvasMenu.getByRole("option", { name: new RegExp(variantName) });
  await expect(variantRow).toBeVisible();
  await expect(variantRow).toContainText("Variant");
});
