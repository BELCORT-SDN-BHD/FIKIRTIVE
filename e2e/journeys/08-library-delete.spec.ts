/**
 * Journey 8 — deleting your own work, and it staying deleted.
 *
 * The exit that matters most on a merchant's own data. The Library removes the tile optimistically,
 * so "it disappeared" proves nothing on its own — the journey reloads and looks again. That is the
 * exact shape of the defect this covers: a delete that only ever happened in the browser.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace, seedElement } from "../support/seed.js";
import { signIn } from "../support/auth.js";

test("An element deleted from the Library is gone, and is still gone after a reload", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "library",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 80,
  });
  const { entityId } = await seedElement(ws, "Kopi tumbler");
  await seedElement(ws, "Pandan roll");

  // W2-11 — the Library is its own route now. `/otto?view=library` is a 307 to it (journey 9
  // walks that redirect on purpose); a merchant who clicked "Library" is sent HERE, so this is
  // the address to be signed back into.
  await signIn(page, ws, "/library");
  // 前端基线段②:`/library` 改画已批准的 Library pattern,元素住在 Elements 页签下
  // (默认打开的那一格是 Generation history)。地址栏就是这一格的入口。
  await page.goto("/library?view=elements&element=products");

  const doomed = page.getByRole("button", { name: "Open Kopi tumbler" });
  const survivor = page.getByRole("button", { name: "Open Pandan roll" });
  await expect(doomed).toBeVisible();
  await expect(survivor).toBeVisible();

  // 控件又搬了一次家。已批准的 Elements 卡片点开的是一个元素弹层,删除是弹层里那颗
  // destructive 的 "Remove from Library"(前端基线 PR:设计没明说、生产必需的动作,
  // 用设计的样式呈现,文案与旧壳一字不改)。目的地没变:同一个 softDeleteEntity。
  await doomed.click();
  await page.getByRole("button", { name: "Remove from Library" }).click();

  // #934 — removal opens a confirmation instead of taking the tile away straight away.
  //
  // #359 / 2026-08-15 — the tile disappears optimistically the instant Remove is clicked,
  // before softDeleteEntity's server action has actually landed.
  // A reload racing that in-flight request can beat the write to the database, and this
  // journey flashed red on exactly that race once. Wait for the delete's OWN server-action
  // response before reloading — a Next.js Server Action call is a POST carrying a `next-action`
  // header, but the Library page ALSO fires a couple of other server actions of its own around
  // the same moment (a one-shot mount effect that loads generation history, an event-broadcast
  // balance refresh — neither is a timer/poll), so matching on the header alone is not enough:
  // measured live, one of those unrelated actions can win the race and resolve this wait before
  // the real delete request has even been sent. Matching the POST body for THIS entity's id is
  // what pins the wait to the one request that matters.
  const deleteRequestLanded = page.waitForResponse(async (res) => {
    const req = res.request();
    if (req.method() !== "POST") return false;
    if ((await req.headerValue("next-action")) === null) return false;
    return (req.postData() ?? "").includes(entityId);
  });
  // `exact` 不是装饰:弹层里那颗键叫 "Remove from Library",子串匹配会先抓到它,
  // 于是这一步点的是刚才已经点过的那颗,确认框永远不被按下。
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await deleteRequestLanded;

  await expect(doomed).toHaveCount(0);

  // The claim under test: it is gone from the workspace, not just from this render.
  await page.reload();
  await expect(page.getByRole("button", { name: "Open Kopi tumbler" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Pandan roll" })).toBeVisible();
});
