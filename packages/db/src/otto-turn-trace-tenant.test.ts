/**
 * ENGINE-A2 — `OttoTurnTrace` 的租户边界与形状(规格 `docs/specs/otto-engine.md` §7.2②)。
 *
 * 这张表的租户列叫 `orgId`,所以它进的是 `ORG_SCOPED_TENANT_GUARD_EXEMPT` 而不是运行时
 * 守卫(守卫**注入**的是字面 `ownerId`,登记进 TENANT_MODELS 会把它打坏 —— 见 tenant-guard.ts
 * 里 2026-09-02 的实测注释)。于是租户边界必须由**外键 + 每个读写口显式带 orgId**承担,
 * 而「承担住了」这句话在这里被真库证明,不是在文档里声明。
 *
 * 跑在真的 *_test Postgres 上,迁移已 deploy(test/setup.ts 每个用例 TRUNCATE Organization
 * CASCADE,连带清掉这张表)。
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "./index.js";
import { TENANT_MODELS, TENANT_GUARD_EXEMPT, ORG_SCOPED_TENANT_GUARD_EXEMPT } from "./tenant-guard.js";

const SCHEMA = path.resolve(__dirname, "../prisma/schema.prisma");
const ORG_A = "ott-org-a";
const ORG_B = "ott-org-b";

/** The OttoTurnTrace model block from schema.prisma. */
function traceBlock(): string {
  const src = fs.readFileSync(SCHEMA, "utf8");
  const start = src.indexOf("model OttoTurnTrace {");
  expect(start, "OttoTurnTrace model must exist in schema.prisma").toBeGreaterThanOrEqual(0);
  return src.slice(start, src.indexOf("\n}", start));
}

function row(orgId: string, refId: string) {
  return {
    refId,
    orgId,
    threadId: "thread_1",
    surface: "stream",
    modelId: "claude-sonnet-4-6",
    steps: 3,
    toolCalls: [{ name: "lookupProducts", calls: 2, ok: 1, failed: 1 }],
    skillFiles: [] as string[],
    truncated: false,
    settledInternal: 17,
  };
}

beforeEach(async () => {
  await prisma.organization.create({ data: { id: ORG_A } });
  await prisma.organization.create({ data: { id: ORG_B } });
});

describe("ENGINE-A2 OttoTurnTrace — 租户边界(双租户)", () => {
  it("ENGINE-A2: 一个工作区的档案,另一个工作区按 orgId 查一行也读不到", async () => {
    await prisma.ottoTurnTrace.create({ data: row(ORG_A, "otto-stream:msg_a") });
    await prisma.ottoTurnTrace.create({ data: row(ORG_B, "otto-stream:msg_b") });

    const seenByA = await prisma.ottoTurnTrace.findMany({ where: { orgId: ORG_A } });
    const seenByB = await prisma.ottoTurnTrace.findMany({ where: { orgId: ORG_B } });
    expect(seenByA.map((r) => r.refId)).toEqual(["otto-stream:msg_a"]);
    expect(seenByB.map((r) => r.refId)).toEqual(["otto-stream:msg_b"]);

    // 拿着 A 的 refId 去 B 的范围里查 —— 主键查得到那一行,加上 orgId 就查不到。
    // 这正是 ops 只读脚本之外每个读面必须带 orgId 的原因。
    const crossTenant = await prisma.ottoTurnTrace.findFirst({
      where: { refId: "otto-stream:msg_a", orgId: ORG_B },
    });
    expect(crossTenant).toBeNull();
  });

  it("ENGINE-A2: orgId 是真外键 —— 挂到不存在的工作区上会被数据库拒绝", async () => {
    await expect(
      prisma.ottoTurnTrace.create({ data: row("ott-org-does-not-exist", "otto-turn:msg_x") }),
    ).rejects.toThrow();
  });

  it("ENGINE-A2: 工作区注销时它的档案随外键 CASCADE 一起走,不留孤儿", async () => {
    await prisma.ottoTurnTrace.create({ data: row(ORG_A, "otto-turn:msg_c") });
    await prisma.organization.delete({ where: { id: ORG_A } });
    expect(await prisma.ottoTurnTrace.count({ where: { orgId: ORG_A } })).toBe(0);
  });

  it("ENGINE-A2: refId 是主键 —— 同一轮不可能留下两份互相矛盾的档案", async () => {
    await prisma.ottoTurnTrace.create({ data: row(ORG_A, "otto-approve:t1:c1:a1") });
    await expect(
      prisma.ottoTurnTrace.create({ data: row(ORG_A, "otto-approve:t1:c1:a1") }),
    ).rejects.toThrow();
    // 同一张卡的第二次尝试是**另一个** refId(:a2),所以它是新的一行,不覆盖第一次。
    await prisma.ottoTurnTrace.create({ data: row(ORG_A, "otto-approve:t1:c1:a2") });
    expect(await prisma.ottoTurnTrace.count({ where: { orgId: ORG_A } })).toBe(2);
  });
});

describe("ENGINE-A2 OttoTurnTrace — 形状(列层的「零商家内容明文」)", () => {
  it("ENGINE-A2: 表上没有任何可以装明文的列(没有 prompt/text/message/content/arguments)", () => {
    const block = traceBlock();
    for (const forbidden of ["prompt", "text", "message", "content", "arguments", "input", "output", "reply"]) {
      expect(
        new RegExp(`^\\s+\\w*${forbidden}\\w*\\s+`, "im").test(block),
        `OttoTurnTrace 不允许有名字里带 "${forbidden}" 的列 —— 那是明文能落进来的口子`,
      ).toBe(false);
    }
    // 它该有的那几列(结构事实)确实在。
    for (const column of ["refId", "orgId", "threadId", "surface", "modelId", "steps", "toolCalls", "skillFiles", "truncated", "settledInternal", "createdAt"]) {
      expect(new RegExp(`^\\s+${column}\\s+`, "m").test(block), `缺列 ${column}`).toBe(true);
    }
  });

  it("ENGINE-A2: 已在 ORG_SCOPED_TENANT_GUARD_EXEMPT 里登记,并且没有同时出现在另外两份名单", () => {
    expect(typeof ORG_SCOPED_TENANT_GUARD_EXEMPT.OttoTurnTrace).toBe("string");
    expect(ORG_SCOPED_TENANT_GUARD_EXEMPT.OttoTurnTrace!.length).toBeGreaterThan(0);
    expect(TENANT_MODELS.has("OttoTurnTrace")).toBe(false);
    expect("OttoTurnTrace" in TENANT_GUARD_EXEMPT).toBe(false);
  });

  it("ENGINE-A2: toolCalls 只装名字与计数,skillFiles 只装文件名 —— 存进去什么形状,读出来还是什么形状", async () => {
    await prisma.ottoTurnTrace.create({
      data: {
        ...row(ORG_A, "otto-stream:msg_shape"),
        toolCalls: [
          { name: "lookupProducts", calls: 2, ok: 2, failed: 0 },
          { name: "(unregistered)", calls: 1, ok: 0, failed: 1 },
        ],
        skillFiles: ["craft/seedance.md"],
      },
    });
    const read = await prisma.ottoTurnTrace.findFirst({ where: { orgId: ORG_A, refId: "otto-stream:msg_shape" } });
    expect(read?.toolCalls).toEqual([
      { name: "lookupProducts", calls: 2, ok: 2, failed: 0 },
      { name: "(unregistered)", calls: 1, ok: 0, failed: 1 },
    ]);
    expect(read?.skillFiles).toEqual(["craft/seedance.md"]);
  });
});
