import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RECONCILE_CLOSED_TYPE, RECONCILE_OBSERVED_TYPE, reconcileClosureId, reconcileObservationId } from "@fikirtive/core";

const requireRole = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireRole }));
// 说不清的那一种要叫人 —— 报警管道注入成假 transport,一个真实外呼都不发。
const founderAlert = vi.fn();
vi.mock("@/lib/founder-alert", () => ({ founderAlert }));
const actionEventFindUnique = vi.fn();
const actionEventFindMany = vi.fn();
const actionEventCreate = vi.fn();
const creditLedgerFindFirst = vi.fn();
// 占用标记与关闭行同一笔事务写 —— 假的 $transaction 直接把同一个 actionEvent 面交给回调,
// 于是「两条写在一起」这件事在用例里可见,而事务语义由真库那一组用例去证。
const txCreate = vi.fn();
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ actionEvent: { create: txCreate } }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    $transaction,
    actionEvent: { findUnique: actionEventFindUnique, findMany: actionEventFindMany, create: actionEventCreate },
    creditLedger: { findFirst: creditLedgerFindFirst },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  requireRole.mockResolvedValue({ email: "finance@fikirtive.test", roles: ["finance"], role: "finance" });
  actionEventFindUnique.mockResolvedValue({ ownerId: "org_1", payload: { orgId: "org_1", credits: 220 } });
  actionEventFindMany.mockResolvedValue([]);
  actionEventCreate.mockResolvedValue({});
  txCreate.mockResolvedValue({});
  creditLedgerFindFirst.mockResolvedValue(null);
  founderAlert.mockResolvedValue([]);
});

/** 一行合法的手工补发:同商家、GRANT、金额相符,**且 reason 里粘着这一笔 session id**。 */
const grantRow = (over: Record<string, unknown> = {}) => ({
  id: "cl_9",
  orgId: "org_1",
  kind: "GRANT",
  balanceDelta: 220 * 10,
  reason: `manual re-grant for ${SESSION}`,
  idempotencyKey: "grant:abc",
  ...over,
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
    expect(res).not.toHaveProperty("ok");
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("处置是必选的 —— 不许「按一下就关」", async () => {
    const res = await closeReconcileObservation({ sessionId: SESSION });

    expect(res).toEqual({ error: "Pick how this payment was settled." });
    expect(res).not.toHaveProperty("ok");
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("退款了结:没有 re_… 单号不许关(单号是这条处置唯一可核的凭据)", async () => {
    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "refunded_in_stripe", refundId: "已退款" });

    expect(res).toEqual({ error: "Enter the Stripe refund id (re_…) for this refund." });
    expect(res).not.toHaveProperty("ok");
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

    expect(res).toEqual({ error: "No credits-ledger row for THIS merchant carries that refId or idempotency key — check it before closing this gap." });
    expect(res).not.toHaveProperty("ok");
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("终审 P2:账本查询钉在**这笔缺口自己的商家**上 —— 别家的补发单据关不掉这一笔", async () => {
    // 全局查一把 refId,等于允许拿 B 家的补发记录关掉 A 家的缺口。租户边界必须进 where。
    creditLedgerFindFirst.mockResolvedValue(null); // 加了 orgId 约束之后,别家那一行查不到

    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "credited_manually", ledgerRef: "grant:belongs_to_org_2" });

    expect(creditLedgerFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org_1", OR: [{ idempotencyKey: "grant:belongs_to_org_2" }, { refId: "grant:belongs_to_org_2" }] },
      }),
    );
    expect("error" in res).toBe(true);
    expect(res).not.toHaveProperty("ok");
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("终审 P2:同一个商家但那一行不是补发形态(RESERVE/SETTLE)⇒ 拒绝", async () => {
    creditLedgerFindFirst.mockResolvedValue(grantRow({ id: "cl_r", kind: "RESERVE", balanceDelta: -2200 }));

    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "credited_manually", ledgerRef: "reserve:gen_1" });

    expect("error" in res && res.error).toContain("not a manual grant");
    expect(res).not.toHaveProperty("ok");
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("终审 P2:同一个商家、形态也对,但**金额不符** ⇒ 拒绝(补 50 关不掉一笔 220 的缺口)", async () => {
    creditLedgerFindFirst.mockResolvedValue(grantRow({ id: "cl_small", balanceDelta: 50 * 10 }));

    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "credited_manually", ledgerRef: "grant:small" });

    expect("error" in res && res.error).toContain("50 credits but this payment was for 220");
    expect(res).not.toHaveProperty("ok");
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("终审 P2:缺口自己没有 credits 数(metadata 当初就坏了)⇒ 不许走这一支,指路 Something else", async () => {
    actionEventFindUnique.mockResolvedValue({ ownerId: "org_1", payload: { orgId: "org_1", credits: null } });

    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "credited_manually", ledgerRef: "grant:abc" });

    expect("error" in res && res.error).toContain("Something else");
    expect(res).not.toHaveProperty("ok");
    expect(creditLedgerFindFirst).not.toHaveBeenCalled();
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("手工补发了结:同商家 + GRANT + 金额相符 ⇒ 放行,关闭行把那一行的 id / org / 金额一起钉下来", async () => {
    creditLedgerFindFirst.mockResolvedValue(grantRow());

    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "credited_manually", ledgerRef: "grant:abc" });

    expect(res).toEqual({ ok: true });
    // 占用标记 + 关闭行,同一笔事务两条写。
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(txCreate.mock.calls[0]![0].data.id).toBe("reconcile_credit_use:cl_9");
    expect(txCreate.mock.calls[1]![0].data.payload).toMatchObject({
      disposition: "credited_manually",
      ledgerRef: "grant:abc",
      ledgerRowId: "cl_9",
      ledgerOrgId: "org_1",
      ledgerCredits: "220",
    });
  });

  it("复审三 P1(a):同商家同额,但 reason 不指名这一笔 session ⇒ 拒绝", async () => {
    // 同一个商家同一天补两次 220,金额与形态都对得上 —— 不指名就分不出是哪一笔,
    // 拿错的那一笔关掉,商家仍然少一份钱。
    creditLedgerFindFirst.mockResolvedValue(grantRow({ reason: "goodwill top-up", idempotencyKey: "grant:other" }));

    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "credited_manually", ledgerRef: "grant:other" });

    expect("error" in res && res.error).toContain("does not name this payment");
    expect(res).not.toHaveProperty("ok");
    expect($transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["前缀更长", "manual re-grant for cs_test_1234"],
    ["后缀", "manual re-grant for xcs_test_123"],
    ["紧邻字符", "manual re-grant for cs_test_123abc"],
  ])("复审四 P1:reason 里是**相似**的 id(%s)⇒ 拒绝(子串匹配会把它当成命中)", async (_label, reason) => {
    // `cs_test_1234` 与 `cs_test_123` 是两笔不同的付款,而金额、商家、形态可以完全一样。
    creditLedgerFindFirst.mockResolvedValue(grantRow({ reason }));

    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "credited_manually", ledgerRef: "grant:abc" });

    expect("error" in res && res.error).toContain("does not name this payment");
    expect(res).not.toHaveProperty("ok");
    expect($transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["行首", "cs_test_123 re-granted by hand"],
    ["行尾", "manual re-grant for cs_test_123"],
    ["标点包住", "re-grant (cs_test_123) after webhook loss"],
  ])("复审四 P1:token 边界上的精确匹配(%s)⇒ 通过", async (_label, reason) => {
    creditLedgerFindFirst.mockResolvedValue(grantRow({ reason }));

    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "credited_manually", ledgerRef: "grant:abc" });

    expect(res).toEqual({ ok: true });
  });

  it("④a P2:id 里带 `-` 的假想 session ⇒ 照样认得出(Stripe 从未承诺过 id 的字符集)", async () => {
    // 上一版把 reason 按 `[^A-Za-z0-9_]+` 切 token,再要求某个 token 逐字等于 sessionId ——
    // 那等于假设 id 只由 `[A-Za-z0-9_]` 组成。真出现一个带 `-` 的 id,切法会把 id **自己**
    // 也切开,于是**任何** reason 都配不上它:一条如实写了单号的人工补发被判成「没指名」,
    // 操作员被逼去走三支凭据里最弱的那一支。这条钉的是那个方向。
    const HYPHEN_SESSION = "cs_test-abc-123";
    creditLedgerFindFirst.mockResolvedValue(
      grantRow({ reason: `manual re-grant for ${HYPHEN_SESSION}`, idempotencyKey: "grant:hy" }),
    );

    const res = await closeReconcileObservation({
      sessionId: HYPHEN_SESSION,
      disposition: "credited_manually",
      ledgerRef: "grant:hy",
    });

    expect(res).toEqual({ ok: true });
  });

  it("④a P2:带 `-` 的 id 也照样挡得住**更长**的近似 id(边界判定没有因此松掉)", async () => {
    const HYPHEN_SESSION = "cs_test-abc-123";
    creditLedgerFindFirst.mockResolvedValue(
      grantRow({ reason: `manual re-grant for ${HYPHEN_SESSION}4`, idempotencyKey: "grant:hy" }),
    );

    const res = await closeReconcileObservation({
      sessionId: HYPHEN_SESSION,
      disposition: "credited_manually",
      ledgerRef: "grant:hy",
    });

    expect("error" in res && res.error).toContain("does not name this payment");
    expect(res).not.toHaveProperty("ok");
    expect($transaction).not.toHaveBeenCalled();
  });

  it("复审三 P1(a):幂等键就是 stripe:<sessionId> 的自动入账形态 ⇒ 算指名,通过", async () => {
    creditLedgerFindFirst.mockResolvedValue(grantRow({ reason: "stripe top-up", idempotencyKey: `stripe:${SESSION}` }));

    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "credited_manually", ledgerRef: `stripe:${SESSION}` });

    expect(res).toEqual({ ok: true });
  });

  it("复审三 P1(b):同一行补发被拿去关第二笔缺口 ⇒ 拒绝,并说出它已经关了哪一笔", async () => {
    creditLedgerFindFirst.mockResolvedValue(grantRow());
    // 占用标记撞主键 —— 这一行早就被用掉了。
    $transaction.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    actionEventFindUnique.mockResolvedValueOnce({ ownerId: "org_1", payload: { orgId: "org_1", credits: 220 } });
    actionEventFindUnique.mockResolvedValueOnce({ payload: { ledgerRowId: "cl_9", sessionId: "cs_other_gap" } });

    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "credited_manually", ledgerRef: "grant:abc" });

    expect("error" in res && res.error).toContain("already used to close another gap (cs_other_gap)");
    expect(res).not.toHaveProperty("ok");
  });

  it("复审三 P1(b):撞的是关闭行(这一笔早就关过了)⇒ 仍然是 alreadyClosed,不误报占用", async () => {
    creditLedgerFindFirst.mockResolvedValue(grantRow());
    $transaction.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    actionEventFindUnique.mockResolvedValueOnce({ ownerId: "org_1", payload: { orgId: "org_1", credits: 220 } });
    actionEventFindUnique.mockResolvedValueOnce({ payload: { ledgerRowId: "cl_9", sessionId: SESSION } }); // 占用标记
    actionEventFindUnique.mockResolvedValueOnce({ id: "stripe_unreconciled_closed:cs_test_123" }); // 关闭行确实在

    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "credited_manually", ledgerRef: "grant:abc" });

    expect(res).toEqual({ ok: true, alreadyClosed: true });
  });

  it("复审四 P2-2:第三态(标记在、却没有关闭行)⇒ fail closed 拒绝 + 叫人,绝不答成 alreadyClosed", async () => {
    // 把说不清的那一种答成「已经关过了」,等于告诉操作员「这笔不用管了」—— 而关闭行根本不在,
    // 缺口还在,人却不会再回来看它。
    creditLedgerFindFirst.mockResolvedValue(grantRow());
    $transaction.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    actionEventFindUnique.mockResolvedValueOnce({ ownerId: "org_1", payload: { orgId: "org_1", credits: 220 } });
    actionEventFindUnique.mockResolvedValueOnce({ payload: { ledgerRowId: "cl_9" } }); // 标记里没有 sessionId
    actionEventFindUnique.mockResolvedValueOnce(null); // 关闭行不在

    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "credited_manually", ledgerRef: "grant:abc" });

    expect("error" in res).toBe(true);
    expect(res).not.toHaveProperty("ok");
    expect("error" in res && res.error).toContain("unexpected state");
    expect("error" in res && res.error).toContain("NOT closed");
    expect(founderAlert).toHaveBeenCalledTimes(1);
    expect(founderAlert.mock.calls[0]![0].key).toBe("reconcile.credit_use_marker_inconsistent");
  });

  it("复审三 P2-2:关闭行记下**当时**那一笔是不是确认过的缺口", async () => {
    actionEventFindUnique.mockResolvedValue({ ownerId: "org_1", payload: { orgId: "org_1", credits: 220, ledgerVerified: false } });

    await closeReconcileObservation(REFUNDED);

    expect(actionEventCreate.mock.calls[0]![0].data.payload).toMatchObject({ ledgerVerifiedAtClose: false });
  });

  it("其它处置:说明太短不许关", async () => {
    const res = await closeReconcileObservation({ sessionId: SESSION, disposition: "other", note: "已处理", confirmed: true });

    expect("error" in res && res.error).toContain("at least 20 characters");
    expect(res).not.toHaveProperty("ok");
    expect(actionEventCreate).not.toHaveBeenCalled();
  });

  it("其它处置:说明够长但没二次确认,仍然不许关", async () => {
    const res = await closeReconcileObservation({
      sessionId: SESSION,
      disposition: "other",
      note: "buyer cancelled the card before the charge ever settled; Stripe shows nothing captured",
    });

    expect(res).toEqual({ error: "Tick the confirmation box: closing this stops all further alerts for this payment." });
    expect(res).not.toHaveProperty("ok");
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
    expect(res).not.toHaveProperty("ok");
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
    expect(res.rows[0]).toMatchObject({ orgId: "org_1", amountTotal: 2500, currency: "MYR", lastAlertedAt: "2026-08-19T09:00:00.000Z", ledgerVerified: true });
  });

  it("复审三 P2-2:未验证的观察行在清单里带 ledgerVerified=false(页面据此换一句话)", async () => {
    actionEventFindMany
      .mockResolvedValueOnce([
        {
          type: RECONCILE_OBSERVED_TYPE,
          createdAt: new Date("2026-08-18T12:00:00.000Z"),
          payload: { sessionId: "cs_unverified", orgId: "org_1", amountTotal: 2500, currency: "MYR", ledgerVerified: false },
        },
      ])
      .mockResolvedValueOnce([]);

    const res = await listReconcileObservations();

    expect("rows" in res && res.rows[0]!.ledgerVerified).toBe(false);
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
    expect(res).not.toHaveProperty("rows");
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
