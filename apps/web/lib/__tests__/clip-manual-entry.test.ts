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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  anchoredVideoAction, anchoredActionUnavailableReason, VIDEO_ASPECT_ADAPTIVE, GEN_VIDEO_MODEL_OPTIONS,
  // 判官 r3 P1 的第②层:卡→付费请求的构造器与付费 schema 本身,
  // 与 core 的 anchored-spend-gate 用的是同一对判据,不另抄一份。
  buildGenRequestFromCard, genRequest,
} from "@fikirtive/core";

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
  // 事务替身:**缓冲**写入,回调成功才回放到上面那两个 spy 上,抛了就整批丢掉 ——
  // 「拒绝时零落库」于是是一条真断言,不是「抛得比第一次写更早」的副产物
  // (与 storyboard-gate1-actions.test.ts 的 $transaction 替身同一个做法)。
  const db: Record<string, unknown> = {
    generation: { findFirst: mockGenerationFindFirst },
    // `create` 在**事务外**也要给 —— 不给的话,「在铸卡之前就建会话」那种写法会撞上
    // undefined 而抛错,于是「零新会话落库」会因为**报错**而变绿,不是因为规矩成立。
    // 红演练 C 第一次跑就撞到了这个假绿,补上之后它才真的会红。
    chatThread: { findFirst: mockThreadFindFirst, create: mockThreadCreate },
    project: { findFirst: mockProjectFindFirst },
    chatMessage: { findFirst: mockChatFindFirst, create: mockChatCreate },
    // 刻意**不**提供 genJob / ledger / reservation:这条路碰到它们就是 TypeError,
    // 而不是一次悄悄通过的断言。
  };
  db.$transaction = async (fn: (tx: unknown) => unknown) => {
    const staged: Array<() => Promise<unknown>> = [];
    const tx = {
      chatThread: { create: async (args: unknown) => { staged.push(() => mockThreadCreate(args)); return {}; } },
      chatMessage: {
        findFirst: mockChatFindFirst,
        create: async (args: unknown) => { staged.push(() => mockChatCreate(args)); return {}; },
      },
    };
    const result = await fn(tx);
    for (const write of staged) await write();
    return result;
  };
  return {
    mockOwner: vi.fn(),
    mockGenerationFindFirst,
    mockThreadFindFirst,
    mockThreadCreate,
    mockProjectFindFirst,
    mockChatFindFirst,
    mockChatCreate,
    mockResolveDisabled: vi.fn(),
    db,
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
const { clipEntrySegment, CLIP_ENTRY_ACTIONS, CLIP_ENTRY_COPY, CLIP_ENTRY_WORDING_MAX } = await import("../clip-action-entry");

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
  it("剪辑铸出来的那段字,由钱路判据自己认成 editClip", async () => {
    armHappyPath();
    const result = await proposeClipActionCard({
      generationId: CLIP,
      action: "edit",
      wording: "the shirt to red",
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    // 判据来自 @fikirtive/core —— `genRequest` 与 `gen-from-card` 读的**同一个**函数。
    expect(anchoredVideoAction(result.structuredPrompt)).toBe("editClip");
    // 整段逐字节核对:官方开头 + 商家的话 + 边界句,一个字都不多不少。
    expect(result.structuredPrompt).toBe(
      "Strictly edit <Video_1>, and modify the shirt to red.\n" +
        "Keep every other part of the clip exactly as it is.",
    );
  });

  /**
   * #922 —— 续写在 beta 期间下架(Founder 裁决 2026-08-14)。
   *
   * 这一条原本断言「续写铸出来的那段字被认成 extendClip」。现在断言的是它**铸不出来**,
   * 而且拒绝那句话与 core 的下架名单逐字同一份 —— 这条服务端路径**没有自己的判断**:
   * 它连 enum 都没裁,靠的就是 `buildProposeCard` 走能力表当场拒。这条测试正是那件事的
   * 证据(单一权威真的贯通到了这一层),不是它的替代品。
   */
  it("#922:续写下架 ⇒ 服务端一张卡都不铸,回的是名单里那句人话", async () => {
    armHappyPath();
    const result = await proposeClipActionCard({
      generationId: CLIP,
      action: "extend",
      wording: "she walks out of frame",
    });
    expect(result).toEqual({ error: anchoredActionUnavailableReason("extendClip") });
    // 拒绝路径零写入:会话没建、卡没落库(与 r1 P2-2 同一条纪律)。
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it("#922:同一条路上的剪辑一个字节没变", async () => {
    armHappyPath();
    const result = await proposeClipActionCard({
      generationId: CLIP,
      action: "edit",
      wording: "she walks out of frame",
    });
    if ("error" in result) throw new Error(result.error);
    expect(anchoredVideoAction(result.structuredPrompt)).toBe("editClip");
  });

  /**
   * 判官 r1 P2-1 —— 商家打进去的那句话,在卡文本里**逐字节**还在。
   *
   * 上一版在入口层删首尾空白、删句末句号,于是「商家看到的」与「真发生的」分了家
   * (#917 整票为的就是这件事)。这一组把那件事钉死:对每一种写法,卡文本必须**恰好**
   * 等于「官方开头 + 商家原文 + 只在需要时补的那个句号」,而商家原文那一段用
   * `indexOf` 做子串核对 —— 断的是原始字节,不是 trim 过的副本。
   */
  describe("商家的话逐字节保留(判官 r1 P2-1)", () => {
    const EDIT_HEAD = "Strictly edit <Video_1>, and modify";
    const EDIT_TAIL = "\nKeep every other part of the clip exactly as it is.";

    const cases: { name: string; wording: string; expected: string }[] = [
      {
        name: "商家自己写了句号 ⇒ 句号留着,装配器不再补一个(不会出现 '..')",
        wording: "the shirt to red.",
        expected: `${EDIT_HEAD} the shirt to red.${EDIT_TAIL}`,
      },
      {
        name: "商家自己写了问号 ⇒ 原样留着",
        wording: "can you make the sky brighter?",
        expected: `${EDIT_HEAD} can you make the sky brighter?${EDIT_TAIL}`,
      },
      {
        name: "商家写了全角句号(华语/马来西亚商家常见)⇒ 原样留着",
        wording: "把衬衫改成红色。",
        expected: `${EDIT_HEAD} 把衬衫改成红色。${EDIT_TAIL}`,
      },
      {
        name: "没有句末标点 ⇒ 装配器补一个,商家的字节一个不动",
        wording: "the shirt to red",
        expected: `${EDIT_HEAD} the shirt to red.${EDIT_TAIL}`,
      },
      {
        name: "句中的句号一个都不许被当成句末标点删掉",
        wording: "make it 1.5x brighter",
        expected: `${EDIT_HEAD} make it 1.5x brighter.${EDIT_TAIL}`,
      },
      {
        name: "首尾空白也是商家打的字节 ⇒ 原样保留(前导那一个跟在装配层的分隔空格后面)",
        wording: " the shirt to red ",
        expected: `${EDIT_HEAD}  the shirt to red .${EDIT_TAIL}`,
      },
      {
        name: "省略号收尾 ⇒ 不补那第四个点(判官 r3 P3 点名的显式案例)",
        wording: "Wait...",
        expected: `${EDIT_HEAD} Wait...${EDIT_TAIL}`,
      },
    ];

    for (const c of cases) {
      it(c.name, async () => {
        armHappyPath();
        const result = await proposeClipActionCard({ generationId: CLIP, action: "edit", wording: c.wording });
        if ("error" in result) throw new Error(result.error);
        // ① 整段逐字节。
        expect(result.structuredPrompt).toBe(c.expected);
        // ② 商家的原始字节原封不动地出现在里面(断的是 `wording` 本身,不是任何副本)。
        expect(result.structuredPrompt.includes(c.wording)).toBe(true);
        // ③ 落库那一份与回传那一份是同一段字 —— 卡上冻结的就是屏幕上给他看的。
        const payload = mockChatCreate.mock.calls[0]![0].data.payload as { structuredPrompt: string };
        expect(payload.structuredPrompt).toBe(c.expected);
        // ④ 改成什么样都还得是官方句式,否则钱路判据认不出来。
        expect(anchoredVideoAction(result.structuredPrompt)).toBe("editClip");
      });
    }
  });

  /**
   * 判官 r3 P1 —— 前导空白不许改变商家批准并付费的**操作语义**。
   *
   * 措辞框收得下 tab / 换行,入口层也只判长度不判形状,所以「以 tab 起头」是一条**可达**
   * 输入。r1 那一版的装配器遇到它就不补分隔空格,而 core 的识别器只认字面 ASCII 空格 ——
   * 于是这条片子的「严格编辑」在商家毫不知情的情况下退化成中性的 guideFromClip:
   * 卡上的画幅从 adaptive 变回 16:9,付费 schema 那道 anchored 收紧整条不执行。
   *
   * 所以这一组不只看卡文本,而是把**两层**一起走一遍(与 core 的 anchored-spend-gate
   * 同一条口径):① 卡层 —— 认得出动作、画幅是 adaptive;② 付费层 —— 卡→请求的构造器
   * 顶得住客户端的比例覆盖,且付费 schema 本身会拒绝一个非 adaptive 的同段提示词。
   * 只断第①层是不够的:P1 掉的正是第②层整条不执行。
   */
  describe("前导空白的五种起头形态 ⇒ 两层都仍然是 anchored(判官 r3 P1)", () => {
    const FORMS: Array<[string, string]> = [
      ["无前导空白", "the shirt to red"],
      ["前导空格", " the shirt to red"],
      ["前导 tab", "\tthe shirt to red"],
      ["前导换行", "\nthe shirt to red"],
      ["前导回车", "\rthe shirt to red"],
    ];

    for (const [name, wording] of FORMS) {
      it(`${name} ⇒ 卡层认 editClip / adaptive,付费层收紧照常执行`, async () => {
        armHappyPath();
        const result = await proposeClipActionCard({ generationId: CLIP, action: "edit", wording });
        if ("error" in result) throw new Error(result.error);

        // 商家的字节仍然一个不动。
        expect(result.structuredPrompt.includes(wording)).toBe(true);

        // ── 第①层:卡 ──────────────────────────────────────────────
        expect(anchoredVideoAction(result.structuredPrompt)).toBe("editClip");
        const payload = mockChatCreate.mock.calls[0]![0].data.payload as {
          structuredPrompt: string;
          referenceVideoGenerationId?: string;
          params: { aspectRatio?: string };
        };
        expect(payload.params.aspectRatio).toBe(VIDEO_ASPECT_ADAPTIVE);
        expect(payload.referenceVideoGenerationId).toBe(CLIP);

        // ── 第②层:付费边界 ────────────────────────────────────────
        // 卡→请求:客户端把比例覆盖成 16:9 也不作数,卡上的 adaptive 说了算。
        const built = buildGenRequestFromCard({
          projectId: "p", threadId: "t", cardId: "c", entityIds: [], variantSel: {},
          cardPayload: payload,
          prompt: payload.structuredPrompt,
          overrides: { aspectRatio: "16:9" },
        });
        if (!built.ok) throw new Error("卡→请求应当构造得出来");
        expect(built.req.aspectRatio).toBe(VIDEO_ASPECT_ADAPTIVE);

        // 付费 schema 本身:同一段提示词配一个非 adaptive 的比例,必须被拒。
        // 这一条才是 P1 真正掉掉的东西 —— 识别不出来时它整条不执行,于是静默放行。
        const req = { ...built.req, idempotencyKey: "cowork:c" };
        expect(genRequest.safeParse(req).success).toBe(true);
        expect(genRequest.safeParse({ ...req, aspectRatio: "16:9" }).success).toBe(false);
        // 片子没带上也必须被拒(anchored 收紧的另一半)。
        const noClip: Record<string, unknown> = { ...req };
        delete noClip.referenceVideoGenerationId;
        expect(genRequest.safeParse(noClip).success).toBe(false);
      });
    }
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

  it("clipEntrySegment 只判不改:原文一个字节都不动(判官 r1 P2-1)", () => {
    // 上一版这条测试期望的正是被判掉的那个行为(把 "  the shirt to red.  " 改写成
    // "the shirt to red")。现在钉的是反过来那件事:返回的就是传进去的那一份。
    for (const raw of [
      "  the shirt to red.  ",
      "the shirt to red",
      "make the SHIRT red",
      "把衬衫改成红色。",
      "make it 1.5x brighter",
      "\tleading tab and trailing newline\n",
    ]) {
      expect(clipEntrySegment(raw)).toEqual({ segment: raw });
    }
    // 判长度看的是去掉首尾空白之后的样子(空格不是内容),但返回仍是原文。
    const padded = `  ${"x".repeat(CLIP_ENTRY_WORDING_MAX)}  `;
    expect(clipEntrySegment(padded)).toEqual({ segment: padded });
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

  /**
   * 判官 r1 P2-2 —— 被拒绝的一次点击不许留下痕迹。
   *
   * 上一版在铸卡**之前**就把新会话建好了。于是「引擎被关掉」× 「这个项目还没有会话」
   * 这个组合下,商家什么都没拿到,会话列表里却凭空多出一条空的 "Untitled"。
   */
  it("引擎被关掉 × 项目里一条会话都没有 ⇒ 零新会话落库、零卡落库", async () => {
    armHappyPath();
    mockThreadFindFirst.mockResolvedValue(null); // 出生的那条 + 最近那条,都读不到
    mockProjectFindFirst.mockResolvedValue({ id: "proj-1" });
    mockResolveDisabled.mockResolvedValue({ disabled: new Set(Object.keys(GEN_VIDEO_MODEL_OPTIONS)) });

    const result = await proposeClipActionCard({ generationId: CLIP, action: "edit", wording: "the shirt to red" });

    expect("error" in result).toBe(true);
    expect(mockThreadCreate, "被拒绝的一次点击留下了一条空会话").not.toHaveBeenCalled();
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
    // 校验器问的确实是视频扩展名,而且带着这个租户。
    // Codex QA-CRE-FE9-013 之后判据里不再有 `projectId`:引用范围 = 同一 owner 的任意画布
    // (画布是出处,不是权限边界)。这条入口的行为一格未变 —— `projectId` 本来就是从这一行
    // **自己**读出来再传回去的,它从来不是一个独立的限制。
    expect(mockGenerationFindFirst.mock.calls[1]![0].where).toMatchObject({
      id: CLIP,
      ownerId: OWNER,
      deletedAt: null,
      asset: { ext: { in: ["mp4", "mov", "webm"] } },
    });
    expect(JSON.stringify(mockGenerationFindFirst.mock.calls[1]![0].where)).not.toContain("projectId");
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

  it("措辞两档都还在(下架不是删文案),English sentence case、白标", () => {
    expect(CLIP_ENTRY_COPY.edit.cta).toBe("Edit this clip");
    // 续写的措辞刻意原样留着 —— 恢复的那一天靠的就是它,名单一删这个键自己回来。
    expect(CLIP_ENTRY_COPY.extend.cta).toBe("Continue this clip");
    for (const key of ["edit", "extend"] as const) {
      for (const text of Object.values(CLIP_ENTRY_COPY[key])) {
        // 白标:一处供应商名字都没有。
        expect(text.toLowerCase()).not.toMatch(/seedance|byteplus|ark|volc/);
      }
    }
  });

  /**
   * #922 —— **画出来的键**由 core 的下架名单说了算,界面这一侧不另判一次。
   *
   * 判据用的是 core 那个函数本身,不是把 `["edit"]` 手抄一遍:抄一遍,名单改了而这条
   * 测试没改,它会继续绿着为一个已经过期的界面作证。
   */
  it("#922:详情面板只画名单里开着的那些键 —— 续写的键不画", () => {
    expect(CLIP_ENTRY_ACTIONS).toEqual(
      (["edit", "extend"] as const).filter(
        (a) => anchoredActionUnavailableReason(a === "extend" ? "extendClip" : "editClip") === null,
      ),
    );
    expect(CLIP_ENTRY_ACTIONS).not.toContain("extend");
    expect(CLIP_ENTRY_ACTIONS).toContain("edit");
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

  /** 挂上去的东西必须在本文件里拆干净。
   *
   *  这不是打扫卫生,是一条真事故的补丁:apps/web 的 vitest 配置是
   *  `pool: "threads"` + `singleThread: true` —— 全部 350 个测试文件跑在**同一条线程**上。
   *  `isolate` 只换掉模块表与 jsdom,**换不掉这条线程的事件循环**:一个没卸载的 React 根
   *  留下的异步更新,会在**下一个文件**的测试里落地。React 的 act 队列是每份 React 实例
   *  一条、跨文件共用的,所以那一笔野更新会被邻居的 `await act(...)` 收走 —— 邻居自己
   *  等的那些更新反而没等到。
   *
   *  这正是 r2 头一次云 CI 红的原因:排在这个文件后面的是 `canvas-video-spec-ui.test.ts`,
   *  它的三条断言当场变成「按了没反应」,而 vitest 打出来的警告写着
   *  `An update to ClipActions inside a test was not wrapped in act(...)` —— 组件名是
   *  这个文件的,文件名却是邻居的。本机跑绿是因为文件顺序不同(邻居换了人)。
   *
   *  所以:每个用例结束就卸载、摘掉容器,再排空一轮微任务,让最后那一笔 setState 死在
   *  本文件的 act 作用域里。 */
  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    container?.remove();
    root = null;
    container = null;
    await act(async () => { await Promise.resolve(); });
  });

  it("点入口 → 打字 → 拿报价:全程零次扣费调用;确认那一下才走既有的 coworkGenerate", async () => {
    uiMocks.coworkGenerate.mockResolvedValue({ id: "job-1" });
    await mount();

    // ① 剪辑的入口在;续写的键在 beta 期间根本不画(#922)。
    expect(buttonNamed("Edit this clip")).toBeTruthy();
    expect(() => buttonNamed("Continue this clip")).toThrow();

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

  it("确认付费后立即显示 Spinner、锁住取消键，并把失败原因放进标准 Alert", async () => {
    let finish: ((result: { id: string } | { error: string }) => void) | undefined;
    uiMocks.coworkGenerate.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await mount();
    await click(buttonNamed("Edit this clip"));

    const box = container!.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(box, "the shirt to red");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(buttonNamed("Get a price"));

    const confirm = buttonNamed("Confirm");
    const cancel = buttonNamed("Cancel");
    await click(confirm);

    expect(confirm.disabled).toBe(true);
    expect(confirm.textContent).toContain("Starting edit…");
    expect(confirm.querySelector(".animate-spin")).not.toBeNull();
    expect(cancel.disabled).toBe(true);

    await act(async () => {
      finish?.({ error: "Your balance is too low for this edit." });
      await Promise.resolve();
    });

    const alert = container!.querySelector('[data-slot="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.getAttribute("role")).toBe("alert");
    expect(alert!.textContent).toContain("Your balance is too low for this edit.");
    expect(buttonNamed("Confirm").disabled).toBe(false);
  });
});
