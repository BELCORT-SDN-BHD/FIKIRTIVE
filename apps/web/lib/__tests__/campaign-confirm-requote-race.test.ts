// @vitest-environment jsdom
/**
 * 战役确认卡的**重报价竞态**(#708 修复轮 P2-2 / 判官 r1 P2)。
 *
 * 病在哪:换目的项目会重新问服务端要价。两次切换的响应可以乱序回来,而修之前
 *   ① 谁回来谁就写快照 —— 先发的那次后到,就把新项目的价盖回旧项目的价;
 *   ② 任何一次的 `finally` 都解禁按钮 —— 于是新价还在路上,确认按钮已经亮了;
 *   ③ 选择器在重报价途中照样能动 —— 又叠一层乱序;
 *   ④ 重报价失败只弹一句话,按钮照亮 —— 当前项目配着旧项目的报价被确认下去。
 * 四条合起来就是一句话:**商家按下的那个数,可能不是他这个项目的数**。
 *
 * 修法照 `crm/segments-page` 的 `previewSequence` 那一套:请求序号栅栏,只有**最后一次
 * 发出**的那次有资格写快照、清错、解禁按钮;quoting/busy 期间选择器禁用;重报价失败置
 * `quoteStale` 锁住确认。
 *
 * 全程真组件、真 React 状态机;两个服务端动作是假件 —— 一个积分都花不出去。
 * `@/components/ui/select` 换成原生 `<select>`:Radix 的下拉在 jsdom 里没有指针/布局引擎,
 * 换掉它测的仍然是**页面自己传下去的 `disabled` 与 `onValueChange`**(那正是这条缺陷所在),
 * Radix 自己怎么渲染 disabled 不归这份测试管。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  quote: vi.fn(),
  confirm: vi.fn(),
  notifyBalanceRefresh: vi.fn(),
}));

vi.mock("@/lib/campaign-generation-confirm", () => ({
  quoteCampaignGeneration: mocks.quote,
  confirmCampaignGeneration: mocks.confirm,
}));
vi.mock("@/lib/balance-refresh", () => ({ notifyBalanceRefresh: mocks.notifyBalanceRefresh }));
vi.mock("@/lib/campaign-view-data", () => ({ getCampaign: vi.fn() }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, disabled, onValueChange, children }: {
    value?: string;
    disabled?: boolean;
    onValueChange?: (value: string) => void;
    children?: ReactNode;
  }) =>
    createElement(
      "select",
      {
        value: value ?? "",
        disabled: Boolean(disabled),
        onChange: (event: { target: { value: string } }) => onValueChange?.(event.target.value),
      },
      children,
    ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) =>
    createElement("option", { value }, children),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CampaignConfirmPage = (await import("@/components/campaign/campaign-confirm-page")).default;

const CAMPAIGN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ENTRY_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";

type PageProps = Parameters<typeof CampaignConfirmPage>[0];
type QuoteOk = Extract<PageProps["quote"], { ok: true }>;

function quoteLine(displayCredits: number) {
  return {
    entryId: ENTRY_ID,
    brief: "A festive product image",
    kind: "image" as const,
    displayCredits,
    fullDisplayCredits: displayCredits,
    charge: "new" as const,
    reuseState: null,
    aspectRatio: "1:1",
    promisedSpec: { aspectRatio: "1:1", count: 1 },
    specChips: [],
  };
}

function serverQuote(totalDisplayCredits: number, fingerprintSeed: string): QuoteOk {
  return {
    ok: true,
    balanceDisplayCredits: 500,
    quote: {
      lines: [quoteLine(totalDisplayCredits)],
      totalDisplayCredits,
      count: 1,
      contentFingerprint: fingerprintSeed.repeat(64),
      deliveryFingerprint: fingerprintSeed.repeat(64),
      reusedCount: 0,
      blockedCount: 0,
    },
    videoMenu: { resolutions: ["720p", "480p"], durations: [5, 10], selected: { resolution: "720p", durationSeconds: 5 } },
  };
}

function pageProps(): PageProps {
  return {
    campaignId: CAMPAIGN_ID,
    detail: {
      ok: true,
      campaign: {
        id: CAMPAIGN_ID,
        name: "Raya launch",
        status: "DRAFT",
        goal: "Launch the Raya collection",
        startAt: "2026-07-24T00:00:00.000Z",
        endAt: "2026-07-31T00:00:00.000Z",
        plan: {
          theme: "Raya",
          rationale: null,
          entries: [{
            id: ENTRY_ID,
            date: "2026-07-25",
            platform: "instagram",
            format: "image",
            hook: "Celebrate together",
            brief: "A festive product image",
            estCredits: 3,
            status: "approved",
          }],
          ideas: [],
        },
        createdAt: "2026-07-23T00:00:00.000Z",
        updatedAt: "2026-07-23T00:00:00.000Z",
        dispatchedEntryIds: [],
        grouped: {
          projects: [
            { id: "project-1", name: "First project", createdAt: "2026-07-23T00:00:00.000Z" },
            { id: "project-2", name: "Second project", createdAt: "2026-07-23T00:00:00.000Z" },
            { id: "project-3", name: "Third project", createdAt: "2026-07-23T00:00:00.000Z" },
          ],
          scheduledPosts: [],
          generations: [],
          broadcasts: [],
        },
        available: { projects: [], scheduledPosts: [], generations: [] },
        trendSnapshots: [],
      },
      nextEntryId: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
      nextEntryProof: "proof",
    },
    quote: serverQuote(3, "a"),
  } as PageProps;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function render() {
  await act(async () => {
    root!.render(createElement(CampaignConfirmPage, pageProps()));
  });
}

function projectSelect(): HTMLSelectElement {
  const select = container!.querySelector("select");
  if (!select) throw new Error("destination project selector not rendered");
  return select as HTMLSelectElement;
}

function confirmButton(): HTMLButtonElement {
  const button = [...container!.querySelectorAll("button")].find((node) =>
    (node.textContent ?? "").includes("Confirm ·"),
  );
  if (!button) throw new Error("confirm button not rendered");
  return button as HTMLButtonElement;
}

/** 换目的项目 —— 页面自己的 onValueChange 会去要一次新价。 */
async function pickProject(id: string) {
  const select = projectSelect();
  await act(async () => {
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("#708 修复轮 P2-2 重报价竞态", () => {
  it("乱序返回时只有最后一次写快照 —— 当前项目不会配上旧项目的报价", async () => {
    const first = deferred<QuoteOk>();
    const second = deferred<QuoteOk>();
    mocks.quote.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render();

    await pickProject("project-2");
    await pickProject("project-3");
    expect(mocks.quote).toHaveBeenCalledTimes(2);
    expect(mocks.quote.mock.calls[1]![1]).toMatchObject({ projectId: "project-3" });

    // 最后一次先回来,先发的那次后到 —— 后到的那次一个字都不许写进去。
    await act(async () => second.resolve(serverQuote(7, "c")));
    await act(async () => first.resolve(serverQuote(99, "b")));

    expect(container!.textContent).toContain("Confirm · 7 credits");
    expect(container!.textContent).not.toContain("99");
  });

  it("过期响应不许解禁按钮:新价没到之前,确认一直是禁用的", async () => {
    const first = deferred<QuoteOk>();
    const second = deferred<QuoteOk>();
    mocks.quote.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render();

    await pickProject("project-2");
    await pickProject("project-3");
    await act(async () => first.resolve(serverQuote(99, "b")));

    expect(confirmButton().disabled).toBe(true);

    await act(async () => second.resolve(serverQuote(7, "c")));
    expect(confirmButton().disabled).toBe(false);
    expect(container!.textContent).toContain("Confirm · 7 credits");
  });

  it("重报价途中选择器锁住 —— 不再叠出第三次乱序", async () => {
    const pending = deferred<QuoteOk>();
    mocks.quote.mockReturnValueOnce(pending.promise);
    await render();
    expect(projectSelect().disabled).toBe(false);

    await pickProject("project-2");
    expect(projectSelect().disabled).toBe(true);

    await act(async () => pending.resolve(serverQuote(7, "c")));
    expect(projectSelect().disabled).toBe(false);
  });

  it("重报价失败:确认锁住,商家不可能拿旧项目的价确认当前项目", async () => {
    const failing = deferred<QuoteOk>();
    mocks.quote.mockReturnValueOnce(failing.promise);
    await render();

    await pickProject("project-2");
    await act(async () => failing.reject(new Error("network down")));

    expect(container!.textContent).toContain("We couldn't refresh the price");
    expect(confirmButton().disabled).toBe(true);

    // 再问一次、这次成功 —— 锁才解开,而且解开时用的是新价。
    const retry = deferred<QuoteOk>();
    mocks.quote.mockReturnValueOnce(retry.promise);
    await pickProject("project-3");
    await act(async () => retry.resolve(serverQuote(4, "d")));

    expect(confirmButton().disabled).toBe(false);
    expect(container!.textContent).toContain("Confirm · 4 credits");
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("服务端说报价出错时同样锁住确认(不是只有传输失败才锁)", async () => {
    const rejected = deferred<QuoteOk | { error: string }>();
    mocks.quote.mockReturnValueOnce(rejected.promise);
    await render();

    await pickProject("project-2");
    await act(async () => rejected.resolve({ error: "That video format isn't available — pick one from the list." }));

    expect(container!.textContent).toContain("isn't available");
    expect(confirmButton().disabled).toBe(true);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #749 判官 r2 P2 —— 结果页的「做完没有」读派发结果,不读派发前的报价
// ---------------------------------------------------------------------------
/**
 * 同规格并发确认下,报价说「这一格新做」而派发结果说「复用」是真会发生的:赢的那一单是
 * 别人刚起的,多半还在 QUEUED。旧写法用**报价行**过滤复用,这一格根本不进过滤器,
 * `every(...)` 空手通过,标题写成「已经全部生成好了」—— 而那一单还在跑。
 */
describe("#749 判官 r2 P2 结果页完成判定", () => {
  it("报价说新做、结果说复用:标题说「还在做」,不许说已经生成好了", async () => {
    const reviewed = serverQuote(3, "a");
    expect(reviewed.quote.lines[0].charge).toBe("new");
    expect(reviewed.quote.lines[0].reuseState).toBeNull();

    mocks.confirm.mockResolvedValue({
      ok: true,
      // 派发结果:这一格被复用了(赢的那一单刚起,还在跑)。
      result: {
        batchId: "batch-1",
        cells: [{ index: 0, type: "gen", status: "reused", jobId: "job-1", credits: 0 }],
        totalCredits: 0,
        dispatched: 0,
        reused: 1,
        failed: 0,
      },
      // 服务端回的报价仍然是那份「新做」的 —— 它是派发**之前**的事实。
      quote: reviewed.quote,
    });

    await render();
    await act(async () => confirmButton().click());

    expect(container!.textContent).toContain("Everything is already being made");
    expect(container!.textContent).not.toContain("Everything was already generated");
    // 汇总那句话同理:不许把一单还在跑的工作说成「已生成」。
    expect(container!.textContent).toContain("already generated or still being made");
  });

  it("结果与报价都说复用且都已做完时,才敢说「已经生成好了」", async () => {
    const reviewed = serverQuote(0, "a");
    reviewed.quote.lines[0] = {
      ...reviewed.quote.lines[0],
      charge: "reused",
      reuseState: "done",
      displayCredits: 0,
    };
    reviewed.quote.reusedCount = 1;

    mocks.confirm.mockResolvedValue({
      ok: true,
      result: {
        batchId: "batch-1",
        cells: [{ index: 0, type: "gen", status: "reused", jobId: "job-1", credits: 0 }],
        totalCredits: 0,
        dispatched: 0,
        reused: 1,
        failed: 0,
      },
      quote: reviewed.quote,
    });

    await render();
    await act(async () => confirmButton().click());

    expect(container!.textContent).toContain("Everything was already generated");
  });
});

// ---------------------------------------------------------------------------
// #749 判官 r4 —— 批次被接管时,结果页必须把话说全
// ---------------------------------------------------------------------------
/**
 * 丢租约意味着另一次确认接管了这个战役:已派发的格是真开始、真扣了钱的,后面的格一格没
 * 开始、一分钱没收。只报一个「部分开始」的标题就是沉默 —— 商家既不知道自己付了多少,也
 * 不知道还差几件、该怎么办。
 */
describe("#749 判官 r4 批次被接管时的结果文案", () => {
  const IN_FLIGHT =
    "Another confirmation for this campaign is still starting its items, so nothing was started here and nothing was charged. Wait for it to finish, then review the updated plan and confirm again.";

  function handoverResult() {
    return {
      ok: true as const,
      result: {
        batchId: "batch-1",
        cells: [
          { index: 0, type: "gen" as const, status: "queued" as const, jobId: "job-1", credits: 30 },
          { index: 1, type: "gen" as const, status: "error" as const, credits: 0, error: IN_FLIGHT },
        ],
        totalCredits: 30,
        dispatched: 1,
        reused: 0,
        failed: 1,
      },
      quote: serverQuote(3, "a").quote,
    };
  }

  it("说清已完成几件、未开始几件、没扣费,并给回去重看的入口", async () => {
    mocks.confirm.mockResolvedValue(handoverResult());
    await render();
    await act(async () => confirmButton().click());

    const text = container!.textContent ?? "";
    expect(text).toContain("Another confirmation took over this campaign");
    expect(text).toContain("1 item was already started and charged");
    expect(text).toContain("1 item was not started and was not charged");
    expect(text).toContain("Review the updated plan and confirm the rest again");
    // 入口是真的按钮,不是一句干说明。
    const review = [...container!.querySelectorAll("button")].find((node) =>
      (node.textContent ?? "").includes("Review the updated plan"),
    );
    expect(review).toBeDefined();
  });

  it("那个入口回到复核卡,并**重新向服务端要一次价**(别人刚动过这个战役)", async () => {
    mocks.confirm.mockResolvedValue(handoverResult());
    mocks.quote.mockResolvedValue(serverQuote(9, "d"));
    await render();
    await act(async () => confirmButton().click());
    expect(mocks.quote).not.toHaveBeenCalled();

    const review = [...container!.querySelectorAll("button")].find((node) =>
      (node.textContent ?? "").includes("Review the updated plan"),
    )!;
    await act(async () => review.click());

    expect(mocks.quote).toHaveBeenCalledTimes(1);
    // 回到复核卡,而且用的是刚拿回来的那份新报价。
    expect(container!.textContent).toContain("Confirm · 9 credits");
    expect(container!.textContent).not.toContain("Another confirmation took over");
  });

  it("普通失败不套用这套说法 —— 它有自己的逐格说明", async () => {
    mocks.confirm.mockResolvedValue({
      ...handoverResult(),
      result: {
        ...handoverResult().result,
        cells: [
          { index: 0, type: "gen" as const, status: "queued" as const, jobId: "job-1", credits: 30 },
          { index: 1, type: "gen" as const, status: "error" as const, credits: 0, error: "Not enough credits." },
        ],
      },
    });
    await render();
    await act(async () => confirmButton().click());

    expect(container!.textContent).not.toContain("Another confirmation took over");
  });

  // #749 判官 r5 P2 —— 混合失败时 M 少报。接管只是**没开始的原因之一**:同一批里积分不足
  // 的格同样一件没开始、一分钱没收。横幅只数接管那一种,商家读到的「还差几件」就是错的,
  // 而他正要照着这个数决定重新确认什么。
  it("混合失败:接管 + 积分不足,「未开始」数的是全部零扣费没开始的格", async () => {
    mocks.confirm.mockResolvedValue({
      ...handoverResult(),
      result: {
        ...handoverResult().result,
        cells: [
          { index: 0, type: "gen" as const, status: "queued" as const, jobId: "job-1", credits: 30 },
          { index: 1, type: "gen" as const, status: "error" as const, credits: 0, error: "Not enough credits." },
          { index: 2, type: "gen" as const, status: "error" as const, credits: 0, error: IN_FLIGHT },
        ],
        totalCredits: 30,
        dispatched: 1,
        reused: 0,
        failed: 2,
      },
    });
    await render();
    await act(async () => confirmButton().click());

    const text = container!.textContent ?? "";
    expect(text).toContain("Another confirmation took over this campaign");
    expect(text).toContain("1 item was already started and charged");
    // 修前:只数接管那一格 ⇒ 「1 item was not started」,而 failed 是 2。
    expect(text).toContain("2 items were not started and were not charged");
    expect(text).not.toContain("1 item was not started");
  });
});
