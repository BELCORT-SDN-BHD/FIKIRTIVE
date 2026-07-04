/**
 * llm-reservation-reaper.test.ts — F03: Otto LLM credit reservations (withLlmBudget)
 * are reserved BEFORE the LLM call and settled/refunded after. Process death (deploy
 * SIGKILL, OOM, crash) between reserve and settle leaks the hold forever — there is no
 * job row for the gen/refgen reapers to key on. reapStaleLlmReservations sweeps RESERVE
 * rows with an Otto/LLM refId prefix, older than the stale window, that never got a
 * SETTLE/REFUND finalizer, and refunds them. refundReservation is idempotent + mutually
 * exclusive with SETTLE via the finalizer unique index, so it's a safe no-op on a race.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const queryRaw = vi.fn();
  const refundReservation = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    $queryRaw: queryRaw,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma, queryRaw, refundReservation };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation }));

import { reapStaleLlmReservations } from "./llm-reservation-reaper.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reapStaleLlmReservations (F03)", () => {
  it("refunds each leaked LLM reservation the query returns", async () => {
    m.queryRaw.mockResolvedValue([
      { orgId: "o1", refId: "otto-turn:t1:5" },
      { orgId: "o2", refId: "brand-research:abc" },
    ]);
    const n = await reapStaleLlmReservations();
    expect(n).toBe(2);
    expect(m.refundReservation).toHaveBeenCalledTimes(2);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "otto-turn:t1:5" });
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o2", refId: "brand-research:abc" });
  });

  it("no-ops when the query finds no leaked reservations", async () => {
    m.queryRaw.mockResolvedValue([]);
    const n = await reapStaleLlmReservations();
    expect(n).toBe(0);
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("reaps leaked research: reservations (worker crash between reserve and settle)", async () => {
    // The prefix allowlist in the raw SQL MUST include research:% — otherwise a mid-research
    // worker crash strands the user's reserved credits forever (no finalizer, no reaper).
    m.queryRaw.mockResolvedValue([{ orgId: "o3", refId: "research:card-9" }]);
    const n = await reapStaleLlmReservations();
    expect(n).toBe(1);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o3", refId: "research:card-9" });
    // Assert the SQL template itself carries the research:% prefix (proves it's actually reaped,
    // not just that the loop refunds whatever the query returns).
    const sqlParts = (m.queryRaw.mock.calls[0]![0] as string[]).join("");
    expect(sqlParts).toContain("research:%");
  });
});

// ── 前缀覆盖守卫(审计 2026-07-04 补):名单靠手写,漏加一条 = 永久锁死客户额度 ──
// 上面的 mock 测试只证明"循环会退款查询返回的行",不证明"SQL 名单覆盖了所有前缀"。
// 这里 fs 扫全仓源码里所有 `xxxRefId = `prefix:…`` 形态的构造,断言每个前缀都在
// 清道夫的 LIKE 名单里 —— 新加付费点忘了同步名单,这个测试立刻红。
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const REAPER_FILE = path.join(REPO_ROOT, "apps/worker/src/jobs/llm-reservation-reaper.ts");
const SCAN_ROOTS = ["apps/web/app", "apps/web/lib", "apps/worker/src", "packages"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "generated", "__tests__"]);

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...tsFiles(path.join(dir, entry.name)));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** 源码里构造的所有带前缀 refId(`refId = `prefix:…`` / `fooRefId: `prefix:…``)→ 文件清单。 */
function prefixesInSource(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const root of SCAN_ROOTS) {
    for (const file of tsFiles(path.join(REPO_ROOT, root))) {
      const src = fs.readFileSync(file, "utf8");
      for (const match of src.matchAll(/\w*[Rr]efId\s*[:=]\s*`([a-z0-9-]+):/g)) {
        const prefix = match[1]!;
        found.set(prefix, [...(found.get(prefix) ?? []), path.relative(REPO_ROOT, file)]);
      }
    }
  }
  return found;
}

/** 清道夫 SQL 里的 LIKE 前缀名单。 */
function prefixesInReaper(): Set<string> {
  const src = fs.readFileSync(REAPER_FILE, "utf8");
  return new Set([...src.matchAll(/LIKE '([a-z0-9-]+):%'/g)].map((match) => match[1]!));
}

describe("reaper prefix coverage — every prefixed refId in the codebase is reaped", () => {
  const inSource = prefixesInSource();
  const inReaper = prefixesInReaper();

  it("scanner sanity: finds the known prefixes (a broken regex must not green-wash)", () => {
    for (const known of ["otto-stream", "otto-turn", "brand-research", "draft", "enhance", "research"]) {
      expect([...inSource.keys()], `expected the scanner to find "${known}:"`).toContain(known);
    }
    expect(inReaper.size).toBeGreaterThanOrEqual(8);
  });

  it("every source prefix is in the reaper's LIKE list (a miss locks credits forever)", () => {
    for (const [prefix, files] of inSource) {
      expect(
        inReaper.has(prefix),
        `refId prefix "${prefix}:" (used in ${files.join(", ")}) is NOT in the reaper's LIKE list ` +
          `(apps/worker/src/jobs/llm-reservation-reaper.ts). A crash between reserve and settle would ` +
          `leak that reservation FOREVER — add the prefix to the reaper (or consciously handle recovery).`,
      ).toBe(true);
    }
  });
});
