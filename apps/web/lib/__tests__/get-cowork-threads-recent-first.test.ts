/**
 * getCoworkThreads / getAllCoworkThreadMetas — 判官 #1174 P0 修复轮。
 *
 * PR #1174 本该只改 `getProjects` 一处排序（`get-projects-recent-first.test.ts`），但
 * `getCoworkThreads`（`apps/web/lib/data.ts:343` 一带）与 `getAllCoworkThreadMetas`
 * （`:373` 一带）也被从主干的 `{ updatedAt: "desc" }` 误改成了 `{ createdAt: "asc" }`——
 * 像是把 `getProjects` 该换上的新排序，误贴到了这两处不该动的函数上。
 *
 * 后果：
 *   · `otto-panel-seed.ts`（`loadOttoPanelSeed`）用 `getAllCoworkThreadMetas` 的行 `find()`
 *     出「当前 project 打开时停在哪一条」——不自己再排序，倒序后 `find()` 拿到的是最老
 *     那条，Otto 面板打开时接的是错的会话。
 *   · Otto 面板分组历史列表、`ImmersiveCanvasEntry.tsx` 沉浸画布对话栏，两处对话历史
 *     整段倒过来。
 *   · `getCoworkThreads` 头顶的 docstring「newest activity first」变成一句假话。
 *
 * 判官指出零测试守的根因：两处消费者测试（`otto-panel-seed.test.ts` 等）把
 * `getAllCoworkThreadMetas` mock 成「已经按正确顺序排好的行」，测的是选择逻辑，不是
 * 真排序——真排序的 bug 从未被这些 mock 测试摸到过。这份文件补的就是那一层缺口：真库，
 * 不 mock Prisma（与 `get-projects-recent-first.test.ts` 同一约定），直接钉
 * `getCoworkThreads` / `getAllCoworkThreadMetas` 自己的 SQL `orderBy`。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const { prisma } = await import("@fikirtive/db");
const { getCoworkThreads, getAllCoworkThreadMetas } = await import("@/lib/data");

const ownerId = `org_qa_1174_${randomUUID()}`;
const projectId = `prj_qa_1174_${randomUUID()}`;
// getAllCoworkThreadMetas 是「这个 owner 名下的每一条」，不带 projectId 过滤 —— 用独立的
// ownerId 隔开，免得跟上面 getCoworkThreads 那组种子的会话混进同一份 owner 结果里,
// 断言就得写成脆弱的子集匹配。
const allMetasOwnerId = `org_qa_1174_allmetas_${randomUUID()}`;
const otherProjectId = `prj_qa_1174_other_${randomUUID()}`;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ownerId, name: "PR #1174 P0 cowork thread order" } });
  await prisma.organization.create({ data: { id: allMetasOwnerId, name: "PR #1174 P0 getAllCoworkThreadMetas order" } });
});

afterAll(async () => {
  await prisma.chatThread.deleteMany({ where: { ownerId: { in: [ownerId, allMetasOwnerId] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ownerId, allMetasOwnerId] } } });
  await prisma.$disconnect();
});

describe("FRONT-A15 getCoworkThreads：pinned 先，其后按最近活动（updatedAt）倒序", () => {
  it("FRONT-A15 三条会话：建得最早但最近被动过的排在建得晚但没再动过的前面；pinned 恒居首", async () => {
    const base = Date.parse("2026-01-01T00:00:00Z");

    const idOldestUntouched = `thr_qa1174_${randomUUID()}`; // A：最早建，之后再没被动过
    const idTouchedRecently = `thr_qa1174_${randomUUID()}`; // B：建得比 A 晚一点，但后来被回复/续了一轮，updatedAt 比 A 新得多
    const idPinned = `thr_qa1174_${randomUUID()}`; // C：置顶 —— 无论 updatedAt 都恒居首

    await prisma.chatThread.create({
      data: { id: idOldestUntouched, ownerId, projectId, title: "Thread A — oldest, never touched again", createdAt: new Date(base), updatedAt: new Date(base) },
    });
    await prisma.chatThread.create({
      data: { id: idTouchedRecently, ownerId, projectId, title: "Thread B — created later, touched most recently", createdAt: new Date(base + 1_000), updatedAt: new Date(base + 5_000) },
    });
    await prisma.chatThread.create({
      data: { id: idPinned, ownerId, projectId, title: "Thread C — pinned", createdAt: new Date(base + 2_000), updatedAt: new Date(base + 2_000), pinnedAt: new Date(base + 9_000) },
    });

    const threads = await getCoworkThreads(ownerId, projectId);
    const ids = threads.map((t) => t.id);

    // 期望：C（pinned）→ B（最近被动过）→ A（最早建、最后没再动）。
    // 若排序退回 `createdAt asc`，B 与 A 的相对顺序会翻过来（A 比 B 先建），这条断言先红。
    expect(ids).toEqual([idPinned, idTouchedRecently, idOldestUntouched]);
  });

  it("FRONT-A15 两条都没置顶的会话：只按 updatedAt 倒序，不看 createdAt", async () => {
    const base = Date.parse("2026-02-01T00:00:00Z");
    const idNewerCreatedOlderUpdated = `thr_qa1174_${randomUUID()}`;
    const idOlderCreatedNewerUpdated = `thr_qa1174_${randomUUID()}`;

    await prisma.chatThread.create({
      data: { id: idNewerCreatedOlderUpdated, ownerId, projectId, title: "Created later, updated earlier", createdAt: new Date(base + 10_000), updatedAt: new Date(base) },
    });
    await prisma.chatThread.create({
      data: { id: idOlderCreatedNewerUpdated, ownerId, projectId, title: "Created earlier, updated later", createdAt: new Date(base), updatedAt: new Date(base + 10_000) },
    });

    const threads = await getCoworkThreads(ownerId, projectId);
    const rank = new Map(threads.map((t, i) => [t.id, i]));

    expect(rank.get(idOlderCreatedNewerUpdated)!).toBeLessThan(rank.get(idNewerCreatedOlderUpdated)!);
  });
});

describe("FRONT-A15 getAllCoworkThreadMetas：跨全部 project，同一条 pinned/updatedAt 倒序契约", () => {
  it("FRONT-A15 跨两个 project 的三条会话：pinned 恒居首，其余按 updatedAt 倒序，不看 createdAt", async () => {
    const base = Date.parse("2026-03-01T00:00:00Z");

    const idOldestUntouched = `thr_qa1174all_${randomUUID()}`;
    const idTouchedRecently = `thr_qa1174all_${randomUUID()}`;
    const idPinned = `thr_qa1174all_${randomUUID()}`;

    await prisma.chatThread.create({
      data: { id: idOldestUntouched, ownerId: allMetasOwnerId, projectId, title: "All A — oldest, never touched again", createdAt: new Date(base), updatedAt: new Date(base) },
    });
    await prisma.chatThread.create({
      data: { id: idTouchedRecently, ownerId: allMetasOwnerId, projectId: otherProjectId, title: "All B — created later, touched most recently", createdAt: new Date(base + 1_000), updatedAt: new Date(base + 5_000) },
    });
    await prisma.chatThread.create({
      data: { id: idPinned, ownerId: allMetasOwnerId, projectId: otherProjectId, title: "All C — pinned", createdAt: new Date(base + 2_000), updatedAt: new Date(base + 2_000), pinnedAt: new Date(base + 9_000) },
    });

    const threads = await getAllCoworkThreadMetas(allMetasOwnerId);
    const ids = threads.map((t) => t.id);

    expect(ids).toEqual([idPinned, idTouchedRecently, idOldestUntouched]);
  });
});
