import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEAD_LETTER_QUEUES } from "@fikirtive/core";

/**
 * #793 — runbook 与代码的同步锁。
 *
 * 这一页的价值全在「照着做就真的接通了」。它一旦落后于代码,就变成一份看起来齐全、
 * 照做却接不通的清单 —— 比没有更坏。所以让代码来校验文档:新增一条死信队列、改掉探针
 * 路径、换掉 env 变量名,都会在这里红。
 */
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const RUNBOOK = path.join(REPO_ROOT, "docs/ops/dashboards.md");
const doc = fs.readFileSync(RUNBOOK, "utf8");

describe("docs/ops/dashboards.md", () => {
  it("names every dead-letter queue the probe actually watches", () => {
    for (const queue of DEAD_LETTER_QUEUES) expect(doc).toContain(queue);
  });

  it("names both probe endpoints an operator has to point a monitor at", () => {
    expect(doc).toContain("/api/ops/dlq");
    expect(doc).toContain("/api/health");
  });

  it("names both environment variables, and says the public one needs a rebuild", () => {
    expect(doc).toContain("NEXT_PUBLIC_SENTRY_DSN");
    expect(doc).toContain("SENTRY_DSN");
    expect(doc).toMatch(/NEXT_PUBLIC_[\s\S]{0,200}重新构建|重新构建[\s\S]{0,200}NEXT_PUBLIC_/);
  });

  it("pins the alert title the Sentry rule has to match", () => {
    expect(doc).toContain("Dead-letter queues are not empty");
    expect(doc).toContain("dead-letters"); // the probe tag the optional rule filters on
  });

  it("keeps a production-side residual list — nothing here is claimed as done", () => {
    expect(doc).toContain("生产侧残留清单");
  });

  // 生产零接触红线的机器检查:一枚真 DSN 被粘进 runbook 就是一次凭据泄漏。
  it("contains no real credential", () => {
    expect(doc).not.toMatch(/https:\/\/[0-9a-zA-Z]{16,}@/);
    expect(doc).not.toMatch(/\bsntrys?_[0-9a-zA-Z]/);
  });
});
