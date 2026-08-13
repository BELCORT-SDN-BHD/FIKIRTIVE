// @vitest-environment jsdom
/**
 * #602 T3 — 真「已取消」(spec #599 D4)。
 *
 * 商家按下 Cancel 之后,产品里没有一处再把它当成失败:
 *   ① 落库的词是 CANCELLED,不是「FAILED + error 文本里写着 Cancelled」;
 *   ② 钱路一个字节没变 —— 同一次 refundReservation,同一把幂等键,同一个事务位置;
 *   ③ 会话里的那张卡刷新之后仍然说「已取消」:没有红色失败措辞,没有「再试一次」;
 *   ④ 每一个按 FAILED 分支的读者都被问过一遍 CANCELLED 该怎么办。
 *
 * 这四条里最容易悄悄退化的是 ③:取消与失败共用同一种终局消息(TURN_ERROR 持有每任务一条
 * 终局消息的唯一索引),所以「刷新之后又变回失败卡」是默认结局,除非有东西把它们分开。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (await import("./__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
  requireRole: vi.fn(),
  requireSession: vi.fn(),
}));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn(), auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/otto",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: vi.fn(), ottoTurn: vi.fn(), createEmptyCoworkThread: vi.fn(), setAdsAutonomy: vi.fn(),
}));

const updateMany = vi.fn();
const findFirst = vi.fn();
const aggregate = vi.fn();
const create = vi.fn();
const updateThread = vi.fn();
const refundReservation = vi.fn();
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({
    genJob: { updateMany, findFirst },
    chatMessage: { aggregate, create },
    chatThread: { update: updateThread },
  }),
);
vi.mock("@fikirtive/db", () => ({
  prisma: { $transaction, genJob: { updateMany, findFirst }, chatMessage: { aggregate, create }, chatThread: { update: updateThread } },
  Prisma: {},
  refundReservation,
}));
vi.mock("@fikirtive/otto", () => ({ withLlmBudget: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ email: "u@t.test", ownerId: "org-1" });
  findFirst.mockResolvedValue({ threadId: "thread-1" });
  aggregate.mockResolvedValue({ _max: { seq: 7 } });
});

const { cancelGenJob } = await import("@/lib/cowork-actions");
const { toChatMessageDTO } = await import("@/lib/dto");
const { deriveCardState, cancelledJobIds, cancelledTurnPayload } = await import("@/lib/otto-inject-helpers");
const { runStateOfCard, isTerminalRunState, runStateSpins } = await import("@/lib/otto-status-helpers");
const { threadBadgeFromJobStatus } = await import("@/lib/thread-status");
const { adJobStatusFromGenStatus } = await import("@/lib/ad-job-status");
const { canvasCardFace } = await import("@/lib/canvas-card-status");
const { OttoPlanCard } = await import("@/components/otto/OttoPlanCard");

describe("① 取消落库成自己的词", () => {
  it("写 CANCELLED,而不是把「取消」藏在 FAILED 的错误文本里", async () => {
    updateMany.mockResolvedValue({ count: 1 });

    const res = await cancelGenJob({ jobId: "g1" });

    expect(res).toEqual({ refunded: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "g1", ownerId: "org-1", status: "QUEUED" },
      data: expect.objectContaining({ status: "CANCELLED", error: "Cancelled by you" }),
    });
  });

  it("终局消息带上耐久的取消标记 —— 刷新之后卡片还认得它", async () => {
    updateMany.mockResolvedValue({ count: 1 });

    await cancelGenJob({ jobId: "g1" });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "TURN_ERROR",
        genJobId: "g1",
        text: "Cancelled — you weren't charged.",
        payload: { cancelled: true },
      }),
    });
  });
});

describe("② 钱路:翻词之前之后逐字节相同", () => {
  it("同一次退款、同一把由任务 id 派生的幂等键、同一个事务位置", async () => {
    updateMany.mockResolvedValue({ count: 1 });

    await cancelGenJob({ jobId: "g1" });

    // 一次,只有一次,而且参数只认任务身份 —— 与状态词无关。
    expect(refundReservation).toHaveBeenCalledTimes(1);
    expect(refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "org-1", refId: "g1" });
    // 与状态写在同一个事务里:退款拿到的第一个参数就是 $transaction 交出来的那个 tx 客户端,
    // 不是模块级 prisma —— 状态与退款要么一起落,要么一起回滚。
    expect($transaction).toHaveBeenCalledTimes(1);
    const tx = refundReservation.mock.calls[0][0] as { genJob?: { updateMany?: unknown } };
    expect(tx.genJob?.updateMany).toBe(updateMany);
  });

  it("抢输了就一分钱都不动:任务已经开跑 / 已经结束 / 是别人的", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    const res = await cancelGenJob({ jobId: "g2" });

    expect(res).toEqual({ alreadyStarted: true });
    expect(refundReservation).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("再点一次也只退一次 —— 第二次的 WHERE 已经匹配不到 QUEUED 了", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    expect(await cancelGenJob({ jobId: "g3" })).toEqual({ refunded: true });
    expect(await cancelGenJob({ jobId: "g3" })).toEqual({ alreadyStarted: true });
    expect(refundReservation).toHaveBeenCalledTimes(1);
  });
});

/** 一条会话里的终局消息,形状与 DTO 一致。 */
const cancelMessage = (genJobId: string) => ({
  id: "m1",
  metadata: { durableId: "m1", kind: "TURN_ERROR", genJobId, payload: { cancelled: true } },
} as never);
const failureMessage = (genJobId: string) => ({
  id: "m2",
  metadata: { durableId: "m2", kind: "TURN_ERROR", genJobId, payload: { error: { kind: "error", text: "boom" } } },
} as never);

function renderPlanCard(cardState: "working" | "failed" | "cancelled"): string {
  return renderToStaticMarkup(
    createElement(OttoPlanCard, {
      cardId: "card_1",
      payload: {
        kind: "image",
        model: "seedream",
        params: { count: 1 },
        reason: "Seedream — 2048 × 2048",
        specChips: ["2048 × 2048", "1 image"],
        structuredPrompt: "a poster of a laksa bowl",
        entityIds: [],
        variantSel: {},
        estimatedPriceUsd: 0.04,
        estimatedCredits: 12,
      },
      entities: [],
      threadId: "thread_1",
      projectId: "proj_1",
      genJobId: "job_1",
      cardState,
      pendingApproval: false,
      onApproved: vi.fn(),
      onChangeSomething: vi.fn(),
    } as never),
  )
    // React 把 &rsquo; 渲染成真正的 ’ 字符;商家读到的是那个字符,所以断言对齐到直引号。
    .replaceAll("\u2019", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'");
}

/** cancelGenJob 真正写进库的那一行,原样。 */
const CANCEL_ROW = {
  id: "m1",
  role: "AGENT",
  kind: "TURN_ERROR",
  seq: 8,
  text: "Cancelled — you weren't charged.",
  payload: { cancelled: true },
  genJobId: "job_1",
  createdAt: new Date("2026-08-05T00:00:00Z"),
} as never;

describe("③ 刷新之后,那张卡还是「已取消」", () => {
  /**
   * 这一组是 r2 复审 P1-1 的补票。原来的断言喂的是**手搓的**消息形状,于是「写标记」和
   * 「读标记」两头都绿,中间那一段 —— 重载真正走的那条路 —— 没人测:
   *   otto/page.tsx → cowork-fetch → toChatMessageDTO()
   * 而 toChatMessageDTO 的 TURN_ERROR 分支是一张白名单,只认 `error.kind`,取消的 payload
   * 没有 error 键,于是整个 payload 被丢成 null:刷新之后卡片又变回红色失败卡 +「再试一次」。
   * 所以现在从**真的 DTO 映射**出发。
   */
  it("重载映射不许把取消标记丢掉 —— 中间这一段才是从前断的地方", () => {
    const dto = toChatMessageDTO(CANCEL_ROW, new Map());
    expect(cancelledTurnPayload(dto.payload)).toBe(true);
  });

  it("于是重载回来的会话仍然推导出 cancelled,而不是 failed", () => {
    const dto = toChatMessageDTO(CANCEL_ROW, new Map());
    const messages = [{
      id: dto.id,
      metadata: { durableId: dto.id, kind: dto.kind, genJobId: dto.genJobId, payload: dto.payload },
    }] as never;
    expect(deriveCardState({
      genJobId: "job_1",
      submitted: true,
      results: new Set<string>(),
      errors: new Set(["job_1"]),
      cancelled: cancelledJobIds(messages),
    })).toBe("cancelled");
  });

  it("真的流错误照旧走它自己的那条路,没被这道新分支挡掉", () => {
    const failure = {
      ...(CANCEL_ROW as unknown as Record<string, unknown>),
      payload: { error: { kind: "error", text: "the run fell over" }, userMessageId: "u1" },
    } as never;
    const dto = toChatMessageDTO(failure, new Map());
    expect(cancelledTurnPayload(dto.payload)).toBe(false);
    expect(dto.payload).toMatchObject({ kind: "stream_run_error", error: { kind: "error" } });
  });

  it("耐久的取消标记被读出来,而且压过它所搭乘的失败", () => {
    expect(cancelledTurnPayload({ cancelled: true })).toBe(true);
    expect(cancelledTurnPayload({ error: { kind: "error", text: "boom" } })).toBe(false);
    expect([...cancelledJobIds([cancelMessage("job_1"), failureMessage("job_2")])]).toEqual(["job_1"]);

    // 同一条消息同时在 errors 与 cancelled 里 —— 取消必须赢。
    expect(deriveCardState({
      genJobId: "job_1",
      submitted: true,
      results: new Set(),
      errors: new Set(["job_1"]),
      cancelled: new Set(["job_1"]),
    })).toBe("cancelled");
  });

  it("取消是终态,而且不许转圈", () => {
    const state = runStateOfCard("cancelled");
    expect(state).toBe("cancelled");
    expect(isTerminalRunState(state)).toBe(true);
    expect(runStateSpins(state)).toBe(false);
  });

  it("卡面说「已取消」,没有失败措辞,没有「再试一次」按钮", () => {
    const markup = renderPlanCard("cancelled");

    expect(markup).toContain("Cancelled — you weren't charged.");
    expect(markup).not.toContain("This one didn't come through");
    expect(markup).not.toContain("Try again");
    expect(markup).not.toContain("Change something");
  });

  it("真的失败仍然有它自己的失败卡与重试 —— 这一票没有把失败也一起改掉", () => {
    const markup = renderPlanCard("failed");

    expect(markup).toContain("This one didn't come through");
    expect(markup).toContain("Try again");
  });
});

describe("④ 每一个按 FAILED 分支的读者都被问过 CANCELLED", () => {
  it("画布卡:任务取消 → 卡面「已取消」,不是失败", () => {
    expect(canvasCardFace({ rowStatus: "pending", jobStatus: "CANCELLED" })).toBe("cancelled");
    // 结算把词写到行上之后,读法一样。
    expect(canvasCardFace({ rowStatus: "cancelled" })).toBe("cancelled");
  });

  it("会话导航:取消不挂红色「失败」角标(也不挂任何角标)", () => {
    expect(threadBadgeFromJobStatus("FAILED")).toBe("failed");
    expect(threadBadgeFromJobStatus("CANCELLED")).toBeNull();
  });

  it("Library → Ads:取消不会长出一张红色「没成」卡片(它根本不进这个列表)", () => {
    expect(adJobStatusFromGenStatus("FAILED")).toBe("failed");
    expect(adJobStatusFromGenStatus("CANCELLED")).toBeNull();
  });
});

/**
 * #602 r3(判官 P2)—— 取消的卡不许递一颗「一键再花一次」。
 *
 * 详情面板的 Regenerate / Animate / Edit 三颗都是**花钱**按钮。取消态原来只改了按钮上的字
 * (显示 "Cancelled"),按钮本身还是活的 —— 商家刚刚亲手停掉的东西,再点一下就又开一单。
 */
describe("⑤ 取消之后,详情面板的付费按钮是关的", () => {
  it("取消关掉按钮;失败仍然可以再试(失败是退过款的、商家没拿到东西)", async () => {
    const { assetSpendControlDisabled } = await import("@/lib/asset-detail-status");

    expect(assetSpendControlDisabled("cancelled", false)).toBe(true);
    // 已经在跑 / 结果还不确定:再点都可能是第二次扣费。
    expect(assetSpendControlDisabled("running", false)).toBe(true);
    expect(assetSpendControlDisabled("timeout", false)).toBe(true);
    // 失败是「你要的东西没拿到,而且退了款」—— 再试一次是对的。
    expect(assetSpendControlDisabled("failed", false)).toBe(false);
    expect(assetSpendControlDisabled("idle", false)).toBe(false);
    expect(assetSpendControlDisabled("done", false)).toBe(false);
    // 只读身份照旧一律关。
    expect(assetSpendControlDisabled("idle", true)).toBe(true);
  });

  // #896 r2 P0-a —— 这道网的形状跟着修法走了一步,守的还是同一件事。
  //
  // 从前三颗按钮各自在 JSX 里把谓词拼一遍(`disabled={assetSpendControlDisabled(...) || ...}`),
  // 这道网数的就是那三处拼装。但「拼在 disabled 上」正是缺陷本身:它只挡按钮,挡不住编辑框的
  // Shift/Cmd/Ctrl+Enter —— 快捷键直接进 handleEditSubmit,报价还没到也照发付费请求。
  // 现在每条付费路收敛成一个具名闸,控件的 disabled 与处理函数的入口读同一个值。
  // 所以这道网改判三件事:闸必须由共享谓词导出、每一处 disabled 只能是闸本身、闸必须真的
  // 挡在动作入口上。比原来严:原来只要求「按钮问过谓词」,现在要求「每一种进入方式都问过」。
  it("三颗花钱按钮问的是同一个谓词,而且那道闸挡在动作上,不只挡在按钮上", () => {
    const source = readFileSync(resolve(WEB_ROOT, "components/asset/DetailPanel.tsx"), "utf8");
    // Regenerate / Animate / Edit —— 一颗不多一颗不少。
    expect((source.match(/assetSpendControlDisabled\(/g) ?? []).length).toBe(3);

    const GATES = ["regenBlocked", "animateBlocked", "editBlocked"] as const;
    for (const gate of GATES) {
      // 闸只能从共享谓词导出,不许自己拼一个等价物出来。
      expect(
        new RegExp(`const ${gate} =[\\s\\S]{0,200}?assetSpendControlDisabled\\(`).test(source),
        `${gate} 必须由 assetSpendControlDisabled 导出`,
      ).toBe(true);
      // 而且闸挡在动作入口 —— 这是 P0-a 的本体:按钮变灰是提示,这一行才是闸。
      expect(
        new RegExp(`if \\(${gate}\\) return;`).test(source),
        `${gate} 没有挡在动作入口:快捷键之类的第二个入口会绕过它`,
      ).toBe(true);
    }

    // 每一处带生成状态的 disabled,要么就是那三个闸之一,要么与花钱无关。
    const generationPredicates = [
      ...source.matchAll(/disabled=\{([^}]*(?:regenStatus|animStatus|editStatus|Blocked)[^}]*)\}/g),
    ].map((m) => m[1]!);
    for (const predicate of generationPredicates) {
      const isSpendGate = GATES.some((g) => predicate.trim() === g);
      // 输入框那一条是故意不同的:跑的时候不让改字,但**取消之后照样可以打字** ——
      // 商家想重新描述一次编辑是自由的,不该被自己的取消锁住;它花不出一分钱。
      const isTypingLock = /^readOnly \|\| editStatus === "running"$/.test(predicate);
      expect(isSpendGate || isTypingLock, `未归口的状态谓词:${predicate}`).toBe(true);
    }
    expect(generationPredicates.length).toBe(4); // 三颗按钮 + 那一个输入框
  });
});
