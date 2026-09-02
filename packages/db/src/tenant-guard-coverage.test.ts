/**
 * tenant-guard 覆盖守卫(审计 2026-07-04 补)。
 *
 * 租户铁幕(宪法 6)的运行时兜底 withTenantGuard 只检查 TENANT_MODELS 名单里的模型。
 * 审计发现:schema 里 30 个带 ownerId 的模型,名单只有 17 个 —— CanvasNode(活跃开发中
 * 的画布)完全不在守卫视野里。名单靠手工维护,新模型忘了登记就是零检查。
 *
 * 这个测试把"记得登记"变成机器规则:解析 schema.prisma 里所有带 ownerId 的模型,
 * 断言每一个要么在 TENANT_MODELS(受守卫),要么在 TENANT_GUARD_EXEMPT(带原因的
 * 明示豁免,如 admin 平台级读取)。新模型出生必须二选一,不许静默落空。
 *
 * ── 2026-09-02(钱引擎⑤B,规格 §7.7 欠账⑧):正则扩到 `orgId` ────────────────────
 * 上面那句话有一个字是承重的:**ownerId**。租户列叫 `orgId` 的表从来没进过这个扫描 ——
 * 而那正好是装着每一个商家的钱的两张表(CreditAccount / CreditLedger)加上暂停权威
 * (Membership)。它们不是"被豁免了",它们是**结构性看不见**:没有人为它们做过选择,
 * 也没有人会发现没做过。
 *
 * 现在正则认两种列名,`orgId` 那一族对到 ORG_SCOPED_TENANT_GUARD_EXEMPT —— 一份带理由的
 * 明示登记(理由与实测证据写在那个常量的注释里,含"为什么不能直接进 TENANT_MODELS")。
 * 盲区从此是"一个有人签过字的决定",而不是"一个没人看得见的洞"。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TENANT_MODELS, TENANT_GUARD_EXEMPT, ORG_SCOPED_TENANT_GUARD_EXEMPT } from "./tenant-guard.js";

const SCHEMA = path.resolve(__dirname, "../prisma/schema.prisma");

type ModelShape = { body: string; ownerScoped: boolean; orgScoped: boolean };

function schemaModels(): Map<string, ModelShape> {
  const src = fs.readFileSync(SCHEMA, "utf8");
  const models = new Map<string, ModelShape>();
  for (const match of src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const body = match[2] ?? "";
    models.set(match[1]!, {
      body,
      ownerScoped: /^\s*ownerId\s+/m.test(body),
      // `orgId` 是第二种租户列名(钱两表 + Membership 用的就是它)。分开记而不是并成一个
      // 布尔,是因为两族的归宿不同:ownerId 族进运行时守卫,orgId 族今天只能走明示登记
      // (守卫会**注入** `ownerId` 这个字面列名,见 ORG_SCOPED_TENANT_GUARD_EXEMPT 的注释)。
      orgScoped: /^\s*orgId\s+/m.test(body),
    });
  }
  return models;
}

/** schema.prisma 里所有声明了 ownerId 标量字段的模型名。 */
function ownerIdModels(): string[] {
  return [...schemaModels()]
    .filter(([, model]) => model.ownerScoped)
    .map(([name]) => name);
}

/** schema.prisma 里所有声明了 **orgId** 标量字段、且没有 ownerId 的模型名。 */
function orgIdModels(): string[] {
  return [...schemaModels()]
    .filter(([, model]) => model.orgScoped && !model.ownerScoped)
    .map(([name]) => name);
}

function ownerScopedRelations(): Array<{
  child: string;
  field: string;
  parent: string;
  relationFields: string[];
}> {
  const models = schemaModels();
  const relations: Array<{
    child: string;
    field: string;
    parent: string;
    relationFields: string[];
  }> = [];

  for (const [child, model] of models) {
    if (!model.ownerScoped) continue;
    for (const match of model.body.matchAll(
      /^\s*(\w+)\s+(\w+)(?:\?|\[\])?\s+@relation\(([\s\S]*?)\)/gm,
    )) {
      const [, field, parent, relationArgs = ""] = match;
      if (!models.get(parent!)?.ownerScoped) continue;
      const fields = relationArgs.match(/fields:\s*\[([^\]]+)\]/)?.[1];
      if (!fields) continue;
      relations.push({
        child,
        field: field!,
        parent: parent!,
        relationFields: fields.split(",").map((value) => value.trim()),
      });
    }
  }
  return relations;
}

describe("tenant-guard coverage — every ownerId model is guarded or explicitly exempt", () => {
  const models = ownerIdModels();

  it("schema parser sanity: finds the known tenant models (a broken parser must not green-wash)", () => {
    expect(models).toContain("Project");
    expect(models).toContain("GenJob");
    expect(models).toContain("CanvasNode");
    expect(models.length).toBeGreaterThanOrEqual(25);
  });

  it("every ownerId model is in TENANT_MODELS or TENANT_GUARD_EXEMPT", () => {
    for (const model of models) {
      const guarded = TENANT_MODELS.has(model);
      const exempt = model in TENANT_GUARD_EXEMPT;
      expect(
        guarded || exempt,
        `model "${model}" carries ownerId but is in NEITHER TENANT_MODELS nor TENANT_GUARD_EXEMPT ` +
          `(packages/db/src/tenant-guard.ts). The runtime guard does ZERO checks on it. ` +
          `Add it to TENANT_MODELS (owner-scoped queries only) or to TENANT_GUARD_EXEMPT with a reason.`,
      ).toBe(true);
    }
  });

  it("no model is both guarded and exempt (the lists must not contradict)", () => {
    for (const model of TENANT_MODELS) {
      expect(model in TENANT_GUARD_EXEMPT, `"${model}" is in BOTH lists`).toBe(false);
    }
  });

  it("no stale entries: every listed model still exists in the schema with ownerId", () => {
    for (const model of [...TENANT_MODELS, ...Object.keys(TENANT_GUARD_EXEMPT)]) {
      expect(models, `"${model}" is listed in tenant-guard.ts but has no ownerId in schema.prisma (renamed/removed?)`).toContain(model);
    }
  });

  it("every direct relation between owner-scoped models carries ownerId", () => {
    const relations = ownerScopedRelations();
    const inspected = relations.map(({ child, field }) => `${child}.${field}`);
    expect(inspected).toContain("Generation.project");
    expect(inspected).toContain("ChatMessage.thread");
    expect(inspected).toContain("EntityVariant.entity");

    const unsafe = relations
      .filter(({ relationFields }) => !relationFields.includes("ownerId"))
      .map(({ child, field, parent }) => `${child}.${field} -> ${parent}`);
    expect(unsafe, "owner-scoped relations must use a tenant-qualified foreign key").toEqual([]);
  });
});

/**
 * **orgId 那一族**(钱引擎⑤B,规格 §7.7 欠账⑧)。
 *
 * 上面那组扫的是 `ownerId`。这一组扫 `orgId` —— 同样是租户列,同样必须有人为它做过选择。
 * 它们今天全部走明示登记而不是运行时守卫,理由与实测证据在 ORG_SCOPED_TENANT_GUARD_EXEMPT
 * 的注释里(一句话:守卫**注入**的是 `ownerId` 这个字面列名,直接登记会把这些表打坏,
 * 而不是守住)。
 */
describe("tenant-guard coverage — orgId 那一族也必须有人做过选择", () => {
  const models = orgIdModels();

  it("schema parser sanity: 真的找得到钱两表与暂停权威(正则坏掉不许洗绿)", () => {
    expect(models).toContain("CreditAccount");
    expect(models).toContain("CreditLedger");
    expect(models).toContain("Membership");
  });

  it("每一个 orgId 模型都在 ORG_SCOPED_TENANT_GUARD_EXEMPT 里,而且带着理由", () => {
    for (const model of models) {
      const reason = ORG_SCOPED_TENANT_GUARD_EXEMPT[model];
      expect(
        typeof reason === "string" && reason.length > 0,
        `model "${model}" 的租户列是 orgId,但它既不在运行时守卫里、也没有一条带理由的登记 ` +
          `(packages/db/src/tenant-guard.ts 的 ORG_SCOPED_TENANT_GUARD_EXEMPT)。` +
          `运行时守卫对它做零检查 —— 那必须是一个有人签过字的决定,不是一个没人看得见的洞。`,
      ).toBe(true);
    }
  });

  it("没有过期登记:每一条登记的模型今天仍然带着 orgId", () => {
    for (const model of Object.keys(ORG_SCOPED_TENANT_GUARD_EXEMPT)) {
      expect(models, `"${model}" 登记着,但 schema.prisma 里已经没有 orgId 了(改名/删了?)`).toContain(model);
    }
  });

  it("两份名单不许打架:一个模型不能既受 ownerId 守卫又走 orgId 登记", () => {
    for (const model of Object.keys(ORG_SCOPED_TENANT_GUARD_EXEMPT)) {
      expect(TENANT_MODELS.has(model), `"${model}" 同时在 TENANT_MODELS 里 —— 守卫会注入 ownerId 把它打坏`).toBe(false);
      expect(model in TENANT_GUARD_EXEMPT, `"${model}" 同时在 TENANT_GUARD_EXEMPT 里 —— 两份名单只留一份`).toBe(false);
    }
  });
});
