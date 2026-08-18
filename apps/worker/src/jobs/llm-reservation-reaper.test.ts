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
  // #524 r6: the reaper now also retires the approval card a leaked approve-reservation belonged to.
  const chatMessageFindFirst = vi.fn();
  const chatMessageUpdateMany = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    $queryRaw: queryRaw,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    chatMessage: { findFirst: chatMessageFindFirst, updateMany: chatMessageUpdateMany },
  };
  return { prisma, queryRaw, refundReservation, chatMessageFindFirst, chatMessageUpdateMany };
});

const HOUR_MS = 1000 * 60 * 60;
/** Long enough ago to be outside the reaper's stale window, in the ISO form the claim writes. */
const longAgo = (): string => new Date(Date.now() - 3 * HOUR_MS).toISOString();

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation }));

import { reapStaleLlmReservations } from "./llm-reservation-reaper.js";

/**
 * Answer the reaper's two scans separately (#524 r8): pass 1 sweeps unfinalized holds, pass 2
 * sweeps approval cards our OWN earlier refund left stranded. They ask different questions of
 * the same table, so a single canned answer would feed pass 2 pass 1's rows.
 */
/** The refund this reaper asks for. `reason` labels the REFUND row so pass 2 can recognise its
 *  own work later — a REFUND alone does not say who wrote it. */
const REFUND_ARGS = (orgId: string, refId: string) => ({
  orgId,
  refId,
  reason: "llm-reservation-reaper",
});

function scans(leaked: unknown[], orphanCards: unknown[] = [], approvedCards: unknown[] = []): void {
  m.queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const sql = Array.from(strings).join("?");
    if (sql.includes("NOT EXISTS")) return Promise.resolve(leaked); // pass 1: unfinalized holds
    if (sql.includes(`f."kind" = 'REFUND'`)) return Promise.resolve(orphanCards); // pass 2: our own refunds
    if (sql.includes("approvedAt")) return Promise.resolve(approvedCards); // pass 3: card state
    throw new Error(`unrouted reaper scan — a new pass needs a route here:\n${sql}`);
  });
}

/**
 * Route the two DIFFERENT reads that go through `chatMessage.findFirst`: the retirement path reads
 * the card by id, and pass 3 asks whether anything landed in the thread after the claim. Routing
 * on the shape of the WHERE keeps a test from accidentally answering one with the other's row —
 * which is how a sweep that never ran would still look green.
 */
function cardReads(card: unknown, laterMessage: unknown = null): void {
  m.chatMessageFindFirst.mockImplementation((args: { where?: Record<string, unknown> }) =>
    Promise.resolve(args?.where?.threadId !== undefined ? laterMessage : card),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.chatMessageFindFirst.mockResolvedValue(null);
  m.chatMessageUpdateMany.mockResolvedValue({ count: 1 });
  // #524 r8: refundReservation reports which finalizer won. "refunded" = this sweep took the
  // money back itself, the only answer that licenses touching the card.
  m.refundReservation.mockResolvedValue("refunded");
});

describe("reapStaleLlmReservations (F03)", () => {
  it("refunds each leaked LLM reservation the query returns", async () => {
    scans([
      { orgId: "o1", refId: "otto-turn:t1:5" },
      { orgId: "o2", refId: "brand-research:abc" },
    ]);
    const n = await reapStaleLlmReservations();
    expect(n).toBe(2);
    expect(m.refundReservation).toHaveBeenCalledTimes(2);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), REFUND_ARGS("o1", "otto-turn:t1:5"));
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), REFUND_ARGS("o2", "brand-research:abc"));
  });

  it("no-ops when the query finds no leaked reservations", async () => {
    scans([]);
    const n = await reapStaleLlmReservations();
    expect(n).toBe(0);
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("reaps leaked research: reservations (worker crash between reserve and settle)", async () => {
    // The prefix allowlist in the raw SQL MUST include research:% — otherwise a mid-research
    // worker crash strands the user's reserved credits forever (no finalizer, no reaper).
    scans([{ orgId: "o3", refId: "research:card-9" }]);
    const n = await reapStaleLlmReservations();
    expect(n).toBe(1);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), REFUND_ARGS("o3", "research:card-9"));
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
    // 'brand-research' was dropped 2026-07-04 with the dead pre-Otto module; 'draft'/'enhance'
    // were dropped 2026-07-07 with the dead paid cowork endpoints (batch-3 7-10). The reaper
    // still lists those prefixes (harmless — sweeps any historical leaked rows) but source no
    // longer builds them.
    for (const known of ["otto-stream", "otto-turn", "research"]) {
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

// ── #524 r6(判官 r5 P1-A'②①):漏掉的那一半 —— 卡片 ────────────────────────────────
//
// `withLlmBudget` 在**扣了钱之后、模型跑之前**吃掉商家那张一次性同意书。进程死在这个窗口里,
// 卡片就停在 `approved`,而那件事一步都没发生 —— 同意书是单向的,商家既退不回也点不动。
// 清道夫本来就要来退这笔钱;r6 让它顺手把卡片一起收口。
//
// ⚠️ 适用范围(Founder 2026-08-18 之后必须读这段):这一组钉的是**按台账找漏**的第 1、2 遍,
// 它们只在那一轮**真的预扣过**的时候才会命中。对话现在免费(OTTO_CONVERSATION_TURN_MARGIN = 0),
// 恢复轮不写 RESERVE 行,所以**今天的 approve 一行都进不了这两遍**——下面每个 case 里的
// `scans([...])` 都是手工喂的行,不代表生产里还会出现。今天那条路由第 3 遍(卡片状态)兜底,
// 它自己的 case 在本文件末尾。这两遍留着是因为付费 refId(research,以及将来重新定价的对话)
// 仍然走它们。
describe("#524 r6 — a leaked PRICED approve reservation also retires its approval card", () => {
  const APPROVE_REF = "otto-approve:thread-9:card-9:a2";

  it("moves the card approved → failed, in the SAME tenant scope, and never claims a zero it did not check", async () => {
    scans([{ orgId: "o1", refId: APPROVE_REF }]);
    m.chatMessageFindFirst.mockResolvedValue({ payload: { toolName: "generateReferences", ref: "e1", status: "approved" } });

    const n = await reapStaleLlmReservations();

    expect(n).toBe(1);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), REFUND_ARGS("o1", APPROVE_REF));
    const [args] = m.chatMessageUpdateMany.mock.calls[0]! as [{
      where: { id: string; ownerId: string; kind: string; AND: unknown[] };
      data: { payload: Record<string, unknown> };
    }];
    expect(args.where).toMatchObject({ id: "card-9", ownerId: "o1", kind: "APPROVAL_CARD" });
    // CAS-pinned on `approved`: a card a live run has since resolved is never rewritten.
    expect(args.where.AND).toEqual([{ payload: { path: ["status"], equals: "approved" } }]);
    expect(args.data.payload).toMatchObject({ status: "failed", chargeVerdict: "unknown" });
    // An hour later nothing can prove the approved tool did not already pay for a generation.
    expect(args.data.payload.chargeVerdict).not.toBe("zero");
  });

  it("leaves a card that is NOT approved alone — rejected / expired / already failed are other people's answers", async () => {
    scans([{ orgId: "o1", refId: APPROVE_REF }]);
    for (const status of ["pending", "rejected", "expired", "failed"]) {
      m.chatMessageUpdateMany.mockClear();
      m.chatMessageFindFirst.mockResolvedValue({ payload: { toolName: "x", ref: "r", status } });
      await reapStaleLlmReservations();
      expect(m.chatMessageUpdateMany, status).not.toHaveBeenCalled();
    }
  });

  it("touches no card for a reservation that is not an approve — a turn/stream leak has none", async () => {
    scans([
      { orgId: "o1", refId: "otto-turn:msg-1" },
      { orgId: "o2", refId: "research:card-3" },
    ]);
    const n = await reapStaleLlmReservations();
    expect(n).toBe(2);
    expect(m.chatMessageFindFirst).not.toHaveBeenCalled();
    expect(m.chatMessageUpdateMany).not.toHaveBeenCalled();
  });

  it("a card write that fails never stops the sweep — the money is already correct", async () => {
    scans([
      { orgId: "o1", refId: APPROVE_REF },
      { orgId: "o2", refId: "otto-turn:msg-2" },
    ]);
    m.chatMessageFindFirst.mockRejectedValue(new Error("card read exploded"));

    const n = await reapStaleLlmReservations();

    expect(n).toBe(2);
    expect(m.refundReservation).toHaveBeenCalledTimes(2); // the queue behind it still drained
  });
});

// ── #524 r8(判官 r7 P1):退款结果决定卡片,不是「走到这一行」决定卡片 ──────────────────
//
// 扫描与退款是两条语句,中间活着的执行可以落 SETTLE。r7 的退款返回 void,清道夫无从分辨
// 「我退了钱」和「别人已结算」,于是照样把一张成功终态的卡 CAS 成 failed —— 商家看着成功变失败。
// 真库证据在 llm-reservation-reaper-finality.test.ts;这里钉的是分路本身。
describe("#524 r8 — only the reaper's OWN refund licenses a card write", () => {
  const APPROVE_REF = "otto-approve:thread-7:card-7:a1";

  beforeEach(() => {
    m.chatMessageFindFirst.mockResolvedValue({ payload: { toolName: "x", ref: "r", status: "approved" } });
  });

  it("touches no card when a live execution settled first — that card is a success", async () => {
    scans([{ orgId: "o1", refId: APPROVE_REF }]);
    m.refundReservation.mockResolvedValue("already-settled");

    const n = await reapStaleLlmReservations();

    expect(n).toBe(0); // nothing leaked here — someone finalized it
    expect(m.chatMessageUpdateMany).not.toHaveBeenCalled();
  });

  it("touches no card in pass 1 for a refund it did not write — pass 2 owns that decision", async () => {
    scans([{ orgId: "o1", refId: APPROVE_REF }]);
    m.refundReservation.mockResolvedValue("already-refunded");

    const n = await reapStaleLlmReservations();

    expect(n).toBe(0);
    expect(m.chatMessageUpdateMany).not.toHaveBeenCalled();
  });

  it("retires the card pass 2 finds, with no second refund", async () => {
    // Pass 1 finds nothing (the REFUND already exists, so the NOT EXISTS filter skips it forever);
    // pass 2 finds the card that refund never got to fix.
    scans([], [{ orgId: "o1", refId: APPROVE_REF }]);

    const n = await reapStaleLlmReservations();

    expect(n).toBe(0);
    expect(m.refundReservation).not.toHaveBeenCalled();
    const [args] = m.chatMessageUpdateMany.mock.calls[0]! as [{
      where: { id: string; ownerId: string };
      data: { payload: Record<string, unknown> };
    }];
    expect(args.where).toMatchObject({ id: "card-7", ownerId: "o1" });
    expect(args.data.payload).toMatchObject({ status: "failed", chargeVerdict: "unknown" });
  });

  it("asks pass 2 only for cards its own refund label left behind", async () => {
    scans([]);
    await reapStaleLlmReservations();
    const passTwoSql = (m.queryRaw.mock.calls[1]![0] as string[]).join("");
    expect(passTwoSql).toContain(`f."reason" =`);
    expect(passTwoSql).toContain(`c."payload"->>'status' = 'approved'`);
  });
});

// ── Founder 2026-08-18(判官 P1):对话免费之后,漏掉的批准卡靠**卡片状态**兜底 ─────────────
//
// 裁决把对话价钱设成 0,恢复轮于是不再预扣、不再落 RESERVE 行 —— 而第 1、2 遍全都以那一行为
// 钥匙。它们不是变松了,是对 approve **彻底不再命中**。留下的洞:商家点了批准,进程死在跑的
// 中间(部署 / OOM),ottoApprove 里那段活的 catch 一次都没机会跑,卡片就永远停在
// "Approved" —— 而 CAS 让它再也点不动(同意书单向)。
//
// 第 3 遍换一种证据回答同一个问题:**同意书被花掉之后,这场对话有没有继续动过**。
// 跑完的那一轮一定会往线程里写东西(回复 / 追加的卡 / 用尽轮次的说明 / 进程内失败的说明);
// 进程死了则一个字都不会写。所以「claim 之后没有新消息」= 这张卡是漏的。
describe("Founder 2026-08-18 — the card-state pass retires a stranded approve with no ledger row", () => {
  const CARD = { orgId: "o1", cardId: "card-free-1", threadId: "thread-free-1" };

  it("stale `approved` card, nothing happened in the thread since → retired, with no refund at all", async () => {
    // 没有任何台账行 —— 这正是免费一轮留下的状态。
    scans([], [], [{ ...CARD, approvedAt: longAgo() }]);
    cardReads({ payload: { toolName: "generateReferences", ref: "e1", status: "approved" } });

    const n = await reapStaleLlmReservations();

    expect(n).toBe(0); // 这一遍不动钱
    expect(m.refundReservation).not.toHaveBeenCalled();
    const [args] = m.chatMessageUpdateMany.mock.calls[0]! as [{
      where: { id: string; ownerId: string; kind: string; AND: unknown[] };
      data: { payload: Record<string, unknown> };
    }];
    expect(args.where).toMatchObject({ id: CARD.cardId, ownerId: CARD.orgId, kind: "APPROVAL_CARD" });
    // 与前两遍同一条收口路径:CAS 钉在 approved 上,终态 failed,钱的结论只敢说 unknown。
    expect(args.where.AND).toEqual([{ payload: { path: ["status"], equals: "approved" } }]);
    expect(args.data.payload).toMatchObject({ status: "failed", chargeVerdict: "unknown" });
    expect(args.data.payload.chargeVerdict).not.toBe("zero");
  });

  it("a card whose thread MOVED ON is never touched — that run finished and the merchant got it", async () => {
    // 这是这一遍唯一不能犯的错:把一张成功的卡判成失败。
    scans([], [], [{ ...CARD, approvedAt: longAgo() }]);
    cardReads(
      { payload: { toolName: "generateReferences", ref: "e1", status: "approved" } },
      { id: "reply-1" }, // claim 之后线程里有新消息 = 那一轮跑完并落了回复
    );

    await reapStaleLlmReservations();

    expect(m.chatMessageUpdateMany).not.toHaveBeenCalled();
  });

  it("asks only about messages created AFTER the consent was spent", async () => {
    const approvedAt = longAgo();
    scans([], [], [{ ...CARD, approvedAt }]);
    cardReads({ payload: { toolName: "x", ref: "r", status: "approved" } });

    await reapStaleLlmReservations();

    const threadRead = m.chatMessageFindFirst.mock.calls
      .map(([a]) => a as { where: Record<string, unknown> })
      .find((a) => a.where.threadId !== undefined)!;
    expect(threadRead.where).toMatchObject({ threadId: CARD.threadId, ownerId: CARD.orgId });
    expect(threadRead.where.createdAt).toEqual({ gt: new Date(Date.parse(approvedAt)) });
  });

  it("a FRESH approve is left alone — a run inside the stale window may still be talking", async () => {
    scans([], [], [{ ...CARD, approvedAt: new Date().toISOString() }]);
    cardReads({ payload: { toolName: "x", ref: "r", status: "approved" } });

    await reapStaleLlmReservations();

    // 连「线程动过没有」都不该问:年龄这一关就没过。
    expect(m.chatMessageFindFirst).not.toHaveBeenCalled();
    expect(m.chatMessageUpdateMany).not.toHaveBeenCalled();
  });

  it("an unparseable or missing stamp stands the sweep down instead of guessing", async () => {
    for (const approvedAt of ["not-a-date", ""]) {
      vi.clearAllMocks();
      scans([], [], [{ ...CARD, approvedAt }]);
      cardReads({ payload: { toolName: "x", ref: "r", status: "approved" } });
      await reapStaleLlmReservations();
      expect(m.chatMessageUpdateMany, approvedAt).not.toHaveBeenCalled();
    }
  });

  it("scans APPROVAL_CARDs on their own claim stamp — not on any ledger row", async () => {
    scans([], [], []);
    await reapStaleLlmReservations();
    const passThreeSql = (m.queryRaw.mock.calls[2]![0] as string[]).join("");
    expect(passThreeSql).toContain(`c."kind" = 'APPROVAL_CARD'`);
    expect(passThreeSql).toContain(`c."payload"->>'status' = 'approved'`);
    expect(passThreeSql).toContain("approvedAt");
    // 关键:这一遍一个台账表都不碰,否则它就继承了第 1、2 遍那把不再存在的钥匙。
    expect(passThreeSql).not.toContain("CreditLedger");
  });
});

// ── P1 端到端(单元层):免费一轮 → 没有 RESERVE 行 → 第 3 遍仍然收口 ─────────────────────
//
// 前两遍与这一遍分别测过之后,还差一句把它们连起来的话:**今天真实的那条路**上,恢复轮的
// 预扣确实是 0(所以台账上什么都没有),而卡片仍然被收口。缺了这一句,两组绿灯各自成立,
// 中间那道缝(判官发现的那个)照样绿。
import { OTTO_CONVERSATION_TURN_MARGIN, OTTO_MAX_STEPS, llmPricesFor, turnBudgetInternal } from "@fikirtive/core";

describe("Founder 2026-08-18 — a free approve leaves no ledger row, and is still recovered", () => {
  it("the resume turn's hold really is 0 at live prices — so passes 1 and 2 have nothing to find", () => {
    // 这就是 meter 里 llmHoldInternal 走的那道算术,用生产的价钱与步数问一遍。
    expect(turnBudgetInternal(llmPricesFor("claude-sonnet-4-6"), OTTO_CONVERSATION_TURN_MARGIN, OTTO_MAX_STEPS)).toBe(0);
  });

  it("with ZERO ledger rows anywhere, the stranded card is still retired", async () => {
    // 第 1、2 遍都空手而归(生产里就是这样:免费一轮不落任何行),第 3 遍照样把卡收口。
    scans([], [], [{ orgId: "o9", cardId: "card-9", threadId: "thread-9", approvedAt: longAgo() }]);
    cardReads({ payload: { toolName: "approveScheduledPost", ref: "sp1", status: "approved" } });

    const n = await reapStaleLlmReservations();

    expect(n).toBe(0);
    expect(m.refundReservation).not.toHaveBeenCalled();
    expect(m.chatMessageUpdateMany).toHaveBeenCalledTimes(1);
    const [args] = m.chatMessageUpdateMany.mock.calls[0]! as [{ where: { id: string }; data: { payload: Record<string, unknown> } }];
    expect(args.where.id).toBe("card-9");
    expect(args.data.payload).toMatchObject({ status: "failed", chargeVerdict: "unknown" });
  });
});
