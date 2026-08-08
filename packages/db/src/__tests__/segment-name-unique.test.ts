/**
 * #746 — 分群重名唯一化,由数据库说了算。
 *
 * #718 已经在应用层拦过重名,但那是"先查后写":查和写之间的真空里,两个并发请求可以
 * 同时被放行。这个文件不经过任何 server action,直接对着真库写——所以它测的只有一件事:
 * **索引本身是否成立**。应用层怎么措辞,是 apps/web 那两个文件的事。
 *
 * 五条,对应索引的五个选择:
 *   ① 同一商家、只有大小写不同的名字 → 第二行写不进(唯一 + lower)
 *   ② 不同商家、完全相同的名字 → 两行都在(第一列是 ownerId,租户之间互不相干)
 *   ③ 并发双写 → 恰好一行落地,另一笔 P2002(真空关闭的证据)
 *   ④ 软删之后同名可以再建(部分索引 WHERE "deletedAt" IS NULL)
 *   ⑤ 同一商家、不同 kind、同一个名字 → 第二行也写不进(索引键里没有 "kind")
 *
 * 零金额:只碰 Organization / Segment。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../index.js";

const ORG_A = "seg746-org-a";
const ORG_B = "seg746-org-b";
const NOW = new Date("2026-08-08T00:00:00.000Z");

const RULES = { match: "all", rules: [{ kind: "contactability", value: "contactable" }] };

function segment(id: string, ownerId: string, name: string, kind = "custom") {
  return {
    id,
    ownerId,
    name,
    phrase: "All of: contact is not a known opt-out",
    rulesJson: RULES,
    kind,
    createdAt: NOW,
  };
}

beforeEach(async () => {
  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
});

describe("#746 Segment name uniqueness lives in the database", () => {
  it("refuses a second live segment whose name differs only by case", async () => {
    await prisma.segment.create({ data: segment("seg746-first", ORG_A, "VIP buyers") });

    await expect(
      prisma.segment.create({ data: segment("seg746-case", ORG_A, "vip BUYERS") }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(prisma.segment.count({ where: { ownerId: ORG_A } })).resolves.toBe(1);
  });

  it("lets a different merchant use the very same name", async () => {
    await prisma.segment.create({ data: segment("seg746-a", ORG_A, "Contactable customers") });
    await expect(
      prisma.segment.create({ data: segment("seg746-b", ORG_B, "Contactable customers") }),
    ).resolves.toMatchObject({ id: "seg746-b" });

    await expect(prisma.segment.count({ where: { ownerId: ORG_A } })).resolves.toBe(1);
    await expect(prisma.segment.count({ where: { ownerId: ORG_B } })).resolves.toBe(1);
  });

  it("concurrent duplicate inserts land exactly one row and one P2002", async () => {
    const results = await Promise.allSettled([
      prisma.segment.create({ data: segment("seg746-race-1", ORG_A, "Repeat buyers") }),
      prisma.segment.create({ data: segment("seg746-race-2", ORG_A, "repeat buyers") }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect((loser.reason as { code?: string }).code).toBe("P2002");
    await expect(prisma.segment.count({ where: { ownerId: ORG_A } })).resolves.toBe(1);
  });

  it("a soft-deleted segment frees its name for a new one", async () => {
    await prisma.segment.create({ data: segment("seg746-old", ORG_A, "Seasonal") });
    await prisma.segment.updateMany({
      where: { id: "seg746-old", ownerId: ORG_A },
      data: { deletedAt: NOW },
    });

    await expect(
      prisma.segment.create({ data: segment("seg746-new", ORG_A, "SEASONAL") }),
    ).resolves.toMatchObject({ id: "seg746-new", deletedAt: null });
    await expect(prisma.segment.count({ where: { ownerId: ORG_A } })).resolves.toBe(2);
  });

  /**
   * 判官 r1,P1。上一版索引带着 "kind",于是同一商家的 builtin_lifecycle "VIP" 与 custom "VIP"
   * 可以并存。广播发起页读的是这个商家的全部 kind 且只画名字(customer-broadcast-service
   * getBroadcastComposerOptions / broadcast-composer-page 的 <option>),所以那两行在商家眼里
   * 就是两条一模一样的发送受众。唯一命名空间必须和商家看得见的命名空间一样大。
   */
  it("refuses a second live segment of another kind under the same name", async () => {
    await prisma.segment.create({
      data: segment("seg746-builtin", ORG_A, "VIP", "builtin_lifecycle"),
    });

    await expect(
      prisma.segment.create({ data: segment("seg746-custom", ORG_A, "vip", "custom") }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(prisma.segment.count({ where: { ownerId: ORG_A } })).resolves.toBe(1);
  });

  it("a rename onto another live segment's name is refused too", async () => {
    await prisma.segment.createMany({
      data: [
        segment("seg746-keep", ORG_A, "Big spenders"),
        segment("seg746-rename", ORG_A, "Everyone else"),
      ],
    });

    await expect(
      prisma.segment.updateMany({
        where: { id: "seg746-rename", ownerId: ORG_A },
        data: { name: "BIG SPENDERS" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.segment.findFirstOrThrow({ where: { id: "seg746-rename", ownerId: ORG_A } }),
    ).resolves.toMatchObject({ name: "Everyone else" });
  });
});
