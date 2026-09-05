/**
 * Journey 17 — 画布上的「选中」只有一份,商家的手和键盘都够得着它(FRONT-A15)。
 *
 * 走查现场(Codex QA-CRE-002 / QA-CRE-008,2026-09-03,真 Chrome,main e622bec6 的生产构建,
 * 1440×900):
 *   · 用选择工具点中一张文字卡,按 Delete、按 Backspace —— 屏幕上什么都不发生。板上还是 5 张卡。
 *   · Shift 再点第二张,几张卡同时描着边,键盘对这一组照样使不上劲。
 *   · 「Fit to screen」摆出来的画有一部分压在固定覆盖层底下(实测一张视频卡 45%),点它落在
 *     Otto 输入框上 —— 视频没被选中,上一张图的操作条还留在屏幕上。
 *
 * 单测当时全绿,因为这几件事都住在**真浏览器的命中判定**里。所以这一趟用真 `click()`(不是
 * `dispatchEvent`:派发的事件直送目标,埋在别的组件底下也照样绿)和真按键走一遍。
 *
 * 种下去的只有「商家开口之前就该有的东西」——板上已经在的四张卡。这套 e2e 手上一把供应商钥匙
 * 都没有(`support/env.ts` 逐条挡),整趟一分钱都不动。
 */
import { test, expect, type Page } from "@playwright/test";
import { seedWorkspace, seedCanvasCard, countCanvasNodes, readCanvasNodePosition } from "../support/seed.js";
import { signIn } from "../support/auth.js";

/** 板上这张卡此刻在不在屏幕上。 */
const card = (page: Page, nodeId: string) => page.locator(`.react-flow__node[data-id="${nodeId}"]`);

/** 点一张卡的左上角 —— 那里既不是播放键也不是操作条,是卡本身。 */
async function pick(page: Page, nodeId: string, modifiers: Array<"Shift"> = []): Promise<void> {
  await card(page, nodeId).click({ position: { x: 5, y: 5 }, modifiers });
}

/** 板子记住的选中 —— React Flow 把它写在卡的 class 上,描边读的就是这一份。 */
async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".react-flow__node.selected")].map((n) => n.getAttribute("data-id") ?? ""),
  );
}

test("FRONT-A15 — 键盘删得掉选中的卡,多选删得掉一组,视频卡有自己的操作条", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "canvassel",
    workspaceName: "Kopi Corner",
    personName: "Rahim",
    openingGrant: 40,
  });
  const note = await seedCanvasCard(ws, { kind: "text", x: 60, y: 60, text: "E2E note — video approved" });
  const shot = await seedCanvasCard(ws, { kind: "image", x: 420, y: 60, prompt: "a glass jar of pandan kaya" });
  const clip = await seedCanvasCard(ws, { kind: "video", x: 780, y: 60, prompt: "a pandan kaya jar on a wooden table" });
  const dud = await seedCanvasCard(ws, { kind: "failed", x: 60, y: 460, prompt: "try the night-market background" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ws, "/");
  await page.goto(`/create/canvas?project=${ws.projectId}`);
  await expect(card(page, note.nodeId)).toBeVisible({ timeout: 30_000 });
  await expect(card(page, clip.nodeId)).toBeVisible();
  expect(await countCanvasNodes(ws)).toBe(4);

  // ① 选中一张文字卡,按 Delete —— 走查里这里什么都不发生。
  //
  // 文字卡用**框选**圈中,不是点中间:它的输入框铺满整张卡的内里,点中间光标就进框,那时
  // Backspace 该是退格而不是删卡(键盘删卡的护栏正是这么写的)。框选是商家真会用的手势,
  // 而且不吃缩放 —— 点那圈 11px 的边在低缩放下只剩几像素,是个会飘的断言。
  await page.getByRole("button", { name: "Select tool" }).click();
  const noteBox = (await card(page, note.nodeId).boundingBox())!;
  await page.mouse.move(noteBox.x - 24, noteBox.y - 24);
  await page.mouse.down();
  await page.mouse.move(noteBox.x + noteBox.width + 24, noteBox.y + noteBox.height + 24, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => selectedIds(page)).toEqual([note.nodeId]);
  await page.keyboard.press("Delete");
  // 键盘走的是**已有的那条确认路**,不是第二条删除路:同一句话,同一个按钮。
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Remove from canvas?");
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(card(page, note.nodeId)).toHaveCount(0);
  await expect.poll(() => countCanvasNodes(ws)).toBe(3);

  // ② Shift 点第二张 = 真的两张都选中,Delete 一次拿走两张。
  await pick(page, shot.nodeId);
  await expect.poll(() => selectedIds(page)).toEqual([shot.nodeId]);
  await pick(page, dud.nodeId, ["Shift"]);
  await expect.poll(() => selectedIds(page).then((ids) => ids.sort())).toEqual([shot.nodeId, dud.nodeId].sort());
  await page.keyboard.press("Delete");
  const batch = page.getByRole("alertdialog");
  await expect(batch).toContainText("Remove 2 cards from canvas?");
  await batch.getByRole("button", { name: "Remove" }).click();
  await expect(card(page, shot.nodeId)).toHaveCount(0);
  await expect(card(page, dud.nodeId)).toHaveCount(0);
  await expect.poll(() => countCanvasNodes(ws)).toBe(1);

  // ③ 点视频卡 = 视频卡自己的操作条出现(和图片卡同一份契约,只是视频没有 Animate)。
  await pick(page, clip.nodeId);
  expect(await selectedIds(page)).toEqual([clip.nodeId]);
  const videoActions = page.getByRole("group", { name: "Video actions" });
  await expect(videoActions).toBeVisible();
  await expect(videoActions.getByRole("button", { name: "Edit with Otto" })).toBeVisible();
  await expect(videoActions.getByRole("button", { name: "Create variations" })).toBeVisible();
  await expect(videoActions.getByRole("button", { name: "Download" })).toBeVisible();
  await expect(videoActions.getByRole("button", { name: "More actions" })).toBeVisible();
  await expect(videoActions.getByRole("button", { name: "Animate" })).toHaveCount(0);

  // ④ 按播放只是播放 —— 选中不变,操作条还在。
  await card(page, clip.nodeId).getByRole("button", { name: "Play" }).click();
  expect(await selectedIds(page)).toEqual([clip.nodeId]);
  await expect(videoActions).toBeVisible();

  // ⑤ 视频卡自己那颗 Download 真的存下一个文件。
  const download = page.waitForEvent("download");
  await videoActions.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.mp4$/u);

  // ⑥ 刷新之后,剩下那张卡还在它原来的位置上。
  const before = await readCanvasNodePosition(ws, clip.nodeId);
  await page.reload();
  await expect(card(page, clip.nodeId)).toBeVisible({ timeout: 30_000 });
  expect(await readCanvasNodePosition(ws, clip.nodeId)).toEqual(before);
});
