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
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TENANT_MODELS, TENANT_GUARD_EXEMPT } from "./tenant-guard.js";

const SCHEMA = path.resolve(__dirname, "../prisma/schema.prisma");

/** schema.prisma 里所有声明了 ownerId 标量字段的模型名。 */
function ownerIdModels(): string[] {
  const src = fs.readFileSync(SCHEMA, "utf8");
  const models: string[] = [];
  let current: string | null = null;
  for (const line of src.split("\n")) {
    const m = line.match(/^model\s+(\w+)\s/);
    if (m) { current = m[1]!; continue; }
    if (line.match(/^\s+ownerId\s/) && current) {
      if (!models.includes(current)) models.push(current);
    }
    if (line.startsWith("}")) current = null;
  }
  return models;
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
});
