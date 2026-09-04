/**
 * otto-thread-surface.test.ts —— 对话的**来源**这一格,对着真库。
 *
 * 规格:`docs/specs/frontend-baseline.md` §5(FRONT-A14 那一行)。
 * 触发:Codex 全 beta 审计 **P1-010**。
 *
 * `otto-panel-seed.test.ts` 钉的是选择规则本身(那一层把 `./data` mock 掉了),所以它
 * **证明不了**这一格真的从库里读得出来。这个文件补的就是那一段:一条真的 `ChatThread`
 * 行写进 `surface`,再走**生产那条读路**(`getAllCoworkThreadMetas`)取回来,看它在不在。
 * 少了这一条,`data.ts` 的 select 里漏掉 `surface` 会让面板永远读到 `undefined` ——
 * 按「老行按画布读」的口径,那等于面板再也不自动续任何一条对话,而全套 mock 测试仍然全绿。
 *
 * 两租户:B 读不到 A 的任何一行 —— 来源这一格不开新的跨租户口子(它只是多一列,查询仍然
 * 由 `ownerId` 收口)。
 *
 * 纯函数那一半(`coerceThreadSurface` / `isPanelThread`)不需要库,一起在这里钉:它是
 * 「客户端自报不算数」与「老行按画布读」两条纪律的落点。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

import { CHAT_THREAD_SURFACES, coerceThreadSurface, isCanvasThread, isPanelThread } from "@/lib/otto-thread-surface";

const { prisma } = await import("@fikirtive/db");
const data = await import("@/lib/data");
const { toChatThreadDTO, toChatThreadMetaDTO } = await import("@/lib/dto");

const orgA = `org_${randomUUID()}`;
const orgB = `org_${randomUUID()}`;
const projectA = `prj_${randomUUID()}`;
const projectB = `prj_${randomUUID()}`;
const canvasThreadId = `ct_${randomUUID()}`;
const panelThreadId = `ct_${randomUUID()}`;
const legacyThreadId = `ct_${randomUUID()}`;
const foreignThreadId = `ct_${randomUUID()}`;

beforeAll(async () => {
  for (const id of [orgA, orgB]) {
    await prisma.organization.create({ data: { id, name: id } });
  }
  await prisma.project.create({ data: { id: projectA, ownerId: orgA, name: "A project" } });
  await prisma.project.create({ data: { id: projectB, ownerId: orgB, name: "B project" } });
  await prisma.chatThread.create({
    data: { id: canvasThreadId, ownerId: orgA, projectId: projectA, title: "Professional Male Model Image", surface: "canvas" },
  });
  await prisma.chatThread.create({
    data: { id: panelThreadId, ownerId: orgA, projectId: projectA, title: "Top up my credits", surface: "panel" },
  });
  // 这一票之前的每一行都长这样:列在,但没有人写过它。
  await prisma.chatThread.create({
    data: { id: legacyThreadId, ownerId: orgA, projectId: projectA, title: "Legacy" },
  });
  await prisma.chatThread.create({
    data: { id: foreignThreadId, ownerId: orgB, projectId: projectB, title: "B thread", surface: "panel" },
  });
});

afterAll(async () => {
  await prisma.chatThread.deleteMany({ where: { ownerId: { in: [orgA, orgB] } } });
  await prisma.project.deleteMany({ where: { ownerId: { in: [orgA, orgB] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
});

describe("FRONT-A14 对话来源这一格,对着真库", () => {
  it("FRONT-A14 — a thread's surface is written to the row and comes back on the panel's read path", async () => {
    const rows = await data.getAllCoworkThreadMetas(orgA);
    const bySurface = new Map(rows.map((r) => [r.id, r.surface]));

    expect(bySurface.get(canvasThreadId)).toBe("canvas");
    expect(bySurface.get(panelThreadId)).toBe("panel");
  });

  it("FRONT-A14 — a thread written before this rule has no surface, and reads as a canvas conversation", async () => {
    const rows = await data.getAllCoworkThreadMetas(orgA);
    const legacy = rows.find((r) => r.id === legacyThreadId);

    expect(legacy?.surface ?? null).toBeNull();
    // 诚实登记:老行没有办法回溯它当初从哪个门开的,一律按画布读 —— 面板不自动续它。
    expect(isPanelThread(legacy?.surface)).toBe(false);
  });

  it("FRONT-A14 — the surface column opens no cross-tenant door: B never sees A's threads", async () => {
    const rowsB = await data.getAllCoworkThreadMetas(orgB);

    expect(rowsB.map((r) => r.id)).toEqual([foreignThreadId]);
    expect(rowsB.some((r) => r.id === panelThreadId || r.id === canvasThreadId)).toBe(false);
  });

  it("FRONT-A14 — the click-to-open read path carries surface", async () => {
    // 判官 P1-1:这是**点开列表里一条对话**走的那条读路(`getCoworkThreadClient` → 这里),
    // 与面板首开取种子那条(`getAllCoworkThreadMetas`)是两条不同的查询。上一版只补了
    // 后者,于是商家点开自己的面板对话,取回来的那一份 `surface` 是 `null` —— 上层拿它
    // 顶替掉列表里本来正确的那一行,头部当场翻成「Canvas · …」、列表长出 Canvas 徽章。
    const page = await data.getCoworkThreadPage(orgA, panelThreadId);
    expect(page).not.toBeNull();
    expect(page!.surface).toBe("panel");
    // 一路映到 DTO 也还在 —— 顶替发生在 DTO 这一层,断言就钉到这一层。
    expect(toChatThreadDTO(page!, new Map()).surface).toBe("panel");

    const canvasPage = await data.getCoworkThreadPage(orgA, canvasThreadId);
    expect(toChatThreadDTO(canvasPage!, new Map()).surface).toBe("canvas");

    // 两条读路对同一条线程说的是同一件事(顶替之所以有害,正因为它们本该一致)。
    const metas = await data.getAllCoworkThreadMetas(orgA);
    const meta = metas.find((r) => r.id === panelThreadId)!;
    expect(toChatThreadMetaDTO(meta).surface).toBe(toChatThreadDTO(page!, new Map()).surface);
  });

  it("FRONT-A14 — the canvas board's own read path carries surface too", async () => {
    // 判官 P2-3:画布「打开时接着聊哪一条」读的是 `getCoworkThreads`(按 project),
    // 它同样要看得见来源,否则商家在侧栏聊完再开 Create,画布续的是那条侧栏对话。
    const rows = await data.getCoworkThreads(orgA, projectA);
    const bySurface = new Map(rows.map((r) => [r.id, r.surface]));
    expect(bySurface.get(panelThreadId)).toBe("panel");
    expect(bySurface.get(canvasThreadId)).toBe("canvas");
    expect(bySurface.get(legacyThreadId) ?? null).toBeNull();
  });

  it("FRONT-A14 — a self-declared surface is validated server-side, never stored as sent", () => {
    // 客户端可以声明自己在哪个门(位置),但只有这两个字面量能落库。
    expect(CHAT_THREAD_SURFACES).toEqual(["canvas", "panel"]);
    expect(coerceThreadSurface("panel")).toBe("panel");
    expect(coerceThreadSurface("canvas")).toBe("canvas");
    // 自造的、空的、缺的一律落回画布 —— 猜错成 `panel` 会让一条来路不明的对话在商家
    // 每一页上自动摊开,猜错成 `canvas` 只是让他多点一下。
    for (const forged of ["PANEL", "workspace", "", null, undefined, 7, {}]) {
      expect(coerceThreadSurface(forged)).toBe("canvas");
    }
    expect(isPanelThread("panel")).toBe(true);
    expect(isPanelThread("canvas")).toBe(false);
    expect(isPanelThread(null)).toBe(false);
  });

  it("FRONT-A14 — an unknown origin is neither panel nor canvas, so the panel says nothing about it", () => {
    // 判官 P2-1:`isCanvasThread` 不是 `isPanelThread` 的反面。老行(`null`)来路无法回溯,
    // 两句话都不成立 —— 界面上说出口的东西(徽章、「Canvas · …」头部)只认 `isCanvasThread`,
    // 而「要不要自动续它」那个不出声的决定用 `isPanelThread`(未知 → 不自动续)。
    for (const unknown of [null, undefined, "", "workspace", "PANEL"]) {
      expect(isPanelThread(unknown)).toBe(false);
      expect(isCanvasThread(unknown)).toBe(false);
    }
    expect(isCanvasThread("canvas")).toBe(true);
    expect(isCanvasThread("panel")).toBe(false);
  });
});
