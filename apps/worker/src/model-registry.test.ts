/**
 * #647 T6 修复轮 P1-3 —— worker 侧开关读取的失败语义(单元)。
 *
 * 读得到就如实回;读不到就**抛**,而不是回一个空集合假装「什么都没关」。
 * 抛出来的必须是 PLAIN(不带 charged 标记)—— 配置查询抖一下是花钱之前的瞬时故障,
 * 重投重试是对的;把它当成已计费的终态才是错的(#664 已裁的 charged/PLAIN 语义)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const findMany = vi.fn();
  return { findMany, prisma: { modelRegistryOverlay: { findMany } } };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma }));

import { workerDisabledModels } from "./model-registry.js";

beforeEach(() => vi.clearAllMocks());

describe("workerDisabledModels", () => {
  it("读得到 ⇒ 只留在册 id(未知 id 在解析边界被丢掉,行为不变)", async () => {
    m.findMany.mockResolvedValue([{ modelId: "seedance-2-fast" }, { modelId: "kling" }, { modelId: "" }]);
    expect([...(await workerDisabledModels())]).toEqual(["seedance-2-fast"]);
  });

  it("读得到但一行都没有 ⇒ 空集合(什么都没关)", async () => {
    m.findMany.mockResolvedValue([]);
    expect((await workerDisabledModels()).size).toBe(0);
  });

  it("读不到 ⇒ **抛**,绝不回空集合(空集合等于替 Founder 把开关打开)", async () => {
    m.findMany.mockRejectedValue(new Error("connection terminated unexpectedly"));
    await expect(workerDisabledModels()).rejects.toThrow();
  });

  it("抛的是 PLAIN:不带 charged 标记 ⇒ 花钱之前的故障,重投重试", async () => {
    m.findMany.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const err = await workerDisabledModels().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { charged?: unknown }).charged).toBeUndefined();
  });

  it("错误信息不带出底层驱动的原文(日志噪音与泄漏都不要)", async () => {
    m.findMany.mockRejectedValue(new Error("password authentication failed for user \"fikirtive\""));
    const err = await workerDisabledModels().catch((e: unknown) => e);
    expect((err as Error).message).not.toMatch(/password/iu);
  });
});
