import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RECONCILE_CLOSED_TYPE, reconcileClosureId, reconcileObservationId } from "@fikirtive/core";

const requireRole = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireRole }));
const actionEventFindUnique = vi.fn();
const actionEventCreate = vi.fn();
vi.mock("@fikirtive/db", () => ({ prisma: { actionEvent: { findUnique: actionEventFindUnique, create: actionEventCreate } } }));

beforeEach(() => {
  vi.clearAllMocks();
  requireRole.mockResolvedValue({ email: "finance@fikirtive.test", roles: ["finance"], role: "finance" });
  actionEventFindUnique.mockResolvedValue({ ownerId: "org_1" });
  actionEventCreate.mockResolvedValue({});
});

const { closeReconcileObservation } = await import("@/lib/reconcile-actions");

const SESSION = "cs_test_123";

describe("MONEY-A12:关闭一条对账观察行(哨兵「追踪至人工关闭」的那个关闭)", () => {
  it("拒绝没有 credits.mutate 权限的人 —— 一个字都不写", async () => {
    requireRole.mockResolvedValue({ error: "You don't have access to this." });

    const res = await closeReconcileObservation({ sessionId: SESSION, note: "refunded" });

    expect(res).toEqual({ error: "You don't have access to this." });
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("关闭理由是必填的 —— 关掉一笔平台已知资损的追踪,必须留下为什么", async () => {
    const res = await closeReconcileObservation({ sessionId: SESSION, note: "   " });

    expect(res).toEqual({ error: "Say how this payment was settled — the closing note is the audit trail." });
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("不存在的观察行不许凭空关闭", async () => {
    actionEventFindUnique.mockResolvedValue(null);

    const res = await closeReconcileObservation({ sessionId: SESSION, note: "refunded in Stripe" });

    expect(res).toEqual({ error: "No reconciliation observation exists for that session id." });
    expect(actionEventFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: reconcileObservationId(SESSION) } }));
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("写下的关闭行带 谁/何时/为什么,主键由 session id 派生(哨兵读的就是这一行)", async () => {
    const res = await closeReconcileObservation({ sessionId: SESSION, note: "refunded in Stripe, buyer agreed" });

    expect(res).toEqual({ ok: true });
    const written = actionEventCreate.mock.calls[0]![0].data;
    expect(written.id).toBe(reconcileClosureId(SESSION));
    expect(written.type).toBe(RECONCILE_CLOSED_TYPE);
    expect(written.ownerId).toBe("org_1"); // 挂在观察行认下的那个商家名下,不是 founder
    expect(written.payload).toMatchObject({ sessionId: SESSION, closedBy: "finance@fikirtive.test", note: "refunded in Stripe, buyer agreed" });
    expect(typeof written.payload.closedAt).toBe("string");
  });

  it("关两次不是错误:第二次撞主键 ⇒ 如实说已经关过了,不产生第二条事实", async () => {
    actionEventCreate.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

    const res = await closeReconcileObservation({ sessionId: SESSION, note: "refunded in Stripe" });

    expect(res).toEqual({ ok: true, alreadyClosed: true });
  });

  it("一个字都不碰钱:这个动作只写 ActionEvent(账本仍然只由 webhook 那条路产生)", async () => {
    await closeReconcileObservation({ sessionId: SESSION, note: "test session, never a real payment" });

    // db mock 只提供 actionEvent —— 这个动作要是碰了 creditLedger / creditAccount,
    // 它会在这里当场炸(而不是在生产里悄悄开出钱路的第二个权威)。
    expect(actionEventCreate).toHaveBeenCalledTimes(1);
  });
});

describe("MONEY-A13:拒付 runbook 与人工损失台账必须在仓库里", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../../${rel}`, import.meta.url)), "utf8");

  it("拒付 runbook 存在,并且写明账号级暂停与台账落点", async () => {
    const runbook = read("docs/runbooks/chargeback.md");
    expect(runbook).toContain("docs/ops/manual-money-ledger.md");
    expect(runbook).toMatch(/账号级暂停/);
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
