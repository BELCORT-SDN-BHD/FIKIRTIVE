/**
 * #791-4 自动 Review 整轮关闭(Founder 裁决 2026-08-08)。
 *
 * 原状:每一次生成成功之后,worker 都会自己再跑一轮 Otto —— 只为问一句「这个符合你的
 * 预期吗?」。那一轮是**计费的**(withLlmBudget reserve→settle,refId 形如
 * `otto-verdict:<jobId>`),商家在 Billing 的花费清单里看到一行叫「Review」的扣款,
 * 而这一轮不是他们要的:图刚出来,满不满意他们自己看得见。
 *
 * Founder 原话:「这个自行 review 有一些不必要了,让 user 自己 decide 就好,而且模型
 * 已经强大」。照此做成:整轮移除,不是留着不收钱。
 *
 * 这里钉两件事:
 *  ① 全仓再没有任何一行会铸出 `otto-verdict:` 这个计费 refId —— 新的 Review 扣款
 *    从此不可能产生;
 *  ② 历史行仍然被如实标成「Review」。已经发生过的扣款不能因为功能下线就改口。
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../../..");

/** Tracked files that contain the literal, as `git grep -l` sees them. */
function trackedFilesContaining(literal: string): string[] {
  try {
    return execFileSync("git", ["grep", "-l", "-F", "--", literal, "--", "apps", "packages"], {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return []; // git grep exits 1 when there are no matches
  }
}

describe("#791-4 自动 Review 轮整个下线", () => {
  it("没有任何一行还会铸出 otto-verdict: 计费 refId", () => {
    const minting = trackedFilesContaining("otto-verdict:").filter(
      (f) =>
        // 这两个是「读历史」的地方,不是「铸新账」的地方:
        // - spend-history.ts 给历史 ledger 行贴标签;
        // - llm-reservation-reaper.ts 收尾历史上遗留的未结算预扣。
        f !== "apps/web/lib/spend-history.ts" &&
        f !== "apps/worker/src/jobs/llm-reservation-reaper.ts" &&
        !f.includes("__tests__") &&
        !f.endsWith(".test.ts"),
    );
    expect(minting).toEqual([]);
  });

  it("worker 里不再有生成完成后的自动 Otto 轮", () => {
    expect(trackedFilesContaining("resumeOttoAfterGen")).toEqual([]);
    expect(trackedFilesContaining("ottoWorkerVerdictRuntime")).toEqual([]);
  });

  it("Otto 的指令里不再承诺「生成完成后我会来问你满不满意」", () => {
    expect(trackedFilesContaining("Verdict after a generation finishes")).toEqual([]);
  });

  it("历史上真发生过的 Review 扣款仍被如实标成 Review,不被改口成 Chat", async () => {
    const { spendCategoryOf, SPEND_CATEGORY_LABEL } = await import("@/lib/spend-history");
    const category = spendCategoryOf(
      { refId: "otto-verdict:job_old", kind: "SETTLE", source: "SYSTEM" },
      new Map(),
    );
    expect(category).toBe("review");
    expect(SPEND_CATEGORY_LABEL[category]).toBe("Review");
  });
});
