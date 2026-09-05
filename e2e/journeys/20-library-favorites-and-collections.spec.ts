/**
 * Journey 20 — 收藏一件作品、把作品归进一个合集,然后把合集删掉,作品还在。
 *
 * 规格:`docs/specs/frontend-baseline.md` §7.3② —— 验收 **FRONT-A5**(收藏来自服务器、
 * 刷新仍在)与 **FRONT-A6**(合集增删改跨刷新成立、删合集不删素材)。
 *
 * 为什么值得一条浏览器旅程,而不是只靠单测:这两条验收的关键词都是「刷新之后还在」。
 * 单测证得了服务端写对了行;证不了商家点的那一颗键真的连到那个写入 —— 一次乐观更新、
 * 一句成功 toast 就能让屏幕说谎,而这正是 Library 契约(`backend-handoff-contract.md`
 * §8.4)明禁的那种假状态。所以这条旅程每一步都**重新加载页面**再看一次。
 *
 * 边界:媒体本身是种出来的(`seedLibraryMedia`)—— 把文件送进库是 journey 13 的题目,
 * 不是这一条的。这一条从「库里已经有东西」开始,只走整理那几步。
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace, seedLibraryMedia } from "../support/seed.js";
import { signIn } from "../support/auth.js";

test("FRONT-A5 / FRONT-A6 — 收藏与合集刷新之后仍然成立,删掉合集素材还在", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "library-organize",
    workspaceName: "Nadia Bakes",
    personName: "Nadia",
    openingGrant: 80,
  });
  await seedLibraryMedia(ws, { prompt: "Raya cookie tin on marble" });
  await seedLibraryMedia(ws, {
    prompt: "",
    source: "UPLOAD",
    filename: "shopfront.png",
  });

  await signIn(page, ws, "/library");

  const generated = page.getByRole("button", { name: "Open Raya cookie tin on marble" });
  const uploaded = page.getByRole("button", { name: "Open shopfront.png" });
  await expect(generated).toBeVisible();
  await expect(uploaded).toBeVisible();

  /* ── FRONT-A5:收藏 ─────────────────────────────────────────────────────── */

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select Raya cookie tin on marble" }).click();
  await page.getByRole("checkbox", { name: "Select shopfront.png" }).click();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Favorite" }).click();

  // 先等这两次写**真的写完**再刷新。批量收藏一件一件发 server action,React 把它们排成
  // 一队;在队还没走完时 reload,导航会把后面那一次掐掉 —— 于是第二件根本没进库,
  // 而屏幕上什么也看不出来。选择条只有在 `await Promise.all(...)` 落地、且**全部成功**
  // 之后才卸掉(LibraryView 的 favoriteSelected:有一件失败就把选择条连同那行小字留住),
  // 所以「2 selected 不见了」正是「两次写都回话了且都成功」的信号。
  await expect(page.getByText("2 selected")).toBeHidden();

  // 「刷新之后还在」才算数 —— 屏幕上消失或出现都可能只是浏览器里的一次乐观更新。
  await page.reload();
  await page.getByRole("tab", { name: "Favorites" }).click();
  await expect(page.getByRole("button", { name: "Open Raya cookie tin on marble" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open shopfront.png" })).toBeVisible();

  await page.goto("/library?view=favorites");
  await expect(page.getByRole("button", { name: "Open Raya cookie tin on marble" })).toBeVisible();

  /* ── FRONT-A6:合集 ─────────────────────────────────────────────────────── */

  await page.goto("/library");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select Raya cookie tin on marble" }).click();
  await page.getByRole("button", { name: "Add to collection" }).click();
  // 一个合集都还没有,所以弹层直接开在「新建」那一步。
  await page.getByLabel("Collection name").fill("Raya launch");
  await page.getByRole("button", { name: "Create collection" }).click();
  // 同一条纪律:「新建合集」是两次连着发的 server action(先建合集,再把这一件加进去)。
  // 弹层只在两次都回话之后才关,所以等它关掉再刷新,别让导航掐掉后面那一次。
  await expect(page.getByLabel("Collection name")).toBeHidden();

  await page.reload();
  await page.getByRole("tab", { name: "Collections" }).click();
  const card = page.getByRole("button", { name: "Open Raya launch" });
  await expect(card).toBeVisible();
  // 数量是服务端数出来的真实成员数,不是界面自己做的加法。
  await expect(card).toContainText("1 item");
  await card.click();
  await expect(page.getByRole("button", { name: "Open Raya cookie tin on marble" })).toBeVisible();

  // 移除一项:合集少一条链接,素材本身一件都没动。
  await page.getByRole("button", { name: "Actions for Raya cookie tin on marble" }).click();
  await page.getByRole("menuitem", { name: "Remove from collection" }).click();
  await expect(page.getByText("This collection is empty")).toBeVisible();

  await page.goto("/library");
  await expect(page.getByRole("button", { name: "Open Raya cookie tin on marble" })).toBeVisible();

  // 删掉整个合集:合集没了,它装过的那件作品仍然在 Library 里。
  await page.getByRole("tab", { name: "Collections" }).click();
  await page.getByRole("button", { name: "Open Raya launch" }).click();
  await page.getByRole("button", { name: "Actions for Raya launch" }).click();
  await page.getByRole("menuitem", { name: "Delete collection" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("No collections yet")).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: "Collections" }).click();
  await expect(page.getByText("No collections yet")).toBeVisible();

  await page.goto("/library");
  await expect(page.getByRole("button", { name: "Open Raya cookie tin on marble" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open shopfront.png" })).toBeVisible();
});
