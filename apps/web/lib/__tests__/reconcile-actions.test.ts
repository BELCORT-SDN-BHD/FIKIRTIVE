import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RECONCILE_CLOSED_TYPE, RECONCILE_OBSERVED_TYPE, reconcileClosureId, reconcileObservationId } from "@fikirtive/core";

const requireRole = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireRole }));
const actionEventFindUnique = vi.fn();
const actionEventFindMany = vi.fn();
const actionEventCreate = vi.fn();
const creditLedgerFindFirst = vi.fn();
vi.mock("@fikirtive/db", () => ({
  prisma: {
    actionEvent: { findUnique: actionEventFindUnique, findMany: actionEventFindMany, create: actionEventCreate },
    creditLedger: { findFirst: creditLedgerFindFirst },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  requireRole.mockResolvedValue({ email: "finance@fikirtive.test", roles: ["finance"], role: "finance" });
  actionEventFindUnique.mockResolvedValue({ ownerId: "org_1" });
  actionEventFindMany.mockResolvedValue([]);
  actionEventCreate.mockResolvedValue({});
  creditLedgerFindFirst.mockResolvedValue(null);
});

const { closeReconcileObservation, listReconcileObservations } = await import("@/lib/reconcile-actions");

const SESSION = "cs_test_123";
/** 一条合法的「退款了结」输入 —— 各条用例只改它要证的那一格。 */
const REFUNDED = { sessionId: SESSION, disposition: "refunded_in_stripe", refundId: "re_3Nabcdef123" };

describe("MONEY-A12:关闭一条对账观察行(哨兵「追踪至人工关闭」的那个关闭)", () => {
  it("拒绝没有 credits.mutate 权限的人 —— 一个字都不写", async () => {
    requireRole.mockResolvedValue({ error: "You don't have access to this." });

    const res = await closeReconcileObservation(REFUNDED);

    expect(res).toEqual({ error: "You don't have access to this." });
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("处置是必选的 —— 不许「按一下就关」", async () => {
    const res = await closeReconcileObservation({ sessionId: SESSION });

    expect(res).toEqual({ error: "Pick how this payment was settled." });
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("退款了结:没有 re_… 单号不许关(单号是这条处置唯一可核的凭据)", async () => {
    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "refunded_in_stripe", refundId: "已退款" });

    expect(res).toEqual({ error: "Enter the Stripe refund id (re_…) for this refund." });
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("退款了结:单号合法 ⇒ 关闭行记下结构化处置", async () => {
    const res = await closeReconcileObservation(REFUNDED);

    expect(res).toEqual({ ok: true });
    const written = actionEventCreate.mock.calls[0]![0].data;
    expect(written.id).toBe(reconcileClosureId(SESSION));
    expect(written.type).toBe(RECONCILE_CLOSED_TYPE);
    expect(written.ownerId).toBe("org_1"); // 挂在观察行认下的那个商家名下,不是 founder
    expect(written.payload).toMatchObject({ sessionId: SESSION, disposition: "refunded_in_stripe", refundId: "re_3Nabcdef123", closedBy: "finance@fikirtive.test" });
    expect(typeof written.payload.closedAt).toBe("string");
  });

  it("手工补发了结:账本上查不到那一行就不许关(「我记得补过了」不是证据)", async () => {
    creditLedgerFindFirst.mockResolvedValue(null);

    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "credited_manually", ledgerRef: "grant:nope" });

    expect(res).toEqual({ error: "No credits-ledger row carries that refId or idempotency key — check it before closing this gap." });
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("手工补发了结:账本查得到 ⇒ 关闭行把那一行的 id 与 org 一起钉下来", async () => {
    creditLedgerFindFirst.mockResolvedValue({ id: "cl_9", orgId: "org_1" });

    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "credited_manually", ledgerRef: "grant:abc" });

    expect(res).toEqual({ ok: true });
    expect(creditLedgerFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ idempotencyKey: "grant:abc" }, { refId: "grant:abc" }] } }),
    );
    expect(actionEventCreate.mock.calls[0]![0].data.payload).toMatchObject({
      disposition: "credited_manually",
      ledgerRef: "grant:abc",
      ledgerRowId: "cl_9",
      ledgerOrgId: "org_1",
    });
  });

  it("其它处置:说明太短不许关", async () => {
    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "other", note: "已处理", confirmed: true });

    expect("error" in res && res.error).toContain("at least 20 characters");
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("其它处置:说明够长但没二次确认,仍然不许关", async () => {
    const res = await closeReconcileObservation({
      sessionId: SESSION,
      disposition: "other",
      note: "buyer cancelled the card before the charge ever settled; Stripe shows nothing captured",
    });

    expect(res).toEqual({ error: "Tick the confirmation box: closing this stops all further alerts for this payment." });
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("其它处置:说明够长 + 二次确认 ⇒ 放行", async () => {
    const res = await closeReconcileObservation({
      sessionId: SESSION,
      disposition: "other",
      note: "buyer cancelled the card before the charge ever settled; Stripe shows nothing captured",
      confirmed: true,
    });

    expect(res).toEqual({ ok: true });
    expect(actionEventCreate.mock.calls[0]![0].data.payload).toMatchObject({ disposition: "other" });
  });

  it("不存在的观察行不许凭空关闭", async () => {
    actionEventFindUnique.mockResolvedValue(null);

    const res = await closeReconcileObservation(REFUNDED);

    expect(res).toEqual({ error: "No reconciliation observation exists for that session id." });
    expect(actionEventFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: reconcileObservationId(SESSION) } }));
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("关两次不是错误:第二次撞主键 ⇒ 如实说已经关过了,不产生第二条事实", async () => {
    actionEventCreate.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

    const res = await closeReconcileObservation(REFUNDED);

    expect(res).toEqual({ ok: true, alreadyClosed: true });
  });

  it("一个字都不碰钱:这个动作只写 ActionEvent、只**读**账本", async () => {
    await closeReconcileObservation(REFUNDED);

    // db mock 只提供 actionEvent 与 creditLedger.findFirst —— 这个动作要是想写账本,
    // 它会在这里当场炸(而不是在生产里悄悄开出钱路的第二个权威)。
    expect(actionEventCreate).toHaveBeenCalledTimes(1);
  });
});

describe("MONEY-A12:未了结清单(admin 页面读的那一份)", () => {
  it("只列还没关的,并带上最近一次真的喊过人的时间", async () => {
    const observed = (sessionId: string, over: Record<string, unknown> = {}) => ({
      type: RECONCILE_OBSERVED_TYPE,
      createdAt: new Date("2026-08-18T12:00:00.000Z"),
      payload: { sessionId, orgId: "org_1", amountTotal: 2500, currency: "MYR", firstSeenAt: "2026-08-18T12:00:00.000Z", ...over },
    });
    actionEventFindMany
      .mockResolvedValueOnce([
        observed("cs_open"),
        observed("cs_done"),
        { type: RECONCILE_CLOSED_TYPE, createdAt: new Date("2026-08-19T00:00:00.000Z"), payload: { sessionId: "cs_done" } },
      ])
      .mockResolvedValueOnce([
        { id: "stripe_unreconciled_alert:cs_open:2026-08-19", createdAt: new Date("2026-08-19T09:00:00.000Z") },
        { id: "stripe_unreconciled_alert:cs_open:2026-08-18", createdAt: new Date("2026-08-18T13:00:00.000Z") },
      ]);

    const res = await listReconcileObservations();

    expect("rows" in res).toBe(true);
    if (!("rows" in res)) return;
    expect(res.rows.map((r) => r.sessionId)).toEqual(["cs_open"]); // 关掉的那条不在清单里
    expect(res.rows[0]).toMatchObject({ orgId: "org_1", amountTotal: 2500, currency: "MYR", lastAlertedAt: "2026-08-19T09:00:00.000Z" });
  });

  it("与哨兵读同一条索引:projectId=null + 那两个 type(人看到的与机器追的必须是同一个集合)", async () => {
    await listReconcileObservations();

    expect(actionEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: null, type: { in: [RECONCILE_OBSERVED_TYPE, RECONCILE_CLOSED_TYPE] } } }),
    );
  });

  it("没有 credits.mutate 权限就读不到清单", async () => {
    requireRole.mockResolvedValue({ error: "You don't have access to this." });

    const res = await listReconcileObservations();

    expect(res).toEqual({ error: "You don't have access to this." });
    expect(actionEventFindMany).not.toHaveBeenCalled();
  });
});

describe("MONEY-A13:拒付 runbook 与人工损失台账必须在仓库里", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../../${rel}`, import.meta.url)), "utf8");

  it("拒付 runbook 存在,并且写明账号级暂停与台账落点", async () => {
    const runbook = read("docs/runbooks/chargeback.md");
    expect(runbook).toContain("docs/ops/manual-money-ledger.md");
    expect(runbook).toMatch(/账号级暂停/);
  });

  it("拒付 runbook 指向真正能点开的关闭入口,而不是一段代码路径", async () => {
    // 「按 runbook 做不下去」是这类文档最常见的死法:指着一个没有 UI 的 server action。
    expect(read("docs/runbooks/chargeback.md")).toContain("/admin/reconcile");
  });

  it("人工台账存在,表头带登记一笔平台损失需要的每一格", async () => {
    const ledger = read("docs/ops/manual-money-ledger.md");
    for (const column of ["日期", "org", "事件", "金额", "单号", "处置", "状态", "经手人"]) {
      expect(ledger, `台账表头缺「${column}」这一格`).toContain(column);
    }
    // 三类事件必须都点名 —— 台账不点名,登记的人就会自己发明分类。
    for (const kind of ["拒付", "吸收引擎成本", "人工退款"]) {
      expect(ledger).toContain(kind);
    }
  });
});
