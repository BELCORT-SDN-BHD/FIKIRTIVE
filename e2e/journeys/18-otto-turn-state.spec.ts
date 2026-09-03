/**
 * Journey 18 — CREATE-A1：画布上那张始终可见的 Otto 卡，只说这一轮**此刻**的真相。
 *
 * Codex 只读审计（2026-09-04，`docs/audits/creation-e2e-2026-09-04.md` §4.2，QA-CRE-004，
 * 测的是 `main@e622bec6`）录到的三件事：
 *
 *   · 同一个画布里先失败一次、再成功一次直出视频之后，current turn **仍写着**
 *     「That generation didn't go through」；
 *   · 强制刷新最新页面，它变成 `🖼 result` —— 仍然不是一个可理解的 done state
 *     （没有产物、没有下一步、没有收费结果）；
 *   · 两步 image → video 计划里批准图片之后，下一张 video confirmation 不稳定出现。
 *
 * 审计期望：current turn 只表达当前 Conversation 的**一个**明确阶段，成功状态可理解，
 * 批准一个 step 之后进入下一个需要商家决定的 step。
 *
 * 这一趟种的都是「商家开口之前就该有的东西」：一条对话、一次失败留下的痕迹（真的 GenJob +
 * 真的 TURN_ERROR + Otto 随后说的那句话）、一次成功留下的痕迹（真的 Asset + Generation +
 * GEN_RESULT）。**这套 e2e 手上一把供应商钥匙都没有**（`support/env.ts` 逐条挡），所以
 * 「再成功一次」用库状态代替 —— 而审计第 ③ 步本来就是强制刷新，读的正是同一份库状态。
 */
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  seedWorkspace,
  seedThread,
  seedPlanCard,
  seedAgentText,
  seedFailedGeneration,
  seedFinishedGeneration,
  type Workspace,
} from "../support/seed.js";
import { prisma, runAsTenant } from "../support/db.js";
import { signIn } from "../support/auth.js";

/** 审计里赖在屏幕上不走的那句话。 */
const STALE_FAILURE = "That generation didn't go through — you weren't charged for it.";

/** 画布卡在「这一轮还没有话可说」时的那句引导（`OttoTurnCard.CANVAS_TURN_EMPTY_TEXT`，逐字）。 */
const EMPTY_TURN = "Tell Otto what you want to create or change.";

/**
 * 商家自己开口说的那一句 —— 这一轮与上一轮的分界，`currentTurnStartIndex` 认的就是它。
 *
 * 种在旅程里而不是 `support/seed.ts`：这一轮要证的正是「商家开口之后」那一刻的库状态，
 * 形状与 `seedAgentText` 逐字同一份，只是 role 是 USER。
 */
async function seedMerchantSays(
  ws: Workspace,
  threadId: string,
  opts: { seq: number; text: string },
): Promise<void> {
  await runAsTenant(ws.orgId, () =>
    prisma.chatMessage.create({
      data: {
        id: `e2e_ask_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        threadId,
        ownerId: ws.orgId,
        role: "USER" as never,
        kind: "TEXT" as never,
        seq: opts.seq,
        text: opts.text,
      },
    }),
  );
}

test("CREATE-A1 — 失败之后再成功一次，当前轮说的是成功；刷新之后还是同一句", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "turnstate",
    workspaceName: "Kopi Corner",
    personName: "Rahim",
    openingGrant: 90,
  });
  const { threadId } = await seedThread(ws);
  // ① 先失败一次，Otto 照 instructions 说了那句话。
  await seedFailedGeneration(ws, threadId, { seq: 1, ottoSays: STALE_FAILURE });
  // ② 同一个画布里再完成一次成功的直出视频。
  await seedFinishedGeneration(ws, threadId, { seq: 4, kind: "video", costCredits: 11 });

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ws, "/");
  await page.goto(`/create/canvas?project=${ws.projectId}&thread=${threadId}`);

  const turnCard = page.getByLabel("Otto current turn");
  await expect(turnCard).toBeVisible();

  // 上一轮那句失败不在了 —— 它已经被这一轮更新的那件事取代。
  await expect(turnCard).not.toContainText("didn't go through");
  // 状态词说的是这一轮真正结束在哪，不是「Ready」（审计里那颗绿灯配着一句失败）。
  await expect(turnCard).toContainText("Done");
  // 成功状态可理解：产出是什么、收了多少 —— 两个数字都来自产品自己写下的那一行。
  await expect(turnCard).toContainText("Made 1 video · 11 credits.");
  // 内部占位串永远不当正文（审计第 ③ 步录到的 `🖼 result`）。
  await expect(turnCard).not.toContainText("🖼");

  // ③ 强制刷新最新页面 —— 同一份持久状态必须给同一张脸，不许退化。
  await page.reload();
  await expect(turnCard).toBeVisible();
  await expect(turnCard).toContainText("Done");
  await expect(turnCard).toContainText("Made 1 video · 11 credits.");
  await expect(turnCard).not.toContainText("didn't go through");
  await expect(turnCard).not.toContainText("🖼");
});

test("CREATE-A1 — 两步计划里，商家还没决定的那一步一直摆在可见卡上", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "turnstep",
    workspaceName: "Warung Sedap",
    personName: "Siti",
    openingGrant: 90,
  });
  const { threadId } = await seedThread(ws);
  await seedAgentText(ws, threadId, {
    seq: 1,
    text: "Here's the two-step plan. Approve the image first; I'll make the video from it next.",
  });
  // 第一步已经做完了（商家按过），第二步还等着他决定。
  await seedFinishedGeneration(ws, threadId, { seq: 2, kind: "image", costCredits: 1 });
  await seedPlanCard(ws, threadId, { seq: 5, credits: 11, kind: "video", prompt: "Pan across the kopi set" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ws, "/");
  await page.goto(`/create/canvas?project=${ws.projectId}&thread=${threadId}`);

  const turnCard = page.getByLabel("Otto current turn");
  await expect(turnCard).toBeVisible();
  // 下一步就在这张始终可见的卡里，不必打开 Conversation 抽屉（审计第 ④ 步）。
  const confirmation = turnCard.getByLabel("Generation confirmation");
  await expect(confirmation).toHaveCount(1);
  await expect(confirmation).toContainText("1 video");
  await expect(confirmation.getByRole("button", { name: /Generate · 11 credits/ })).toBeVisible();
  // 停在商家身上，产品不假装自己在忙。
  await expect(turnCard).toContainText("Needs confirmation");
  // 而已经做完的那一步也没有被吞掉：它说得出产物和收费。
  await expect(turnCard).toContainText("Made 1 image · 1 credit.");
});

/**
 * 判官复核 P1-1（2026-09-04，PR #1173）：上面那句失败**换一条路又回来了**。
 *
 * 判官在真浏览器里录到的那一幕：同一画布失败一次 → Otto 说了那句道歉 → **商家开口说下一句**
 * → Otto 这一轮只铸了一张卡、一个字没说 → 当前轮显示「Needs confirmation」配着上一轮那句
 * 「That generation didn't go through」，旁边是一张全新的确认位。这一趟种的正是那一刻的库状态。
 */
test("CREATE-A1 — 失败之后商家开口说下一句，当前轮不再挂着上一轮那句失败", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "turnnext",
    workspaceName: "Kedai Kopi Aman",
    personName: "Aman",
    openingGrant: 90,
  });
  const { threadId } = await seedThread(ws);
  // ① 上一轮失败过，Otto 说了那句话（seq 1 卡 / 2 TURN_ERROR / 3 Otto 那句话）。
  await seedFailedGeneration(ws, threadId, { seq: 1, ottoSays: STALE_FAILURE });
  // ② 商家开口说下一句 —— 这一轮从这里开始。
  await seedMerchantSays(ws, threadId, { seq: 4, text: "Let's do a pandan kaya jar photo instead" });
  // ③ 这一轮 Otto 只铸了一张待确认的卡，一个字没说。
  await seedPlanCard(ws, threadId, { seq: 5, credits: 1, kind: "image", prompt: "A pandan kaya jar on a kitchen counter" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ws, "/");
  await page.goto(`/create/canvas?project=${ws.projectId}&thread=${threadId}`);

  const turnCard = page.getByLabel("Otto current turn");
  await expect(turnCard).toBeVisible();
  // 这一轮等着商家决定，卡就在可见处。
  await expect(turnCard.getByLabel("Generation confirmation")).toHaveCount(1);
  await expect(turnCard).toContainText("Needs confirmation");
  // 上一轮那句失败不再挂在这一轮脸上 —— 全卡逐字搜。
  await expect(turnCard).not.toContainText("didn't go through");
  // 这一轮没话可说就诚实地说没有，而不是借上一轮的话充数。
  await expect(turnCard).toContainText(EMPTY_TURN);
});
