// @vitest-environment jsdom
/**
 * r22-canvas-human-copy.test.ts —— 画布上 Otto 说的话必须是**人话**,而且一句寒暄不该
 * 变成一次生成。
 *
 * 病灶(Founder 2026-08-25 亲验):这一面把「诚实原则」写成了工程师黑话怼在商家眼前 ——
 * 「Receipt fixture-action-0」「fixture result saved」「Fixture generation completed once.
 * Production success still requires a durable backend receipt.」。诚实没有错,措辞错了:
 * 商家读不懂 receipt 是什么,更不知道 fixture 是谁。
 *
 * 同一次亲验抓到第二件事:`submitMessage` 只有一道分支 —— 命中歧义关键词就走提问流,
 * **否则一律排一张生成任务卡**。于是打一声 "hi" 回车,屏上就多出一张任务卡,Otto 说自己
 * 正在 Working on "hi"。原型里这条兜底分支同样缺一次「这是不是真的要做东西」的判断
 * (`fikirtive-prototype-r22.html` 的 `sendOmni()`,那正是本轮要补的产品逻辑缺口)。
 *
 * 两条围栏各封各的:
 *   ① **寒暄不进生成机**(行为):打招呼 / 道谢 / 随口一问 → Conversation 里一条人话回复,
 *      零任务卡、零阶段词、0 cr;真的创作请求 → 照旧排队生成,一个字不变。
 *   ② **商家可见文本禁工程词族**(行为):把这一面能到达的每个状态都渲染出来,断言商家
 *      屏幕上没有 receipt / fixture / durable 这一族。工程标识没有被删掉 —— 它们搬进了
 *      `data-canvas-action-id` 这类属性(不进 `textContent`),仍然可查、可断言。
 *      顶栏那枚「Prototype · sample data」徽章是 fixture 披露的唯一出处,它本身不含禁词,
 *      所以这条围栏不需要任何豁免。
 *
 * 零后端、零 provider、零积分:下面看的全是真挂载之后商家屏幕上的 DOM。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImmersiveCanvasRuntimeContext } from "@/components/canvas/NorthstarCanvasWorkspace";

/**
 * 替身必须是**同一个函数对象**:非 fixture 那一面的报价 effect 依赖 `quoteCosts` /
 * `imageShapes` 的身份,每次渲染换一个新 `vi.fn()` 会让它自己把自己叫醒,渲染打转。
 */
const gen = vi.hoisted(() => ({
  generateImage: vi.fn(async () => false),
  quoteCosts: vi.fn(async () => ({ imageCredits: 8, videoCredits: 80 })),
  imageShapes: vi.fn(async () => ({ options: ["1:1", "9:16", "16:9"], defaultAspect: "1:1" })),
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/image", () => ({ default: () => null }));
/** 同样是 hoisted 的:非 fixture 那一面的读图失败回执要靠它翻牌。 */
const canvasActions = vi.hoisted(() => ({ listCanvasNodes: vi.fn(async (): Promise<unknown[]> => []) }));
vi.mock("@/lib/canvas-actions", () => canvasActions);
vi.mock("@/components/canvas/useCanvasGen", () => ({
  freshCanvasActionId: () => "canvas-action-test",
  useCanvasGen: () => gen,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { R22CanvasSurface } = await import("@/components/canvas/R22CanvasSurface");

/** 命中创作动词,不命中提问流的关键词表 —— 这一条必须真的排队生成。 */
const CREATE_PROMPT = "Make 4 images of the teal batik candle";
/** 命中提问流(`premium`)—— 这一条一个字都不该变。 */
const ASK_PROMPT = "Make the Raya hero more premium";

/**
 * 被赶出商家视线的工程词族。它们没有消失,只是搬进了 `data-*` 与测试断言;
 * `textContent` 读不到属性,所以这条断言天然只管商家读得到的那一半。
 */
const ENGINEER_WORDS = /\b(receipts?|fixtures?|durable|inferred|empty state)\b/i;

function runtimeContext(overrides: Partial<ImmersiveCanvasRuntimeContext> = {}): ImmersiveCanvasRuntimeContext {
  return {
    projects: [{ id: "fixture-raya", name: "Raya launch" }],
    threads: [],
    activeProjectId: "fixture-raya",
    activeThreadId: null,
    initialBalance: null,
    visualFixture: "r22",
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function mount(context: ImmersiveCanvasRuntimeContext = runtimeContext()): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(R22CanvasSurface, { runtimeContext: context, entities: [] }));
  });
  await act(async () => { await Promise.resolve(); });
}

function type(node: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
}

function need<T extends Element>(selector: string): T {
  const node = container!.querySelector<T>(selector);
  expect(node, `找不到 ${selector} —— 下面的断言在核对空气`).not.toBeNull();
  return node!;
}

async function askOtto(prompt: string): Promise<void> {
  await act(async () => {
    type(need<HTMLTextAreaElement>('textarea[aria-label="Describe what to make"]'), prompt);
  });
  await act(async () => {
    need<HTMLFormElement>("form.r22-canvas-composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function conversationLines(): string[] {
  return [...container!.querySelectorAll(".r22-canvas-conversation-list > li")].map((node) => node.textContent ?? "");
}

function noticeText(): string {
  return container!.querySelector(".r22-canvas-notice span")?.textContent ?? "";
}

function ottoState(): string {
  return need(".r22-canvas-otto-head span").textContent ?? "";
}

function screenText(): string {
  return container!.textContent ?? "";
}

describe("① 寒暄不进生成机", () => {
  /**
   * 前三条是裸形状;后四条是判官 2026-08-25 实测的四条红 —— 每一条都含一个创作**名词**
   * (images / video / carousel / batch),上一版就是被这几个名词判成了真创作请求。
   *
   * 第三列是 Otto 该给出的东西:`line` = 一句寒暄人话,`answer` = 一张真答案卡的标题。
   * 「I can answer right here…」那句敷衍话在这一轮被废掉了 —— 一个问题换回一句「我可以
   * 回答」不算回答。
   */
  it.each([
    ["hi", "line", "Hey"],
    ["thanks!", "line", "Anytime"],
    ["what can you do here?", "answer", "Workspace help"],
    ["Thanks for the images!", "line", "Anytime"],
    ["How much does a video cost?", "answer", "What this costs"],
    ["What is a carousel?", "answer", "Shapes you can ask for"],
    ["Where did my last batch go?", "answer", "Workspace help"],
  ])("「%s」换来 Conversation 里一句人话或一张真答案卡,不是一张任务卡", async (prompt, kind, expected) => {
    await mount();
    const before = conversationLines().length;

    await askOtto(prompt);

    const lines = conversationLines();
    expect(lines, "我说的那句没有进 Conversation").toContain(prompt);
    if (kind === "line") {
      const reply = lines.find((line) => line.startsWith(expected));
      expect(reply, `Otto 没有答话 —— 现在的记录是 ${JSON.stringify(lines)}`).toBeDefined();
    } else {
      const card = container!.querySelector("[data-otto-answer]");
      expect(card, `一次提问没有换来答案卡 —— 现在的记录是 ${JSON.stringify(lines)}`).not.toBeNull();
      expect(card!.querySelector("h4")?.textContent).toBe(expected);
      expect(card!.querySelectorAll("ul li").length, "答案卡没有要点").toBeGreaterThan(0);
    }
    expect(lines.length, "一问一答应该正好多两行").toBe(before + 2);

    // 这一条才是 Founder 亲验抓到的病:寒暄不许排任务卡、不许出现阶段词、不许报价。
    expect(container!.querySelector(".r22-canvas-job"), "一句寒暄排出了一张生成任务卡").toBeNull();
    expect(screenText()).not.toContain("Queued");
    expect(screenText()).not.toContain("Working on");
    expect(ottoState(), "寒暄把 Otto 推进了工作态").toBe("idle");
    // 答案本身就是回执:聊天路径上不许再飘一条黑条(那条黑条正是压住输入框的东西)。
    expect(noticeText(), "聊天路径上弹了一条 toast").toBe("");
  });

  it("Otto 的回话指得出我们在哪块板上,不是一句通用客套", async () => {
    await mount();
    await askOtto("hello");

    expect(conversationLines().some((line) => line.includes("the Raya launch board"))).toBe(true);
  });

  it("真的创作请求照旧排队生成 —— 这条路一个字没变", async () => {
    await mount();

    await askOtto(CREATE_PROMPT);

    const job = need(".r22-canvas-job");
    expect(job.getAttribute("data-canvas-job-status")).toBe("queued");
    expect(job.textContent).toContain(CREATE_PROMPT);
    expect(ottoState()).toBe("working");
    // 创作请求不该被当成聊天答一句就完事。
    expect(container!.querySelector("[data-otto-answer]"), "一次创作请求被答成了一张答案卡").toBeNull();
  });

  /**
   * 反过来的那一半:寒暄先判不能把真活也吞掉。「Thanks, now make a video」里有创作动词,
   * 它是一次创作,不是一句道谢 —— 少了这一条,上一个病就换个方向再犯一次。
   */
  it("道谢里带着创作动词 —— 还是一次创作,照旧排队", async () => {
    await mount();

    await askOtto("Thanks! Now make a video of the candle");

    const job = need(".r22-canvas-job");
    expect(job.getAttribute("data-canvas-job-status")).toBe("queued");
    expect(conversationLines().some((line) => line.startsWith("Anytime"))).toBe(false);
  });

  it("歧义关键词照旧走提问流,不被聊天分支截胡", async () => {
    await mount();

    await askOtto(ASK_PROMPT);

    expect(container!.querySelector(".r22-canvas-input-card"), "提问流被改动了").not.toBeNull();
    expect(container!.querySelector(".r22-canvas-job")).toBeNull();
    expect(ottoState()).toBe("needs input");
  });
});

describe("② 商家可见文本里没有工程词族", () => {
  /** 一条匹配不到东西的围栏是绿的假象 —— 每个状态都先证明自己真的画出了东西。 */
  function assertHumanScreen(where: string): void {
    const text = screenText();
    expect(text.length, `${where}:屏幕是空的,围栏在核对空气`).toBeGreaterThan(120);
    const hit = ENGINEER_WORDS.exec(text);
    expect(hit, `${where}:商家读到了工程话术「${hit?.[0]}」—— 上下文 ${text.slice(Math.max(0, (hit?.index ?? 0) - 60), (hit?.index ?? 0) + 60)}`).toBeNull();
  }

  it("落地的示例画布", async () => {
    await mount();
    expect(screenText(), "顶栏那枚诚实徽章不见了 —— 披露就没有出处了").toContain("Prototype · sample data");
    assertHumanScreen("落地");
  });

  it("排队中的任务卡与 Otto 状态", async () => {
    await mount();
    await askOtto(CREATE_PROMPT);
    assertHumanScreen("排队中");
  });

  it("跑完一整轮生成", async () => {
    vi.useFakeTimers();
    await mount();
    await askOtto(CREATE_PROMPT);
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });

    expect(need(".r22-canvas-job").getAttribute("data-canvas-job-status")).toBe("completed");
    expect(screenText(), "完成态没有把结果讲给商家听").toContain("Done");
    assertHumanScreen("完成");
  });

  it("权限不足的失败回执", async () => {
    await mount(runtimeContext({ fixtureSendOutcome: "permission" }));
    await askOtto(CREATE_PROMPT);

    expect(need(".r22-canvas-job").getAttribute("data-canvas-job-status")).toBe("failed");
    expect(noticeText()).toContain("no credits were used");
    assertHumanScreen("权限失败");
  });

  it("结果未知的失败回执(最容易滑回工程话术的一处)", async () => {
    vi.useFakeTimers();
    await mount(runtimeContext({ fixtureSendOutcome: "unknown" }));
    await askOtto(CREATE_PROMPT);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(noticeText(), "未知结果被说成了成功或失败").toContain("could not confirm what happened");
    expect(noticeText()).toContain("nothing was charged");
    assertHumanScreen("未知结果");
  });

  it("提问卡与答完之后的 Decision 记录", async () => {
    await mount();
    await askOtto(ASK_PROMPT);
    assertHumanScreen("等待拍板");

    // 两问都用自由文本作答(避开 Radix 的 roving focus),答完展开 Decision 的事件流。
    for (const answer of ["Teal batik candle", "Instagram Story"]) {
      await act(async () => {
        const input = need<HTMLInputElement>('input[aria-label="Other answer"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, answer);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { need<HTMLButtonElement>(".r22-canvas-input-card footer button.is-primary").click(); });
    }
    await act(async () => { need<HTMLButtonElement>(".r22-canvas-decision button").click(); });

    const events = [...container!.querySelectorAll(".r22-canvas-decision-detail ol li")].map((node) => node.textContent ?? "");
    expect(events.some((line) => line.includes("Task resumed")), "回执整条不见了").toBe(true);
    // 幂等身份没被降级:它只是从屏幕搬到了属性上。
    expect(need(".r22-canvas-decision").getAttribute("data-input-request-id")).toBe("fixture-task-1:input:1");
    expect(noticeText()).toContain("Decision saved in Conversation");
    assertHumanScreen("答完拍板");
  });

  it("真接后端的那一面(非 fixture)", async () => {
    await mount(runtimeContext({ visualFixture: null }));
    expect(screenText(), "非 fixture 面不该挂那枚徽章").not.toContain("Prototype · sample data");
    assertHumanScreen("live");
  });

  /**
   * 判官 r1 [P2-2] 抓到的三处漏网:它们不属 receipt / fixture / durable 那四个词,但
   * 「empty state」「inferred」同样是 UI 工程师词汇 —— 商家读不懂,是同一种病。
   */
  it("读图失败的回执(非 fixture)", async () => {
    canvasActions.listCanvasNodes.mockRejectedValueOnce(new Error("read failed"));
    await mount(runtimeContext({ visualFixture: null }));
    await act(async () => { await Promise.resolve(); });

    expect(noticeText(), "读图失败那一句没画出来").toContain("Canvas items could not be loaded");
    expect(noticeText()).toContain("this is not an empty canvas");
    assertHumanScreen("读图失败");
  });

  it("项目读不出结果时的整屏", async () => {
    await mount(runtimeContext({ fixtureRouteState: "unknown" }));

    expect(screenText()).toContain("Otto could not confirm whether this project opened");
    // 诚实那半句还在:不把「读不出」讲成「这里是空的」。
    expect(screenText()).toContain("this is not an empty project");
    assertHumanScreen("项目读不出结果");
  });

  /**
   * 「From Library」这一项从一句「还没接上」变成了真的能挑一张(样例画布这一面)——
   * 所以这里钉的也换成了新形状:它开出素材库那个小弹层,挑一张就挂到 composer 上。
   * 围栏本身没有松:这一路上的每一屏照旧不许出现工程词族。
   */
  it("附件菜单里的 From Library 开出素材库,挑一张就挂上去", async () => {
    await mount();
    await act(async () => { need<HTMLButtonElement>('button[aria-label="Attach"]').click(); });
    const library = [...container!.querySelectorAll<HTMLButtonElement>(".r22-canvas-attach-menu button")]
      .find((node) => node.textContent === "From Library");
    expect(library, "附件菜单里没有 From Library").toBeDefined();

    await act(async () => { library!.click(); });

    const picks = [...container!.querySelectorAll<HTMLButtonElement>("[data-canvas-library-pick]")];
    expect(picks.length, "素材库弹层里一张都挑不了").toBeGreaterThan(0);
    assertHumanScreen("素材库弹层");

    await act(async () => { picks[0]!.click(); });

    expect(container!.querySelector("[data-canvas-reference-chip]"), "挑完之后 composer 上没有那张参考图").not.toBeNull();
    expect(noticeText()).toContain("attached to your next request");
    assertHumanScreen("挂上参考图");
  });
});

// ---------------------------------------------------------------------------
// ③ 同一道闸也装在真接后端那一面
// ---------------------------------------------------------------------------
describe("③ 寒暄在 live 面上也不进生成机", () => {
  it("一句 \"hi\" 不调 generateImage,也不花一分钱", async () => {
    await mount(runtimeContext({ visualFixture: null }));

    await askOtto("hi");

    expect(gen.generateImage, "live 面上一句寒暄真的排了一次生成").not.toHaveBeenCalled();
    // 答话落在 Conversation 里,不再飘一条压着输入框的黑条。
    expect(conversationLines().some((line) => line.startsWith("Hey"))).toBe(true);
    expect(noticeText(), "live 面的聊天路径上弹了一条 toast").toBe("");
  });

  it("live 面上一次提问同样换回一张真答案卡", async () => {
    await mount(runtimeContext({ visualFixture: null }));

    await askOtto("How much does an image cost?");

    expect(gen.generateImage).not.toHaveBeenCalled();
    const card = need("[data-otto-answer]");
    expect(card.querySelector("h4")?.textContent).toBe("What this costs");
    // 价钱从服务端报价派生 —— 替身给的是 8 cr,答案里就必须是 8 与 8×4。
    const bullets = [...card.querySelectorAll("ul li")].map((node) => node.textContent ?? "");
    expect(bullets).toContain("8 cr per image.");
    expect(bullets).toContain("32 cr for a batch of 4.");
    expect(noticeText()).toBe("");
  });

  it("真的创作请求在 live 面上照旧送出去", async () => {
    await mount(runtimeContext({ visualFixture: null }));

    await askOtto(CREATE_PROMPT);

    expect(gen.generateImage).toHaveBeenCalledTimes(1);
    const [sentPrompt] = (gen.generateImage.mock.calls[0] ?? []) as unknown[];
    expect(sentPrompt).toBe(CREATE_PROMPT);
  });
});
