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

/** 某个文件里的 LIKE 前缀名单(这个清道夫扫哪些 refId)。 */
function prefixesInReaperFile(file: string): Set<string> {
  const src = fs.readFileSync(file, "utf8");
  return new Set([...src.matchAll(/LIKE '([a-z0-9-]+):%'/g)].map((match) => match[1]!));
}

/** 清道夫 SQL 里的 LIKE 前缀名单。 */
function prefixesInReaper(): Set<string> {
  return prefixesInReaperFile(REAPER_FILE);
}

/**
 * **有专属清道夫的前缀** —— 不在这个 LLM 清道夫的 LIKE 名单里,但绝不是没人扫。
 *
 * 登记而不是直接加进上面那份名单,是因为这个清道夫的退款带着 approval-card 的收口语义
 * (第 2、3 遍要去把卡片改成 failed)。理解那条链路根本没有卡片,借它的名单等于借它的语义 ——
 * 一次错误的耦合。所以前缀各归各的清道夫,而这张表负责让守卫仍然咬得住:登记一条,
 * 就必须在它点名的文件里**真的**找得到那句 `LIKE '<前缀>:%'`,否则这条登记就是一句空话。
 */
const DEDICATED_REAPERS: Record<string, string> = {
  // MONEY-A9(2026-09-01):素材理解从「平台自己付」变成按件计费,于是这条链路也会漏 hold。
  understanding: "apps/worker/src/jobs/understand.ts", // reapStaleUnderstandingReservations
};

/**
 * **刻意没有清道夫的前缀** —— 而且任何清道夫都不许去扫它们(MONEY-A14,2026-09-02)。
 *
 * `manual-refund:` 的 hold 是一张人工退款单的**前半段**:credits 先被锁死,钱才允许离开
 * Stripe。Stripe 把退款收成 `pending` 的时候,这个 hold 必须原样留着等人来收口 ——
 * 一个「60 分钟没收口就退回去」的通用巡检在这里的后果是**平台双付**:hold 被退还给商家,
 * Stripe 随后把同一笔钱也退了。
 *
 * 所以这条前缀的收口只有两个出口:`completeManualRefund`(重读 Stripe 状态后落账或释放),
 * 或者人按 runbook 处置。它不是「漏登记」,是「登记为不许碰」—— 下面那条测试逐个清道夫
 * 文件去核实这句话是真的。
 */
const NEVER_REAPED: Record<string, string> = {
  "manual-refund": "MONEY-A14 人工退款:pending 期间 hold 必须留着,自动退回 = 平台双付",
};

/** 所有会扫台账的清道夫文件 —— 新增一个就往这里加一行,守卫据此逐个核实。 */
const REAPER_FILES = [
  "apps/worker/src/jobs/llm-reservation-reaper.ts",
  "apps/worker/src/jobs/understand.ts",
];

describe("reaper prefix coverage — every prefixed refId in the codebase is reaped", () => {
  const inSource = prefixesInSource();
  const inReaper = prefixesInReaper();

  it("每条「专属清道夫」登记都必须在它点名的文件里真的扫那个前缀(登记不许是空话)", () => {
    for (const [prefix, file] of Object.entries(DEDICATED_REAPERS)) {
      const swept = prefixesInReaperFile(path.join(REPO_ROOT, file));
      expect(
        swept.has(prefix),
        `DEDICATED_REAPERS 说 "${prefix}:" 由 ${file} 扫,但那个文件里没有 LIKE '${prefix}:%' —— ` +
          `要么那个清道夫没写/被删了,要么这条登记该撤。任何一种,那个前缀现在都没人扫。`,
      ).toBe(true);
      expect(
        inReaper.has(prefix),
        `"${prefix}:" 同时在两个清道夫的名单里 —— 一笔漏掉的预扣会被退两次判断、` +
          `两条恢复语义混在一起。只留一个。`,
      ).toBe(false);
    }
  });

  it("scanner sanity: finds the known prefixes (a broken regex must not green-wash)", () => {
    for (const known of ["otto-stream", "otto-turn", "research"]) {
      expect([...inSource.keys()], `expected the scanner to find "${known}:"`).toContain(known);
    }
    expect(inReaper.size).toBeGreaterThanOrEqual(5);
  });

  /**
   * **死前缀已经删掉**(钱引擎⑤B,2026-09-02)。
   *
   * `brand-research` 随 2026-07-04 的死 pre-Otto 模块下架,`draft`/`enhance` 随 2026-07-07
   * 的死付费 cowork 端点下架 —— 从那以后仓库里没有任何一处再用它们 reserve 过。一条永远
   * 匹配不到的 LIKE 不是安全网,它是三行扫描成本 + 一句「这里有清道夫在看着」的错觉。
   *
   * 这条用例钉的是**双向**的:名单里没有它们,而且源码里也确实没人再写它们 —— 哪天有人
   * 重新启用其中一个前缀去 reserve,上面那条「every source prefix is swept」会当场红,
   * 逼他要么进名单要么登记。历史遗留行由日账本守恒检测器暴露(ledger-conservation.ts)。
   */
  it("死前缀(brand-research / draft / enhance)已从名单删除,而且源码里确实没人再写", () => {
    for (const dead of ["brand-research", "draft", "enhance"]) {
      expect(inReaper.has(dead), `"${dead}:" 还在清道夫的 LIKE 名单里 —— 没人写它,扫它是白扫`).toBe(false);
      expect([...inSource.keys()], `源码又开始写 "${dead}:" 了 —— 那它必须重新进某个清道夫`).not.toContain(dead);
    }
  });

  it("MONEY-A14:登记为「不许碰」的前缀,没有任何一个清道夫在扫它", () => {
    for (const [prefix, why] of Object.entries(NEVER_REAPED)) {
      for (const file of REAPER_FILES) {
        expect(
          prefixesInReaperFile(path.join(REPO_ROOT, file)).has(prefix),
          `${file} 扫了 "${prefix}:" —— 这条前缀登记为不许自动收口(${why})。` +
            `把它从那个清道夫的 LIKE 名单里拿掉,或者先去改这条登记(那要先想清楚双付怎么办)。`,
        ).toBe(false);
      }
      expect(prefix in DEDICATED_REAPERS, `"${prefix}:" 不能同时登记成「有专属清道夫」和「不许碰」`).toBe(false);
    }
  });

  it("every source prefix is swept by SOME reaper (a miss locks credits forever)", () => {
    for (const [prefix, files] of inSource) {
      expect(
        inReaper.has(prefix) || prefix in DEDICATED_REAPERS || prefix in NEVER_REAPED,
        `refId prefix "${prefix}:" (used in ${files.join(", ")}) is NOT in the reaper's LIKE list ` +
          `(apps/worker/src/jobs/llm-reservation-reaper.ts) and has no entry in DEDICATED_REAPERS ` +
          `or NEVER_REAPED. ` +
          `A crash between reserve and settle would leak that reservation FOREVER — add the prefix ` +
          `to the reaper, or give it a reaper of its own and register it here.`,
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
// ⚠️ 适用范围:这一组钉的是**按台账找漏**的第 1、2 遍 —— 只有那一轮真的预扣过才会命中。
// 对话按用量收费(OTTO_CONVERSATION_TURN_MARGIN = 1.05)时恢复轮会预扣,所以生产里的 approve
// 正走这两遍;不预扣的 refId 家族(fixture no-charge,以及将来任何按 0 定价的面)则由第 3 遍
// (卡片状态)兜底,它自己的 case 在本文件末尾。
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

// ── 第 3 遍(兜底):台账上没有钥匙的时候,靠**卡片状态**救援搁浅的批准卡 ─────────────────────
//
// 第 1、2 遍全都以恢复轮那一行 RESERVE 为钥匙。不预扣的 refId 家族(fixture no-charge,以及
// 将来任何按 0 定价的面)不会有那一行,那两遍就彻底不命中。留下的洞:商家点了批准,进程死在
// 跑的中间(部署 / OOM),ottoApprove 里那段活的 catch 一次都没机会跑,卡片就永远停在
// "Approved" —— 而 CAS 让它再也点不动(同意书单向)。
//
// 第 3 遍换一种证据回答同一个问题:**同意书被花掉之后,这场对话有没有继续动过**。
// 跑完的那一轮一定会往线程里写东西(回复 / 追加的卡 / 用尽轮次的说明 / 进程内失败的说明);
// 进程死了则一个字都不会写。所以「claim 之后没有新消息」= 这张卡是漏的。把救援钉在卡片而不是
// 价钱上,它就能扛住任何一次重新定价 —— 两个方向都能。
describe("the card-state pass retires a stranded approve with no ledger row", () => {
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

  it("asks only about messages created AFTER the consent was spent, in this card's own thread", async () => {
    const approvedAt = longAgo();
    scans([], [], [{ ...CARD, approvedAt }]);
    cardReads({ payload: { toolName: "x", ref: "r", status: "approved" } });

    await reapStaleLlmReservations();

    const threadRead = m.chatMessageFindFirst.mock.calls
      .map(([a]) => a as { where: Record<string, unknown> })
      .find((a) => a.where.threadId !== undefined)!;
    expect(threadRead.where).toMatchObject({ threadId: CARD.threadId, ownerId: CARD.orgId });
    // 判官 r2 P2-①:两个时钟。`approvedAt` 是 web 进程盖的章,`createdAt` 是 Postgres 盖的。
    // web 快了的时候,claim 之后那条消息会显得「更早」,证据就丢了,一张跑成功的卡会被判失败。
    // 探针因此往前放宽 5 秒 —— 只补这一个方向;另一个方向本来就只会让它少扫,那是安全的一侧。
    expect(threadRead.where.createdAt).toEqual({ gt: new Date(Date.parse(approvedAt) - 5000) });
    // 卡片本身也是这条线程里的一条消息。放宽之后它会把自己认成「后来的消息」—— 于是**手快的
    // 商家**(卡出现 5 秒内就点批准)那张卡永远扫不到。跑之前就存在的行不可能是「跑下去了」的证据。
    expect(threadRead.where.id).toEqual({ not: CARD.cardId });
  });

  it("the grace boundary: a message just BEFORE the stamp still counts, one well before does not", async () => {
    const approvedAtMs = Date.now() - 3 * HOUR_MS;
    const approvedAt = new Date(approvedAtMs).toISOString();

    // ① 落在放宽窗口内(web 时钟快了 2 秒的样子)—— 算证据,卡不动。
    scans([], [], [{ ...CARD, approvedAt }]);
    cardReads({ payload: { toolName: "x", ref: "r", status: "approved" } }, { id: "reply-skewed" });
    await reapStaleLlmReservations();
    expect(m.chatMessageUpdateMany).not.toHaveBeenCalled();

    // ② 窗口之外(真的是 claim 之前的旧消息)—— 不算证据,卡收口。
    // 探针的 where 就是这条界线:findFirst 只会返回符合 gt 的行,所以「窗口之外」= 查不到。
    vi.clearAllMocks();
    scans([], [], [{ ...CARD, approvedAt }]);
    cardReads({ payload: { toolName: "x", ref: "r", status: "approved" } }, null);
    await reapStaleLlmReservations();
    expect(m.chatMessageUpdateMany).toHaveBeenCalledTimes(1);
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

// ── 三遍并存:钥匙不同,收口是同一个 ──────────────────────────────────────────────────────
//
// 对话按用量收费之后,同一张卡可能被第 1 遍(有 RESERVE 行)和第 3 遍(卡片状态)同时看见。
// 两遍走的是同一条收口路径 retireApprovalCard —— 同一个 CAS,钉在 `status = "approved"` 上 ——
// 所以先到的那一遍赢,后到的那一遍是 no-op。这里钉的就是「重叠不会写两次、也不需要谁先谁后」。
import { OTTO_CONVERSATION_TURN_MARGIN, OTTO_MAX_STEPS, llmPricesFor, turnBudgetInternal } from "@fikirtive/core";

describe("passes 1 and 3 can see the SAME card, and retiring it stays exactly-once", () => {
  const REF = "otto-approve:thread-x:card-x:a1";

  it("today's priced turn really does reserve — so pass 1 is the live路径, not a museum piece", () => {
    // 这就是 meter 里 llmHoldInternal 走的那道算术,用生产的价钱与步数问一遍。
    expect(turnBudgetInternal(llmPricesFor("claude-sonnet-4-6"), OTTO_CONVERSATION_TURN_MARGIN, OTTO_MAX_STEPS))
      .toBeGreaterThan(0);
  });

  it("one card found by BOTH passes is CAS'd once — the second write is refused by the same guard", async () => {
    // 第 1 遍拿到它(有未结算的 RESERVE),第 3 遍也拿到它(卡还 approved、线程没动过)。
    scans(
      [{ orgId: "o1", refId: REF }],
      [],
      [{ orgId: "o1", cardId: "card-x", threadId: "thread-x", approvedAt: longAgo() }],
    );
    // 第一次读到 approved(第 1 遍收口),之后读到 failed —— 真库里 CAS 之后就是这样。
    let cardReadCount = 0;
    m.chatMessageFindFirst.mockImplementation((args: { where?: Record<string, unknown> }) => {
      if (args?.where?.threadId !== undefined) return Promise.resolve(null); // 线程没动过
      cardReadCount += 1;
      return Promise.resolve({
        payload: { toolName: "generateReferences", ref: "e1", status: cardReadCount === 1 ? "approved" : "failed" },
      });
    });

    const n = await reapStaleLlmReservations();

    expect(n).toBe(1); // 第 1 遍退了那笔钱
    // 卡只被写了一次:第 3 遍再来时读到的已经是 failed,连 updateMany 都不会发出去。
    expect(m.chatMessageUpdateMany).toHaveBeenCalledTimes(1);
    const [args] = m.chatMessageUpdateMany.mock.calls[0]! as [{
      where: { id: string; AND: unknown[] };
      data: { payload: Record<string, unknown> };
    }];
    expect(args.where.id).toBe("card-x");
    // 而且**即使**两遍都发出去,守门的也是同一个 CAS —— 钉在 approved 上,只可能赢一次。
    expect(args.where.AND).toEqual([{ payload: { path: ["status"], equals: "approved" } }]);
    expect(args.data.payload).toMatchObject({ status: "failed", chargeVerdict: "unknown" });
  });

  it("with no ledger row at all, pass 3 alone still retires it", async () => {
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
