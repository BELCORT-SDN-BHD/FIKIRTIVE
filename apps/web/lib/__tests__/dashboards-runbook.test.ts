import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEAD_LETTER_QUEUES,
  censusDeadLetters,
  deadLetterAlertTitle,
  type DeadLetterQueueRow,
} from "@fikirtive/core";

/**
 * #793 — runbook 与代码的同步锁。
 *
 * 这一页的价值全在「照着做就真的接通了」。它一旦落后于代码,就变成一份看起来齐全、
 * 照做却接不通的清单 —— 比没有更坏。
 *
 * r2(判官 r1 P1-3 / P2):这里原先只查「字符串在不在」,于是 runbook 说
 * 「DB 不可达时 /api/health 回 503」、monitor 只盯 health 的非 200 —— 与 #796 定下的
 * 「health 恒 200、DB 就绪看 /api/ready」正面冲突,而测试全绿。字符串在不在证明不了
 * 两句话有没有互相矛盾。所以下面的断言改成从**代码**里推导事实,再要求文档与之一致。
 */
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

const doc = read("docs/ops/dashboards.md");
const incident = read("docs/ops/incident-visibility.md");
const healthRoute = read("apps/web/app/api/health/route.ts");
const readyRoute = read("apps/web/app/api/ready/route.ts");

/** 一个路由**实际**会回的状态码(从 `{ status: NNN }` 推,不是从注释推)。 */
function statusCodes(source: string): Set<string> {
  return new Set([...source.matchAll(/\{\s*status:\s*(\d{3})\s*\}/g)].map((m) => m[1]!));
}

/** runbook 里那段真的会被人抄进 uptime 服务的定义。 */
function monitorBlock(): string {
  const section = doc.split("### Uptime monitor")[1] ?? "";
  return section.split("```")[1] ?? "";
}

const row = (name: string, over: Partial<DeadLetterQueueRow> = {}): DeadLetterQueueRow => ({
  name,
  queuedCount: 0,
  deferredCount: 0,
  activeCount: 0,
  ...over,
});
const allRows = () => DEAD_LETTER_QUEUES.map((name) => row(name));

describe("docs/ops/dashboards.md", () => {
  it("names every dead-letter queue the probe actually watches", () => {
    for (const queue of DEAD_LETTER_QUEUES) expect(doc).toContain(queue);
  });

  it("names both environment variables, and says the public one needs a rebuild", () => {
    expect(doc).toContain("NEXT_PUBLIC_SENTRY_DSN");
    expect(doc).toContain("SENTRY_DSN");
    expect(doc).toMatch(/NEXT_PUBLIC_[\s\S]{0,200}重新构建|重新构建[\s\S]{0,200}NEXT_PUBLIC_/);
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

/**
 * 探针答什么,由代码说了算;runbook 必须逐字复述那三个词和那两句标题 —— 抄错一个词,
 * 照着建出来的 alert rule 就永远不会命中。
 */
describe("the probe's own vocabulary", () => {
  const clear = censusDeadLetters(allRows());
  const backedUp = censusDeadLetters([
    ...allRows().filter((r) => r.name !== "gen.dlq"),
    row("gen.dlq", { queuedCount: 1 }),
  ]);
  const unknown = censusDeadLetters(allRows().filter((r) => r.name !== "ingest.dlq"));

  it("documents each of the three answers the census can produce", () => {
    expect([clear.status, backedUp.status, unknown.status]).toEqual([
      "clear",
      "backed-up",
      "unknown",
    ]);
    for (const status of [clear.status, backedUp.status, unknown.status]) {
      expect(doc).toContain(`"deadLetters":"${status}"`);
    }
  });

  it("documents both Sentry titles verbatim, so an alert rule can match them", () => {
    for (const census of [backedUp, unknown]) {
      const title = deadLetterAlertTitle(census);
      expect(doc).toContain(title.slice(0, title.indexOf(":")));
    }
  });

  // 缺席的队列不算健康 —— runbook 必须把这句话写下来,否则下一个人会把它「优化」回去。
  it("says a missing queue is unknown, not clear", () => {
    expect(unknown.status).toBe("unknown");
    expect(doc).toMatch(/查不到[\s\S]{0,120}unknown|unknown[\s\S]{0,120}查不到/);
  });
});

/**
 * #796 的口径:`/api/health` 是**存活**且恒 200,`/api/ready` 才管 DB 就绪并回 503。
 * 这一组断言的事实来源是两个 route 文件本身。
 */
describe("liveness vs readiness — the runbook must not invert #796", () => {
  it("health really is always 200 (fact taken from the route, not from prose)", () => {
    expect(statusCodes(healthRoute)).toEqual(new Set(["200"]));
  });

  it("ready really is the endpoint that turns 503", () => {
    expect(statusCodes(readyRoute).has("503")).toBe(true);
  });

  /**
   * r1 的原话是「DB 不可达时 `/api/health` 返回 503」。这一条把它钉死:接线页里凡是给
   * `/api/health` 配状态码的地方,只能配 200。(诊断页 `incident-visibility.md` 归 #796 /
   * #880 管,这里只验它的正面口径,不去改它的措辞。)
   */
  it("the wiring page never attaches a 503 to /api/health", () => {
    const offenders = doc
      .split("\n")
      .filter((line) => line.includes("/api/health") && /\b503\b/.test(line));
    expect(offenders).toEqual([]);
  });

  it("both pages say health is always 200, and point DB truth at /api/ready", () => {
    for (const page of [doc, incident]) {
      expect(page).toContain("/api/ready");
      expect(page).toMatch(/恒(为)? ?200/);
    }
  });

  /**
   * 最要命的那一条:monitor 定义是唯一会被真的抄出去的东西。少了 `/api/ready`,
   * 一次数据库故障期间三个 monitor 全绿 —— 探针存在,却什么都看不见。
   */
  it("the monitor block an operator copies covers all three endpoints", () => {
    const monitors = monitorBlock();
    expect(monitors).toContain("/api/health");
    expect(monitors).toContain("/api/ready");
    expect(monitors).toContain("/api/ops/dlq");
  });

  it("the monitor block warns that a non-200 check on health cannot see the database", () => {
    expect(monitorBlock()).toMatch(/恒回 200|恒为 200|别拿它当 DB/);
  });
});
