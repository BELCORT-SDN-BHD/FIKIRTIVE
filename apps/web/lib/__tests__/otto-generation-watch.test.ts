/**
 * otto-generation-watch — 生成结果那扇观察窗的两档齿轮（Codex E2E-CRE-PAV-003）。
 *
 * 录到的那一幕：数据库 03:33:26 已是 FAILED、1 credit 也已退回，画布上那张 Otto 卡还写着
 * 「Generating · still working…」，刷新才变成「Failed」。屏幕没有读错，是**先闭嘴了** ——
 * 这扇窗从前只有一档，问满 2.5s × 48（两分钟）就不再问；而服务端那一头，一个失败的生成
 * 走完自己的重投序列本来就可能更久（`GEN_QUEUE_POLICY` 两次重投，pg-boss 退避 30–60s
 * 与 60–120s，最坏 180s 纯等待，每次投递本身还要跑）。
 *
 * 下面钉的是同一件事：**「到顶」不等于「放弃」**。这条规则不是这一轮发明的 —— 判官在
 * #782 r7（r6 P1-A）已经为 StoryboardCard 判过一次，实现是 `nextSyncPhase`。这里保证的是
 * 它真的用在了这条一直缺第二档的窗上，以及两档合起来盖得住服务端自己的终局窗口。
 *
 * 纯函数 + 一次词法扫描，没有 React、没有 I/O（和 `otto-card-seams.test.ts` 读同一份源文件
 * 的做法一致）。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GEN_QUEUE_POLICY } from "@fikirtive/core";
import { nextSyncPhase } from "@/lib/storyboard-card";
import { GENERATION_WATCH_GEARS } from "@/lib/otto-inject-helpers";

const OTTO_CHAT_STREAM = path.resolve(__dirname, "../../components/otto/OttoChatStream.tsx");

describe("CREATE-A1 —— 生成结果的观察窗", () => {
  it("CREATE-A1 —— 快轮到顶、服务端还没给终局时换慢轮接着问,不是闭嘴", () => {
    expect(
      nextSyncPhase({
        phase: "fast",
        triesUsed: GENERATION_WATCH_GEARS.fast.maxTries,
        maxTries: GENERATION_WATCH_GEARS.fast.maxTries,
        stillPending: true,
      }),
    ).toBe("slow");
  });

  it("CREATE-A1 —— 慢轮也到顶才真的停,停在「我们放弃了」而不是「它结束了」", () => {
    expect(
      nextSyncPhase({
        phase: "slow",
        triesUsed: GENERATION_WATCH_GEARS.slow.maxTries,
        maxTries: GENERATION_WATCH_GEARS.slow.maxTries,
        stillPending: true,
      }),
    ).toBe("exhausted");
    // 服务端一给终局就收工,两档都一样,一次都不多问。
    expect(
      nextSyncPhase({
        phase: "fast",
        triesUsed: 1,
        maxTries: GENERATION_WATCH_GEARS.fast.maxTries,
        stillPending: false,
      }),
    ).toBe("off");
  });

  /**
   * 屏幕停止发问的那一刻，必须晚于服务端交出终局的那一刻 —— 否则就是同一个病。服务端这一头
   * 可导入的权威数字是队列自己的 `expireInSeconds`（一次投递最长能活多久；之外还有 worker
   * 的收尸器兜底），观察窗至少要盖住它。第二条断言是这整条修复的存在理由：**单靠快轮盖不住**，
   * 所以第二档不是装饰。
   */
  it("CREATE-A1 —— 两档合起来盖得住服务端自己的终局窗口,单靠快轮盖不住", () => {
    const serverTerminalWindowMs = GEN_QUEUE_POLICY.expireInSeconds * 1000;
    const fastWindowMs =
      GENERATION_WATCH_GEARS.fast.intervalMs * GENERATION_WATCH_GEARS.fast.maxTries;
    const slowWindowMs =
      GENERATION_WATCH_GEARS.slow.intervalMs * GENERATION_WATCH_GEARS.slow.maxTries;
    expect(fastWindowMs).toBeLessThan(serverTerminalWindowMs);
    expect(fastWindowMs + slowWindowMs).toBeGreaterThanOrEqual(serverTerminalWindowMs);
  });

  /**
   * 上面钉的是规则，这一条钉的是**规则真的接上了**：那条轮询效应必须按档取间隔与上限，
   * 并把到顶那一刻交给 `nextSyncPhase`。复发时第一个还原回来的就是「写死一个 48，到顶
   * `setPollGaveUp(true)` 收工」，所以那个形状被逐字挡住。
   */
  it("CREATE-A1 —— OttoChatStream 的轮询效应按档走,到顶交给 nextSyncPhase", () => {
    const src = fs.readFileSync(OTTO_CHAT_STREAM, "utf8");
    expect(src).toContain("GENERATION_WATCH_GEARS[pollGear]");
    expect(src).toContain("setPollGear(nextSyncPhase({");
    expect(src).not.toContain("const MAX_POLLS");
  });
});
