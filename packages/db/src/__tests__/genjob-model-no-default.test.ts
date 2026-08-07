/**
 * #675 — GenJob.model 不许有库级默认值(方案 A,Founder 2026-08-07 批)。
 *
 * `GenJob` 一张表同时装图片作业与视频作业,而这一列的库级默认值是**图片**引擎
 * `seedream`。任何一处 insert 漏带 `model`,库不会拒绝,它会**安静地**补上一个图片引擎
 * —— 落进去的是一条「视频作业写着图片引擎」的行。它不报错、不留痕,只在下游读的时候
 * 变成一条自相矛盾的记录。
 *
 * 默认值今天已经没有任何读者:app 层唯一那处 GenJob insert
 * (`apps/web/lib/gen-actions.ts`)显式带 `model`,而契约闸 `genRequest`
 * (`packages/core/src/gen.ts`)在视频请求漏带 `model` 时,zod 的默认值 `"seedream"`
 * 不在视频菜单上,当场拒收。所以撤掉默认值不改变任何在产行为 —— 它只把「将来某人漏写」
 * 的后果从「安静地写错」换成「立刻报错」。fail closed。
 *
 * 两条断言,都问真库:
 *   ① 列上没有 DEFAULT —— 漏写不再有值可补;
 *   ② 漏写 `model` 的 INSERT 被 NOT NULL 当场打回(23502),不是落一条错行。
 *
 * 断言 ② 走 raw SQL 而不是 Prisma Client:撤掉 schema 默认值之后,漏写 `model` 在
 * TypeScript 侧已经是编译错误(`pnpm -r typecheck` 是那一层的证据),写不出这个用例。
 * 库这一层要单独证 —— 它挡的是绕过 Client 的写入方。
 *
 * `RefGenJob.model` 的同名默认值**保留**(#668 分析):那张表只装图片作业,`seedream`
 * 就是它的真值,不存在错位。第三条断言把这个「保留」也钉住,免得日后被顺手一起清掉。
 *
 * 零花钱:只碰 Organization / Project / GenJob 三张表,不 reserve、不 settle、不入账。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../index.js";
import { seedOrg } from "../../test/setup.js";

let orgId: string;
let projectId: string;

beforeEach(async () => {
  orgId = `org_${randomUUID()}`;
  projectId = `proj_${randomUUID()}`;
  await seedOrg(orgId, 100_000);
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "no default" } });
});

async function columnDefault(table: string, column: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ column_default: string | null }[]>`
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ${table}
      AND column_name = ${column}
  `;
  expect(rows).toHaveLength(1);
  return rows[0]!.column_default;
}

describe("GenJob.model 的库级默认值", () => {
  it("列上没有 DEFAULT —— 漏写 model 时库没有值可以替作业者补", async () => {
    expect(await columnDefault("GenJob", "model")).toBeNull();
  });

  it("漏写 model 的 INSERT 被当场打回,而不是落一条写着图片引擎的视频作业", async () => {
    const insertWithoutModel = prisma.$executeRawUnsafe(
      `INSERT INTO "GenJob" ("id", "ownerId", "projectId", "prompt", "kind", "count", "updatedAt")
       VALUES ($1, $2, $3, $4, 'VIDEO'::"GenKind", 1, now())`,
      `gen_${randomUUID()}`,
      orgId,
      projectId,
      "a video job that forgot to say which engine",
    );
    // 23502 = not_null_violation。默认值还在的时候,这一条会成功,并落一条 model='seedream' 的视频作业。
    await expect(insertWithoutModel).rejects.toThrow();

    const rows = await prisma.genJob.count({ where: { ownerId: orgId, projectId } });
    expect(rows).toBe(0);
  });

  it("显式带 model 的 INSERT 照常成立 —— 撤掉的只是默认值,不是这一列", async () => {
    const id = `gen_${randomUUID()}`;
    await prisma.genJob.create({
      data: { id, ownerId: orgId, projectId, prompt: "an explicit engine", kind: "VIDEO", model: "seedance-2-fast", count: 1 },
    });
    const row = await prisma.genJob.findFirst({ where: { id, ownerId: orgId }, select: { model: true } });
    expect(row?.model).toBe("seedance-2-fast");
  });

  it("RefGenJob.model 的默认值保留 —— 那张表只装图片作业,seedream 就是它的真值", async () => {
    expect(await columnDefault("RefGenJob", "model")).toBe("'seedream'::text");
  });
});
