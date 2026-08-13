/**
 * env-boot.test.ts — #797。这里钉住的是「什么时候才算在生产服务」。
 *
 * 这一条判断错了的代价不对称:判宽了,生产半配的进程照样服务(这张票要消灭的形状);判窄了,
 * `next build` 会因为构建机器没有生产密钥而红——一条与代码毫无关系的假红,挡住的是所有人的
 * 合并。所以构建阶段必须被显式排除,并有测试守着。
 */
import { describe, it, expect } from "vitest";
import { isServingProduction } from "@/lib/env-boot";

describe("isServingProduction (#797)", () => {
  it("a production server is serving production", () => {
    expect(isServingProduction({ NODE_ENV: "production" })).toBe(true);
  });

  it("`next build` is NOT serving production, even though NODE_ENV says production", () => {
    expect(isServingProduction({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).toBe(false);
  });

  it("development and test are not production", () => {
    expect(isServingProduction({ NODE_ENV: "development" })).toBe(false);
    expect(isServingProduction({ NODE_ENV: "test" })).toBe(false);
    expect(isServingProduction({})).toBe(false);
  });
});
