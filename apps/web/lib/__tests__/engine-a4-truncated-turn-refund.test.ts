/**
 * ENGINE-A4 —— **截断且零交付的一轮全额退款**,在真库上证
 * (规格 `docs/specs/otto-engine.md` §2 验收表 ENGINE-A4、S2 §7.2⑤,Founder S1 九问 1② 裁决)。
 *
 * 验收行的原话:「商家的对话轮被截断且无任何交付 → 该轮全额退款;消费历史可见对应退款行」。
 * 两个半句要两种证据,所以这份测试两样都做:
 *   · **账本**:真 Postgres(*_test)、真 Prisma、真 CreditLedger、真 `withLlmBudget` ——
 *     reserve/refund **成对**,余额净变 0,`reserved` 归零。不是 spy 被调过,是钱真的回来了。
 *   · **消费历史**:同一批账本行喂进 `buildSpendHistory`(/billing 与 Otto `readSpending` 共用
 *     的那一个纯函数),商家读到的那一行必须是「Held, then refunded in full」、净变 0。
 *
 * 还钉住这条改动的**边界**:有交付的截断轮**照旧按实结算**。模型确实替商家做出了东西
 * (铸出的卡片、落盘的写动作),那一轮不是白跑,退它才是错的。
 *
 * 为什么零调用真模型:被测的是**判词与账本**,不是模型。`fn` 直接抛一个带着 RunState 的
 * 截断错误 —— 那正是 SDK 跑满步数时抛的形状,而判词读的就是它。
 */
import { describe, expect, it, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { OTTO_CHAT_MAX_SEARCHES_PER_TURN, displayCredits, searchUnitChargeInternal } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import { withLlmBudget, ottoBudgetArgsFor, ottoInteractiveRuntime, type OttoContext } from "@fikirtive/otto";
import { buildSpendHistory, type SpendLedgerRow } from "../spend-history";

/** 这一门的替身截断错误。`ottoBudgetArgsFor` 的第四个参数就是「哪个类算截断」这条缝
 *  (生产传 SDK 的 MaxTurnsExceededError),所以这里不必把 SDK 拖进 apps/web 的依赖。 */
class TruncatedRun extends Error {
  state: { usage: { inputTokens: number; outputTokens: number }; _generatedItems: unknown[] };
  constructor(items: unknown[]) {
    super("max turns exceeded");
    this.state = { usage: { inputTokens: 4000, outputTokens: 900 }, _generatedItems: items };
  }
}

const SEED_INTERNAL = 5_000;

async function seedOrg(): Promise<string> {
  const orgId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: SEED_INTERNAL, reserved: 0 } });
  return orgId;
}
async function account(orgId: string) {
  return prisma.creditAccount.findUniqueOrThrow({ where: { orgId } });
}
async function ledger(orgId: string) {
  return prisma.creditLedger.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
}
/** 账本行 → 消费历史那一行(与 /billing、readSpending 同一个纯函数)。 */
function historyOf(rows: Awaited<ReturnType<typeof ledger>>) {
  return buildSpendHistory(rows as unknown as SpendLedgerRow[], new Map(), "Asia/Kuala_Lumpur");
}

/** 跑一轮**截断**的计费轮:预扣 → fn 抛截断 → 由 usageOnError 判退款还是结算。 */
async function runTruncatedTurn(
  orgId: string,
  refId: string,
  items: unknown[],
  context?: Pick<OttoContext, "research">,
  /** 跑到一半、抛截断之前发生的事(用来让搜索腿真的产生成功次数)。 */
  duringRun?: () => void,
): Promise<{ chargedNothing: boolean }> {
  let chargedNothing = false;
  const args = ottoBudgetArgsFor(
    ottoInteractiveRuntime,
    { orgId, refId, input: "go round in circles" },
    context,
    TruncatedRun as unknown as NonNullable<Parameters<typeof ottoBudgetArgsFor>[3]>,
  );
  await expect(
    withLlmBudget({ ...args, onRefundedFailure: () => { chargedNothing = true; } }, async () => {
      duringRun?.();
      throw new TruncatedRun(items);
    }),
  ).rejects.toBeInstanceOf(TruncatedRun);
  return { chargedNothing };
}

/** RESERVE / SETTLE / REFUND 三种行,按 kind 取。不按写入次序断言 —— 同一毫秒的两行排序不
 *  是这份测试要证的事。 */
function kindsOf(rows: { kind: string }[]): string[] {
  return rows.map((r) => r.kind).sort();
}

/** 一次成功的**读**(搜网页 / 查产品)。读完就没了,商家手里什么都不剩。 */
const READ_ONLY_ITEMS: unknown[] = [
  { type: "tool_call_item", rawItem: { type: "function_call", callId: "c1", name: "researchWeb", arguments: "{}", status: "completed" } },
  { type: "tool_call_output_item", rawItem: { type: "function_call_result", callId: "c1", name: "researchWeb", status: "completed" } },
  { type: "message_output_item", rawItem: { type: "message", role: "assistant", content: [{ type: "output_text", text: "let me look again" }] } },
];

/** 一个**落盘**的写动作 —— 画布节点这一类:轮子死了,东西还在。 */
const LANDED_WRITE_ITEMS: unknown[] = [
  { type: "tool_call_item", rawItem: { type: "function_call", callId: "c1", name: "manageCanvas", arguments: "{}", status: "completed" } },
  { type: "tool_call_output_item", rawItem: { type: "function_call_result", callId: "c1", name: "manageCanvas", status: "completed" } },
];

beforeAll(() => {
  // 这一票是钱路的真库证据。没有库就**不许**静悄悄地绿 —— 那比红更糟。
  const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
  if (!dbName.endsWith("_test")) {
    throw new Error("ENGINE-A4 是真库行为测试:请把 DATABASE_URL 指向一个 *_test 库再跑。");
  }
});

describe("ENGINE-A4 — 截断且零交付的一轮全额退款(规格 otto-engine.md §7.2⑤)", () => {
  it("ENGINE-A4:零交付的截断轮 → reserve/refund 成对、余额净变 0、hold 归零", async () => {
    const orgId = await seedOrg();
    const refId = `otto-stream:${randomUUID()}`;

    const { chargedNothing } = await runTruncatedTurn(orgId, refId, READ_ONLY_ITEMS);

    // 入口据以说「这一轮没有收费」的那个信号。
    expect(chargedNothing).toBe(true);

    const rows = await ledger(orgId);
    // 「净变 0」的第二种合法形态(钱规格 A8):花钱后失败 ⇒ reserve/refund 成对。不是零新增行。
    expect(rows).toHaveLength(2);
    expect(kindsOf(rows)).toEqual(["REFUND", "RESERVE"]);
    expect(rows.every((r) => r.refId === refId)).toBe(true);
    const reserve = rows.find((r) => r.kind === "RESERVE")!;
    const refund = rows.find((r) => r.kind === "REFUND")!;
    expect(reserve.balanceDelta).toBeLessThan(0);
    // 退的是**整个**预扣 —— 金额读自 RESERVE 行,一分不留。
    expect(refund.balanceDelta).toBe(-reserve.balanceDelta);
    expect(refund.reservedDelta).toBe(-reserve.reservedDelta);
    expect(rows.reduce((sum, r) => sum + r.balanceDelta, 0)).toBe(0);

    const acct = await account(orgId);
    expect(acct.balance).toBe(SEED_INTERNAL);
    expect(acct.reserved).toBe(0);
  });

  it("ENGINE-A4:消费历史看得见那一行退款(「Held, then refunded in full」,净变 0)", async () => {
    const orgId = await seedOrg();
    const refId = `otto-stream:${randomUUID()}`;

    await runTruncatedTurn(orgId, refId, READ_ONLY_ITEMS);

    const entries = historyOf(await ledger(orgId));
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    // 商家读到的是一条**聊天**记录,不是一条无名的「Credit change」。
    expect(entry.category).toBe("chat");
    expect(entry.delta).toBe(0);
    expect(entry.pending).toBe(false);
    // 这句就是验收行说的「可见对应退款行」——「扣了,然后全退了」。
    expect(entry.detail).toBe("Held, then refunded in full");
  });

  it("ENGINE-A4:搜索腿一并退 —— 整笔预扣(含坚实预留的搜索格)一分不留", async () => {
    const orgId = await seedOrg();
    const refId = `otto-stream:${randomUUID()}`;
    // 接了 search 端口 + 槽计数器 ⇒ 这一轮多一条钱腿(MONEY-A10 的按格坚实预留)。
    const searchSlots = { granted: 0, taken: 0, succeeded: 0 };
    const context = {
      research: {
        fetchUrl: async () => ({ url: "https://example.test", text: "" }),
        search: async () => ({ results: [] }),
        searchSlots,
      },
    } as unknown as Pick<OttoContext, "research">;

    // 这一轮真的搜到了东西(succeeded > 0)—— 按旧口径这几次搜索会被结算掉;ENGINE-A4 说照退。
    await runTruncatedTurn(orgId, refId, READ_ONLY_ITEMS, context, () => {
      searchSlots.taken = 2;
      searchSlots.succeeded = 2;
    });
    expect(searchSlots.succeeded).toBe(2);

    const rows = await ledger(orgId);
    const reserve = rows.find((r) => r.kind === "RESERVE")!;
    const refund = rows.find((r) => r.kind === "REFUND")!;
    expect(kindsOf(rows)).toEqual(["REFUND", "RESERVE"]);
    // 预扣里确实含着搜索那几格(否则这条用例证不到「一并退」)。
    expect(searchSlots.granted).toBeGreaterThan(0);
    expect(searchSlots.granted).toBeLessThanOrEqual(OTTO_CHAT_MAX_SEARCHES_PER_TURN);
    expect(-reserve.balanceDelta).toBeGreaterThanOrEqual(
      searchSlots.granted * searchUnitChargeInternal("basic"),
    );
    expect(refund.balanceDelta).toBe(-reserve.balanceDelta);
    expect((await account(orgId)).balance).toBe(SEED_INTERNAL);
    expect(historyOf(rows)[0]!.delta).toBe(0);
  });

  it("ENGINE-A4:有交付的截断轮**不退** —— 落盘的写动作按实际用量结算", async () => {
    const orgId = await seedOrg();
    const refId = `otto-stream:${randomUUID()}`;

    const { chargedNothing } = await runTruncatedTurn(orgId, refId, LANDED_WRITE_ITEMS);

    expect(chargedNothing).toBe(false);
    const rows = await ledger(orgId);
    expect(kindsOf(rows)).toEqual(["RESERVE", "SETTLE"]);
    const acct = await account(orgId);
    expect(acct.reserved).toBe(0);
    // 真的收了钱,而且收的比预扣少(按实际 token 结算,余下的在 settle 里退回)。
    const charged = SEED_INTERNAL - acct.balance;
    expect(charged).toBeGreaterThan(0);
    expect(charged).toBeLessThanOrEqual(-rows[0]!.balanceDelta);
    // 消费历史上这是一笔**花掉的**聊天,不是退款。
    const entry = historyOf(rows)[0]!;
    expect(entry.category).toBe("chat");
    expect(entry.delta).toBe(-displayCredits(charged));
    expect(entry.detail).not.toBe("Held, then refunded in full");
  });

  it("ENGINE-A4:铸出的卡片也算交付 —— 停在审批位上的一轮照旧结算", async () => {
    const orgId = await seedOrg();
    const refId = `otto-stream:${randomUUID()}`;

    const { chargedNothing } = await runTruncatedTurn(orgId, refId, [
      { type: "tool_approval_item", rawItem: { type: "function_call", callId: "c1", name: "generate", arguments: "{}", status: "completed" } },
    ]);

    expect(chargedNothing).toBe(false);
    expect(kindsOf(await ledger(orgId))).toEqual(["RESERVE", "SETTLE"]);
  });
});
