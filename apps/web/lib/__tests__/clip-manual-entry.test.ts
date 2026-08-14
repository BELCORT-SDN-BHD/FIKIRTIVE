// @vitest-environment jsdom
/**
 * #922 缺口 A —— 「改这条片子 / 把这条片子接下去」的商家手动入口。
 *
 * 这一份要证明的四件事,一件都不能靠读代码相信:
 *   ① 入口铸出来的那段字,是**官方锚定句式**——由 core 的钱路判据 `anchoredVideoAction`
 *      亲自认出来,而不是由这份测试自己再写一遍正则。商家打的那句话逐字还在里面。
 *   ② 入口到「确认」为止 **$0**:铸卡这一步一个 GenJob 都不建、一分钱都不预扣;界面上
 *      按下 "Get a price" 也**不会**调到花钱的那个动作。
 *   ③ 确认走的是**既有**扣费路(`coworkGenerate(cardId)`),幂等域仍是那张卡自己的
 *      `cowork:<cardId>` —— 没有第二条收费路。
 *   ④ 租户:片子的查询是 owner 作用域的,别的租户的片子读不出来,一张卡也不铸。
 *
 * 红/绿演练(逐一实做,做完全部还原,见 PR 说明):
 *   · 把 `proposeClipActionCard` 里 generation 查询的 `ownerId` 去掉 ⇒ 「跨租户读不出来」当场红。
 *   · 把 `anchoredClipLines` 换成自己拼一句 `Edit the clip, …` ⇒ 「官方句式」那条当场红
 *     (core 的判据认不出来),而入口本身照样跑得通 —— 正是这条测试要挡的那种漂移。
 *   · 把 ClipActions 的 "Get a price" 改成直接调 `coworkGenerate` ⇒ 「$0 到确认」当场红。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { anchoredVideoAction, VIDEO_ASPECT_ADAPTIVE, GEN_VIDEO_MODEL_OPTIONS } from "@fikirtive/core";

// React 18/19 的 act 门:不打开,act(...) 会警告并且不刷新更新队列。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEB_ROOT = path.resolve(__dirname, "../..");
const read = (relative: string) => fs.readFileSync(path.join(WEB_ROOT, relative), "utf8");

// ---------------------------------------------------------------------------
// Mocks — the server-action side. Only the two prisma delegates the action touches
// are provided, so "it never built a GenJob" is provable by the ABSENCE of that
// delegate: a spend attempt would throw, not silently pass.
// ---------------------------------------------------------------------------
const {
  mockOwner,
  mockGenerationFindFirst,
  mockThreadFindFirst,
  mockThreadCreate,
  mockProjectFindFirst,
  mockChatFindFirst,
  mockChatCreate,
  mockResolveDisabled,
  db,
} = vi.hoisted(() => {
  const mockGenerationFindFirst = vi.fn();
  const mockThreadFindFirst = vi.fn();
  const mockThreadCreate = vi.fn();
  const mockProjectFindFirst = vi.fn();
  const mockChatFindFirst = vi.fn();
  const mockChatCreate = vi.fn();
  return {
    mockOwner: vi.fn(),
    mockGenerationFindFirst,
    mockThreadFindFirst,
    mockThreadCreate,
    mockProjectFindFirst,
    mockChatFindFirst,
    mockChatCreate,
    mockResolveDisabled: vi.fn(),
    db: {
      generation: { findFirst: mockGenerationFindFirst },
      chatThread: { findFirst: mockThreadFindFirst, create: mockThreadCreate },
      project: { findFirst: mockProjectFindFirst },
      chatMessage: { findFirst: mockChatFindFirst, create: mockChatCreate },
      // 刻意**不**提供 genJob / ledger / reservation:这条路碰到它们就是 TypeError,
      // 而不是一次悄悄通过的断言。
    },
  };
});

vi.mock("../auth-guard", async () => ({
  requireOwner: mockOwner,
  resolveUserPrincipal: (await import("./__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("../model-registry", () => ({ resolveDisabledModels: mockResolveDisabled }));
vi.mock("@fikirtive/db", () => ({ prisma: db, Prisma: {} }));
vi.mock("@fikirtive/db/principal", () => ({
  runAsUser: async (_p: unknown, fn: () => unknown) => fn(),
}));

let idCounter = 0;
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: () => `new-${++idCounter}`,
}));

const { proposeClipActionCard } = await import("../clip-actions");
const { clipEntrySegment, CLIP_ENTRY_COPY, CLIP_ENTRY_WORDING_MAX } = await import("../clip-action-entry");

const OWNER = "owner-1";
const CLIP = "gen_clip_1";

function armHappyPath(): void {
  mockOwner.mockResolvedValue({ ownerId: OWNER, userId: "user-1" });
  mockResolveDisabled.mockResolvedValue({ disabled: new Set<string>() });
  mockGenerationFindFirst.mockResolvedValue({ id: CLIP, projectId: "proj-1", threadId: "thread-1" });
  mockThreadFindFirst.mockResolvedValue({ id: "thread-1" });
  mockChatFindFirst.mockResolvedValue({ seq: 7 });
  mockChatCreate.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
});

// ---------------------------------------------------------------------------
describe("#922 缺口 A — 商家措辞 → 官方锚定句式", () => {
  it("剪辑铸出来的那段字,由钱路判据自己认成 editClip,商家的话逐字还在", async () => {
    armHappyPath();
    const result = await proposeClipActionCard({
      generationId: CLIP,
      action: "edit",
      wording: "  the shirt to red.  ",
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    // 判据来自 @fikirtive/core —— `genRequest` 与 `gen-from-card` 读的**同一个**函数。
    expect(anchoredVideoAction(result.structuredPrompt)).toBe("editClip");
    // 商家的话原样在里面(首尾空白与句末句号是入口去的,不是改写)。
    expect(result.structuredPrompt).toContain("the shirt to red");
    // 边界句 —— 少了它「严格编辑」只是个形容词。
    expect(result.structuredPrompt).toContain("Keep every other part of the clip exactly as it is.");
  });

  it("续写铸出来的那段字被认成 extendClip", async () => {
    armHappyPath();
    const result = await proposeClipActionCard({
      generationId: CLIP,
      action: "extend",
      wording: "she walks out of frame",
    });
    if ("error" in result) throw new Error(result.error);
    expect(anchoredVideoAction(result.structuredPrompt)).toBe("extendClip");
    expect(result.structuredPrompt).toContain("she walks out of frame");
  });

  it("卡钉在商家那条片子上,画幅跟着它走 —— 与 Otto 路逐字同一个语义", async () => {
    armHappyPath();
    const result = await proposeClipActionCard({ generationId: CLIP, action: "edit", wording: "the sky to dusk" });
    if ("error" in result) throw new Error(result.error);
    const payload = mockChatCreate.mock.calls[0]![0].data.payload as {
      kind: string;
      referenceVideoGenerationId?: string;
      params: { aspectRatio?: string };
    };
    expect(payload.kind).toBe("video");
    expect(payload.referenceVideoGenerationId).toBe(CLIP);
    expect(payload.params.aspectRatio).toBe(VIDEO_ASPECT_ADAPTIVE);
    expect(result.estimatedCredits).toBeGreaterThan(0);
  });

  it("商家的话是空的 / 太长 ⇒ 一张卡都不铸", async () => {
    armHappyPath();
    for (const wording of ["   ", "x".repeat(CLIP_ENTRY_WORDING_MAX + 1)]) {
      const result = await proposeClipActionCard({ generationId: CLIP, action: "edit", wording });
      expect("error" in result).toBe(true);
    }
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it("clipEntrySegment 只做三件事:去空白、去句末句号、判长度 —— 不润色", () => {
    expect(clipEntrySegment("  the shirt to red.  ")).toEqual({ segment: "the shirt to red" });
    expect(clipEntrySegment("make the SHIRT red")).toEqual({ segment: "make the SHIRT red" });
    expect(clipEntrySegment("  ")).toHaveProperty("error");
    expect(clipEntrySegment("x".repeat(CLIP_ENTRY_WORDING_MAX + 1))).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
describe("#922 缺口 A — 铸卡这一步 $0", () => {
  it("只写一行 GEN_CARD,没有任何钱路记录", async () => {
    armHappyPath();
    const result = await proposeClipActionCard({ generationId: CLIP, action: "edit", wording: "the shirt to red" });
    if ("error" in result) throw new Error(result.error);
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    const row = mockChatCreate.mock.calls[0]![0].data;
    expect(row.kind).toBe("GEN_CARD");
    expect(row.ownerId).toBe(OWNER);
    // 未生成的卡:genJobId 不写。写了就等于说这张卡已经跑过。
    expect(row.genJobId).toBeUndefined();
    // db 替身**没有** genJob 委托 —— 走到那里会 TypeError,不会静默通过。
    expect((db as Record<string, unknown>).genJob).toBeUndefined();
  });

  it("引擎被关掉 ⇒ 一句人话,一张卡都不铸", async () => {
    armHappyPath();
    // 视频这一档的引擎全部被禁用 ⇒ buildProposeCard 抛 ProposeRefusal。名单从事实表取,
    // 不手抄 —— 手抄的那一份在换引擎时不会跟着变,这条测试就会悄悄变成永远绿的。
    mockResolveDisabled.mockResolvedValue({ disabled: new Set(Object.keys(GEN_VIDEO_MODEL_OPTIONS)) });
    const result = await proposeClipActionCard({ generationId: CLIP, action: "edit", wording: "the shirt to red" });
    expect("error" in result).toBe(true);
    expect(mockChatCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("#922 缺口 A — 租户", () => {
  it("片子的查询是 owner 作用域的", async () => {
    armHappyPath();
    await proposeClipActionCard({ generationId: CLIP, action: "edit", wording: "the shirt to red" });
    expect(mockGenerationFindFirst.mock.calls[0]![0].where).toMatchObject({
      id: CLIP,
      ownerId: OWNER,
      deletedAt: null,
    });
  });

  it("别的租户的片子:读不出来 ⇒ 一张卡都不铸", async () => {
    armHappyPath();
    mockGenerationFindFirst.mockResolvedValue(null); // owner 作用域的查询对别人的片子就是空
    const result = await proposeClipActionCard({ generationId: "gen_of_other_tenant", action: "edit", wording: "x" });
    expect(result).toEqual({ error: "That clip isn't available." });
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it("不是视频扩展名的那一行(图片):同一个校验器挡下,一张卡都不铸", async () => {
    armHappyPath();
    // 第一趟(自己那一行)读得到;第二趟(带 asset.ext 视频白名单的校验器)读不到。
    mockGenerationFindFirst
      .mockResolvedValueOnce({ id: CLIP, projectId: "proj-1", threadId: "thread-1" })
      .mockResolvedValueOnce(null);
    const result = await proposeClipActionCard({ generationId: CLIP, action: "edit", wording: "x" });
    expect(result).toEqual({ error: "That clip isn't available." });
    expect(mockChatCreate).not.toHaveBeenCalled();
    // 校验器问的确实是视频扩展名,而且带着这个租户与这个项目。
    expect(mockGenerationFindFirst.mock.calls[1]![0].where).toMatchObject({
      id: CLIP,
      ownerId: OWNER,
      projectId: "proj-1",
      asset: { ext: { in: ["mp4", "mov", "webm"] } },
    });
  });

  it("卡落在这条片子出生的那条会话里(有迹可循),会话查询同样是 owner 作用域的", async () => {
    armHappyPath();
    await proposeClipActionCard({ generationId: CLIP, action: "edit", wording: "the shirt to red" });
    expect(mockThreadFindFirst.mock.calls[0]![0].where).toMatchObject({
      id: "thread-1",
      ownerId: OWNER,
      projectId: "proj-1",
      deletedAt: null,
    });
    expect(mockChatCreate.mock.calls[0]![0].data.threadId).toBe("thread-1");
    expect(mockThreadCreate).not.toHaveBeenCalled();
  });

  it("那条会话没了、项目里也一条活会话都没有 ⇒ 开一条,项目查询照样 owner 作用域", async () => {
    armHappyPath();
    mockThreadFindFirst.mockResolvedValue(null); // 出生的那条 + 最近那条,都读不到
    mockProjectFindFirst.mockResolvedValue({ id: "proj-1" });
    mockThreadCreate.mockResolvedValue({});
    const result = await proposeClipActionCard({ generationId: CLIP, action: "edit", wording: "the shirt to red" });
    if ("error" in result) throw new Error(result.error);
    expect(mockProjectFindFirst.mock.calls[0]![0].where).toMatchObject({ id: "proj-1", ownerId: OWNER, deletedAt: null });
    expect(mockThreadCreate).toHaveBeenCalledTimes(1);
    expect(mockThreadCreate.mock.calls[0]![0].data).toMatchObject({ ownerId: OWNER, projectId: "proj-1" });
    expect(mockChatCreate.mock.calls[0]![0].data.threadId).toBe(mockThreadCreate.mock.calls[0]![0].data.id);
  });

  it("项目也不是这个租户的 ⇒ 不开会话、不铸卡", async () => {
    armHappyPath();
    mockThreadFindFirst.mockResolvedValue(null);
    mockProjectFindFirst.mockResolvedValue(null);
    const result = await proposeClipActionCard({ generationId: CLIP, action: "edit", wording: "x" });
    expect("error" in result).toBe(true);
    expect(mockThreadCreate).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it("未登录 ⇒ 直接回错,一次库都不查", async () => {
    mockOwner.mockResolvedValue({ error: "Not signed in." });
    const result = await proposeClipActionCard({ generationId: CLIP, action: "edit", wording: "x" });
    expect(result).toEqual({ error: "Not signed in." });
    expect(mockGenerationFindFirst).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 界面这一侧 —— 真的挂上去点一遍。
// ---------------------------------------------------------------------------
// 界面这一侧刻意**不**替身 `proposeClipActionCard` —— 它跑的是上面那个真的铸卡动作
// (库是替身),所以「点下去到底铸出什么」由同一份代码回答,不是由测试自己编一个返回值。
// 只替身花钱那一个,因为那正是要断言「按到确认之前一次都没被调到」的对象。
const uiMocks = vi.hoisted(() => ({ coworkGenerate: vi.fn() }));
vi.mock("../cowork-actions", () => ({ coworkGenerate: uiMocks.coworkGenerate }));
vi.mock("../balance-refresh", () => ({ notifyBalanceRefresh: vi.fn() }));

describe("#922 缺口 A — 入口本身", () => {
  it("入口只挂在已出片的视频上(图片这一面一个字不变)", () => {
    const src = read("components/asset/DetailPanel.tsx");
    // 调用点被 kind === "video" 这一条守着 —— 抓的是「守卫 + 调用」这一对,不是两处巧合。
    expect(src).toMatch(/gen\.kind === "video" && \(\s*<ClipActions/);
    // 图片那两条既有的付费入口(Regenerate / Animate)一个字没被这次改动碰到。
    expect(src).toContain('{gen.kind === "image" && (');
  });

  it("入口这一侧唯一的花钱调用是既有的 coworkGenerate —— 没有第二条收费路", () => {
    const src = read("components/asset/ClipActions.tsx");
    expect(src).toContain('import { coworkGenerate } from "@/lib/cowork-actions"');
    // startGen / startAssetGen / reserve / settle 一个都不在这一面里。
    for (const forbidden of ["startGen", "startAssetGen", "reserveCredits", "settle", "refund"]) {
      expect(src, `ClipActions 不该自己碰 ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("两个入口键都在,措辞是 English sentence case", () => {
    expect(CLIP_ENTRY_COPY.edit.cta).toBe("Edit this clip");
    expect(CLIP_ENTRY_COPY.extend.cta).toBe("Continue this clip");
    for (const key of ["edit", "extend"] as const) {
      for (const text of Object.values(CLIP_ENTRY_COPY[key])) {
        // 白标:一处供应商名字都没有。
        expect(text.toLowerCase()).not.toMatch(/seedance|byteplus|ark|volc/);
      }
    }
  });
});

describe("#922 缺口 A — 按下去之前一分钱都不花", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  async function mount(): Promise<void> {
    const { ClipActions } = await import("../../components/asset/ClipActions");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(ClipActions, { generationId: CLIP }));
    });
  }

  function buttonNamed(name: string): HTMLButtonElement {
    const found = [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
    if (!found) throw new Error(`no button named "${name}" — saw: ${[...container!.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
    return found as HTMLButtonElement;
  }

  async function click(el: HTMLElement): Promise<void> {
    await act(async () => { el.click(); });
  }

  beforeEach(() => {
    uiMocks.coworkGenerate.mockReset();
    armHappyPath();
  });

  it("点入口 → 打字 → 拿报价:全程零次扣费调用;确认那一下才走既有的 coworkGenerate", async () => {
    uiMocks.coworkGenerate.mockResolvedValue({ id: "job-1" });
    await mount();

    // ① 两个入口都在。
    expect(buttonNamed("Edit this clip")).toBeTruthy();
    expect(buttonNamed("Continue this clip")).toBeTruthy();

    // ② 展开措辞框、打一句话。
    await click(buttonNamed("Edit this clip"));
    const box = container!.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(box, "the shirt to red");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // ③ 拿报价 —— 这一步铸卡,**一次扣费调用都没有**。
    await click(buttonNamed("Get a price"));
    expect(uiMocks.coworkGenerate).not.toHaveBeenCalled();
    expect(container!.textContent).toContain("This will spend real credits.");
    // 批准前商家看得见卡上冻结的那一整段字。
    expect(container!.textContent).toContain("the shirt to red");

    // ④ 确认 —— 唯一花钱的那一下,走的是既有的卡路径,幂等域是那张卡自己。
    await click(buttonNamed("Confirm"));
    expect(uiMocks.coworkGenerate).toHaveBeenCalledTimes(1);
    const sent = uiMocks.coworkGenerate.mock.calls[0]![0] as { cardId: string; prompt: string };
    expect(sent.cardId).toMatch(/^new-/);
    expect(anchoredVideoAction(sent.prompt)).toBe("editClip");
  });

  it("没打字之前拿不到报价 —— 按钮是停用的", async () => {
    await mount();
    await click(buttonNamed("Edit this clip"));
    expect(buttonNamed("Get a price").disabled).toBe(true);
    expect(uiMocks.coworkGenerate).not.toHaveBeenCalled();
  });
});
