/**
 * 钱表族的**出厂行为**（规格 docs/specs/tenant-isolation.md §1.3 第四态 / §1.8，票 #1403）。
 *
 * 这个文件原本钉的是迁移期挡位的出厂值 = `warn`。#1403 翻闸之后挡位连同它的 getter/setter 一起
 * 删掉了（TENANT-A10：能在生产关掉租户隔离的开关本身就是审计发现），所以钉的事情换成同一个位置
 * 上更强的那一句：**模块刚被加载、没有任何人扳过任何东西时，钱表族就在执法。**
 *
 * 为什么仍然单开一个文件：同一句断言写在 tenant-guard-money-slice1.test.ts 里，读者没法判断绿是
 * 因为「出厂就是这样」还是因为「前面某个用例刚把它设成这样」。这个文件刻意**不导入**任何会碰守卫
 * 状态的模块，import 之后第一件事就是把守卫的导出面读下来。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import * as tenantGuard from "./tenant-guard.js";
import { prisma } from "./index.js";

/** import 之后、任何测试体跑之前先抓一份：这才是出厂的导出面。 */
const EXPORTS_AT_IMPORT = Object.keys(tenantGuard);

describe("钱表族出厂就在执法 —— 没有挡位，也没有可以扳回去的开关", () => {
  it("守卫的导出面里没有任何挡位出口（TENANT-A10：开关已从代码中删除）", () => {
    expect(EXPORTS_AT_IMPORT).not.toContain("setOrgScopedGuardMode");
    expect(EXPORTS_AT_IMPORT).not.toContain("getOrgScopedGuardMode");
  });

  /**
   * 复审 T6（2026-09-19，PR #1495 规格/测试轴）：`TenantGuardMode` 是一个**类型别名**，编译后
   * 运行时根本没有这个导出 —— 拿 `Object.keys(模块)` 去断言它不在，无论代码怎么写都绿，是一条
   * 空断言。类型这一侧只有读源码才钉得住，所以这条直接读 `tenant-guard.ts` 的正文：
   * 挡位类型与那个模块级变量的**声明**必须不存在（注释里怎么讲历史都行，声明不许回来）。
   */
  it("挡位的类型与变量声明都不在源码里（T6：类型别名要读源码才钉得住）", () => {
    const source = readFileSync(fileURLToPath(new URL("./tenant-guard.ts", import.meta.url)), "utf8");
    const lines = source.split("\n").filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"));
    const code = lines.join("\n");
    expect(code).not.toMatch(/\btype\s+TenantGuardMode\b/);
    expect(code).not.toMatch(/\b(let|const|var)\s+orgScopedGuardMode\b/);
    expect(code).not.toMatch(/\bfunction\s+(get|set)OrgScopedGuardMode\b/);
    // 反向自检：这条规则读到的确实是守卫本体，而不是一个空字符串洗出来的绿。
    expect(code).toMatch(/export const PER_UNIQUE_KEY_EXEMPT/);
  });

  it("钱表族出厂就落闸：一次无帧、无租户过滤的钱查询在模块加载之后立刻被拒", async () => {
    await expect(prisma.creditLedger.findMany({ where: { kind: "SETTLE" } })).rejects.toThrow(
      /tenant-guard/,
    );
  });
});
