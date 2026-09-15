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
import { waitUntilInteractive } from "../support/ui.js";

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

/**
 * R3-F05(round-3 staging 走查,build 14bcd038)—— 详情面关掉之后,键盘焦点回到打开它的那张卡。
 *
 * 病象:在 Generation history 用键盘 Tab 到一张素材卡、Enter 打开 Asset details、Escape 关掉,
 * 焦点落回 `<body>`。对只用键盘或读屏的商家,这一下等于被丢回页面最顶上 —— 想看下一件就得
 * 从头再 Tab 一遍整条导航、页签与工具条。
 *
 * 为什么必须是浏览器旅程:`document.activeElement` 是浏览器的状态,不是组件的 state。单测能
 * 证「我们调了 focus()」,证不了「关掉那一刻没有别人把焦点抢走」—— 面板自己的焦点管理器、
 * 网格重取时的卸载与重挂,只在真浏览器里同时发生。
 *
 * 上游:已批准的 Library pattern §4(关闭后回到原 grid state)与前端接线交接规范 §5
 * (逐条验证点击、键盘、**焦点**、关闭/返回)。
 */
test("R3-F05 — Escape 关掉素材详情之后,键盘焦点回到原来那张卡", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "library-focus",
    workspaceName: "Suri Studio",
    personName: "Suri",
    openingGrant: 80,
  });
  await seedLibraryMedia(ws, { prompt: "Nasi lemak tray at noon" });
  await seedLibraryMedia(ws, { prompt: "Teh tarik pour in slow motion" });

  await signIn(page, ws, "/library");

  const card = page.getByRole("button", { name: "Open Nasi lemak tray at noon" });
  const neighbour = page.getByRole("button", { name: "Open Teh tarik pour in slow motion" });
  await expect(card).toBeVisible();
  await waitUntilInteractive(card);

  // 键盘打开:焦点在卡上,Enter 就是商家的「点开」。
  await card.focus();
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");

  const panel = page.getByRole("dialog", { name: "Asset details" });
  await expect(panel).toBeVisible();

  // 键盘关掉。
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // 缺陷本身就在这一行:关掉之后焦点必须回到那张卡,而不是 `<body>`。
  // 断言认的是**可及名称**,不是某个 DOM 节点:关闭会让网格按同一组条件重取一次,卡片是
  // 新挂上去的节点,而商家在意的是「焦点还在那件素材上吗」。
  await expect(card).toBeFocused();
  // 而且是这一张,不是隔壁那一张。
  await expect(neighbour).not.toBeFocused();
});
