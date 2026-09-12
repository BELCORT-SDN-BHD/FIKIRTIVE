/**
 * 迁移期挡位的**出厂值**（规格 docs/specs/tenant-isolation.md §1.3 第四态 / §1.8，票 #1376）。
 *
 * 为什么单开一个文件：同一句 `expect(getOrgScopedGuardMode()).toBe("warn")` 写在
 * tenant-guard-money-slice1.test.ts 里是**恒真**的 —— 那个文件的 afterEach 每次都调
 * `setOrgScopedGuardMode("warn")` 复位，断言等于在问「刚刚那一句复位成功了吗」。
 * 这里钉的是另一件事：模块刚被加载、**没有任何 setter 跑过**时，挡位就是 warn。
 * 所以这个文件刻意不导入任何会调 setter 的模块（含那个切片测试文件），也不导入
 * setOrgScopedGuardMode —— import 之后的第一件事就是把挡位读下来。
 */
import { describe, it, expect } from "vitest";
import { getOrgScopedGuardMode } from "./tenant-guard.js";

/** import 之后、任何测试体跑之前先抓一份：这才是出厂值。 */
const MODE_AT_IMPORT = getOrgScopedGuardMode();

describe("迁移期挡位出厂值 —— 模块加载时就是 warn，不靠任何 setter 复位", () => {
  it("挡位在模块加载那一刻就是 warn（先建帧后执法的默认态）", () => {
    expect(MODE_AT_IMPORT).toBe("warn");
  });
});
