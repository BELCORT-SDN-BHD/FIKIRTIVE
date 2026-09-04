/**
 * getProjects — Codex 只读 E2E QA-CRE-006（`docs/audits/creation-e2e-2026-09-04.md` §4.1）
 * 三条发现里第一条:Create 起步页的 Canvas history 是旧到新，不是「最近活动优先」。
 *
 * FRONT-A15（`docs/specs/frontend-baseline.md` §7.1 ⑨ 段）钉这条排序契约:pinned 先，
 * 其后按最近活动（`updatedAt`）倒序，不是 `createdAt` 正序。
 *
 * 真库，不 mock Prisma —— 见 `isolation.test.ts` 同一约定，`setup-db-guard.ts` 拒绝在非
 * `*_test` 库上跑。种子直接建 Organization + Project（跳过 requireOwner 的会话解析，这份
 * 测试只关心排序，不关心身份），显式给 `createdAt` 与 `updatedAt` —— Prisma 的 `@updatedAt`
 * 只在**没**显式传值时才写入 `now()`，显式传值会被尊重，这才能摆出「建得早但改得晚」
 * 这种关键场景。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const { prisma } = await import("@fikirtive/db");
const { getProjects } = await import("@/lib/data");

const ownerId = `org_qa_cre_006_${randomUUID()}`;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ownerId, name: "QA-CRE-006 getProjects order" } });
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { ownerId } });
  await prisma.organization.delete({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe("FRONT-A15 getProjects：pinned 先，其后按最近活动（updatedAt）倒序", () => {
  it("FRONT-A15 三张画布：建得最早但最近被动过的排在建得晚但没再动过的前面；pinned 恒居首", async () => {
    const base = Date.parse("2026-01-01T00:00:00Z");

    const idOldestUntouched = `prj_qa006_${randomUUID()}`; // A：最早建，之后再没被动过
    const idTouchedRecently = `prj_qa006_${randomUUID()}`; // B：建得比 A 晚一点，但后来被改名/存了一次，updatedAt 比 A 新得多
    const idPinned = `prj_qa006_${randomUUID()}`; // C：置顶 —— 无论 updatedAt 都恒居首

    await prisma.project.create({
      data: { id: idOldestUntouched, ownerId, name: "Canvas A — oldest, never touched again", createdAt: new Date(base), updatedAt: new Date(base) },
    });
    await prisma.project.create({
      data: { id: idTouchedRecently, ownerId, name: "Canvas B — created later, touched most recently", createdAt: new Date(base + 1_000), updatedAt: new Date(base + 5_000) },
    });
    await prisma.project.create({
      data: { id: idPinned, ownerId, name: "Canvas C — pinned", createdAt: new Date(base + 2_000), updatedAt: new Date(base + 2_000), pinnedAt: new Date(base + 9_000) },
    });

    const projects = await getProjects(ownerId);
    const ids = projects.map((p) => p.id);

    // 期望：C（pinned）→ B（最近被动过）→ A（最早建、最早也最后没再动）。
    // 若排序退回 `createdAt asc`，B 与 A 的相对顺序会翻过来（A 比 B 先建），这条断言会先红。
    expect(ids).toEqual([idPinned, idTouchedRecently, idOldestUntouched]);
  });

  it("FRONT-A15 两张都没置顶的画布：只按 updatedAt 倒序，不看 createdAt", async () => {
    const base = Date.parse("2026-02-01T00:00:00Z");
    const idNewerCreatedOlderUpdated = `prj_qa006_${randomUUID()}`;
    const idOlderCreatedNewerUpdated = `prj_qa006_${randomUUID()}`;

    await prisma.project.create({
      data: { id: idNewerCreatedOlderUpdated, ownerId, name: "Created later, updated earlier", createdAt: new Date(base + 10_000), updatedAt: new Date(base) },
    });
    await prisma.project.create({
      data: { id: idOlderCreatedNewerUpdated, ownerId, name: "Created earlier, updated later", createdAt: new Date(base), updatedAt: new Date(base + 10_000) },
    });

    const projects = await getProjects(ownerId);
    const rank = new Map(projects.map((p, i) => [p.id, i]));

    expect(rank.get(idOlderCreatedNewerUpdated)!).toBeLessThan(rank.get(idNewerCreatedOlderUpdated)!);
  });
});
