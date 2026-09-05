/**
 * Journey 19 — CREATE-A1：生成走到终局，画布上那张 Otto 卡**不刷新也收敛**。
 *
 * Codex 第三轮只读 E2E（`docs/audits/creation-product-avatar-video-062aae86-2026-09-04.md`
 * E2E-CRE-PAV-003，P1）录到的那一幕：起始图作业 `01M1N7G76R4RCW0EJTCXDWQR4P` 在 03:33:26
 * 已经是 FAILED、1 credit 也已经退回，而画布上那张始终可见的 Otto 卡还写着
 * `Generating · Working on it… · still working…`；强制刷新，它才变成 `Failed`。
 *
 * 病根不在读，在**问**：那扇看着生成结果的窗从前只有一档，每 2.5 秒问一次、问满 48 次
 * （两分钟）就不再问了。而服务端那一头，一个失败的生成走完自己的重投序列本来就可能更久
 * （`GEN_QUEUE_POLICY`：两次重投，pg-boss 退避 30–60s 与 60–120s，最坏 180s 纯等待）。
 * 屏幕不是读错了，是先闭嘴了。修法是把 StoryboardCard 早就判过的那条规则（#782 r7，
 * 判官 r6 P1-A：**到顶不等于放弃**）用在这条一直缺第二档的窗上。
 *
 * 这一趟没有 worker（这套 e2e 手上一把供应商钥匙都没有，`support/env.ts` 逐条挡），所以
 * 「worker 写下终局」由旅程自己按 `appendCoworkResult` 的形状写进库 —— 那正是这条断言要问的
 * 问题：**终局落库之后，没有人刷新，屏幕会不会自己变过来。**
 *
 * 时间用 Playwright 的受控时钟推，不是真的等：这套件的第一条规矩是「判定里没有墙上时钟」。
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
// 商家会读到的那一句，从它自己那一份来 —— 逐字抄一遍就等着和文案的下一次修改各说各话
// （support/seed.ts 借 `storageKey` 用的是同一条路：e2e 不是 pnpm workspace，按路径吃 dist）。
import { REFERENCE_ASSET_UNREACHABLE } from "../../packages/core/dist/index.js";
import { seedWorkspace, seedThread, seedApprovedPlanCard, type Workspace } from "../support/seed.js";
import { prisma, runAsTenant } from "../support/db.js";
import { signIn } from "../support/auth.js";

/**
 * worker 走完终局那一刻落库的两行 —— 形状逐字来自 `apps/worker/src/jobs/gen.ts`：
 * 作业行进 FAILED（`GenJob.error` 存的是给商家读的那一句），线程里多一条 TURN_ERROR，
 * `genJobId` 指着这个作业（每作业一条终局消息的那个唯一索引就建在它上面）。
 *
 * 钱不在这里动：Codex 那一轮的 RESERVE 1.0 → REFUND 1.0 是 worker 在同一个事务里做的，
 * 这条旅程问的是**屏幕**，不是账本（账本有 04-refund-exactly-once 自己那一趟）。
 */
async function workerWritesTerminalFailure(
  ws: Workspace,
  threadId: string,
  refId: string,
  seq: number,
): Promise<void> {
  await runAsTenant(ws.orgId, () =>
    prisma.genJob.updateMany({
      where: { id: refId, ownerId: ws.orgId },
      data: { status: "FAILED" as never, error: REFERENCE_ASSET_UNREACHABLE },
    }),
  );
  await runAsTenant(ws.orgId, () =>
    prisma.chatMessage.create({
      data: {
        id: `e2e_term_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        threadId,
        ownerId: ws.orgId,
        role: "AGENT" as never,
        kind: "TURN_ERROR" as never,
        seq,
        text: REFERENCE_ASSET_UNREACHABLE,
        genJobId: refId,
        payload: { kind: "image", model: "e2e-mock-image", generationIds: [] },
      },
    }),
  );
}

async function openCanvasOnAWorkingJob(page: Page, ws: Workspace, threadId: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ws, "/");
  await page.goto(`/create/canvas?project=${ws.projectId}&thread=${threadId}`);
  const turnCard = page.getByLabel("Otto current turn");
  await expect(turnCard).toBeVisible();
  // 卡已经被按过、作业已经在排队：钱花出去了，这是屏幕上最该说的一件事。
  await expect(turnCard).toContainText("Generating");
  return turnCard;
}

test("CREATE-A1 —— 生成刚失败就落库时,当前轮不刷新也变成 Failed", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "converge1", workspaceName: "Kopi Tiam Sri", personName: "Farah", openingGrant: 90,
  });
  const { threadId } = await seedThread(ws);
  const { refId } = await seedApprovedPlanCard(ws, threadId, { seq: 1 });

  const turnCard = await openCanvasOnAWorkingJob(page, ws, threadId);
  await workerWritesTerminalFailure(ws, threadId, refId, 2);

  // 没有 reload:同一张页面自己问到了那条终局。
  await expect(turnCard).toContainText("Failed");
  await expect(turnCard).toContainText(REFERENCE_ASSET_UNREACHABLE);
  await expect(turnCard).not.toContainText("Generating");
});

test("CREATE-A1 —— 终局落在快轮之外时,当前轮仍然不刷新就收敛", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "converge2", workspaceName: "Warung Bunga", personName: "Nadia", openingGrant: 90,
  });
  const { threadId } = await seedThread(ws);
  const { refId } = await seedApprovedPlanCard(ws, threadId, { seq: 1 });

  // 受控时钟：页面自己的定时器由这里推，测试不占用真的时间。
  await page.clock.install();
  const turnCard = await openCanvasOnAWorkingJob(page, ws, threadId);

  // `runFor` 会把这段时间里到期的定时器**逐次**都跑掉（`fastForward` 只跑一次，那样快轮
  // 永远走不完）。2.5s × 48 ≈ 2 分钟的快轮在这 2 分半里被彻底用光 —— 修复之前，屏幕从此
  // 不再发问，这一页要等到有人刷新才诚实。
  await page.clock.runFor("02:30");
  await expect(turnCard).toContainText("Generating");

  // 服务端到这一刻才走完自己的重投序列并写下终局。上面那 48 次发问全部早于这一行，
  // 没有一次可能读到它 —— 能把它带回来的只有快轮之后那一档。
  await workerWritesTerminalFailure(ws, threadId, refId, 2);

  // 慢轮的下一次发问（60s 一次）把它带回来。没有人刷新过这一页。
  await page.clock.fastForward("01:10");
  await expect(turnCard).toContainText("Failed");
  await expect(turnCard).toContainText(REFERENCE_ASSET_UNREACHABLE);
  await expect(turnCard).not.toContainText("Generating");
});
