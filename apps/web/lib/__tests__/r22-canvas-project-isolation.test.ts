// @vitest-environment jsdom
/**
 * R22 画布结构化提问流的两条**身份**契约,来自 canvas-askq-audit 判官的实证:
 *
 * ① **切项目不许带上一个项目的会话**(判官实证 :277-294)。顶栏项目菜单走 `<Link>`,
 *    路由只换 `?project=` 这个 query 参数 —— 同一个 `R22CanvasSurface` 实例不卸载。
 *    恢复 effect 只在 sessionStorage **读到东西**时才写内存态;读不到就什么都不做,于是
 *    上一个项目的 messages / pendingQuestion / decision 原地不动,还会被紧随其后的写入
 *    effect 存进**新项目**的 key。商家眼里就是:打开一个空项目,里面躺着别的项目的对话。
 *
 * ② **幂等键少了 taskVersion**(判官实证 :415/:419)。§9.5 契约要求「同 taskId +
 *    inputRequestId + 同 taskVersion 的重复回答幂等返回原回执」。`inputRequestId` 长成
 *    `${taskId}:input:1`,taskId 已经在里面了,漏的是版本。fixture 里 taskVersion 恒为 1,
 *    所以这条**今天一个可见行为都不改**;它挡的是身份被写窄之后,同一请求的下一个版本被
 *    错当成「已经回答过」挡掉。
 *
 * 这一面整个是 fixture:零后端、零 provider、零积分。下面每条断言看的都是商家屏幕上
 * 真实出现的东西(DOM)与浏览器里真实存下的东西(sessionStorage),不是源码字符串。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImmersiveCanvasRuntimeContext } from "@/components/canvas/NorthstarCanvasWorkspace";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/canvas-actions", () => ({ listCanvasNodes: vi.fn().mockResolvedValue([]) }));
vi.mock("@/components/canvas/useCanvasGen", () => ({
  freshCanvasActionId: () => "canvas-action-test",
  useCanvasGen: () => ({ generateImage: vi.fn(), quoteCosts: vi.fn(), imageShapes: vi.fn() }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { R22CanvasSurface } = await import("@/components/canvas/R22CanvasSurface");

/** `DEFAULT_R22_WORKSPACE_DIRECTORY.activeId` —— 没有 seed directory 时的默认 workspace。 */
const WORKSPACE_ID = "batik-house";
/** `scopedR22FixtureKey("r22:canvas:<project>:<thread|new>")` 展开后的样子。 */
const storageKey = (projectId: string, threadId = "new") => `r22:canvas:${projectId}:${threadId}:${WORKSPACE_ID}`;

/** 命中 `fixtureQuestionFlow` 的 creative 分支(/premium/),不命中 scope 分支。 */
const PROMPT_A = "Make the Raya hero more premium";

function runtimeContext(activeProjectId: string): ImmersiveCanvasRuntimeContext {
  return {
    projects: [{ id: "project-a", name: "Raya launch" }, { id: "project-b", name: "Merdeka teaser" }],
    threads: [],
    activeProjectId,
    activeThreadId: null,
    initialBalance: null,
    visualFixture: "r22",
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
  vi.clearAllMocks();
});

async function mount(activeProjectId: string): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await render(activeProjectId);
}

/** 同一个 root 重渲染 = 同一个组件实例换 props,正是 `<Link>` 换 `?project=` 的形状。 */
async function render(activeProjectId: string): Promise<void> {
  await act(async () => {
    root!.render(createElement(R22CanvasSurface, { runtimeContext: runtimeContext(activeProjectId), entities: [] }));
  });
  await act(async () => { await Promise.resolve(); });
}

function type(node: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
}

function pick<T extends Element>(selector: string): T | null {
  return container!.querySelector<T>(selector);
}

function need<T extends Element>(selector: string): T {
  const node = pick<T>(selector);
  expect(node, `找不到 ${selector} —— 下面的断言在核对空气`).not.toBeNull();
  return node!;
}

function otherAnswerInput(): HTMLInputElement {
  return need<HTMLInputElement>('input[aria-label="Other answer"]');
}

/** 提问卡底部那枚主按钮:中途是 "Next",最后一问是 "Continue task"。 */
function primaryAction(): HTMLButtonElement {
  return need<HTMLButtonElement>(".r22-canvas-input-card footer button.is-primary");
}

function noticeText(): string {
  return pick(".r22-canvas-notice span")?.textContent ?? "";
}

/** Decision 的事件流默认折叠,不点开就不在 DOM 里。 */
async function openDecisionEvents(): Promise<string[]> {
  await act(async () => { need<HTMLButtonElement>(".r22-canvas-decision button").click(); });
  return [...container!.querySelectorAll(".r22-canvas-decision-detail ol li")].map((node) => node.textContent ?? "");
}

async function askOtto(prompt: string): Promise<void> {
  await act(async () => {
    type(need<HTMLTextAreaElement>('textarea[aria-label="Describe what to make"]'), prompt);
  });
  await act(async () => {
    need<HTMLFormElement>("form.r22-canvas-composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function storedSession(projectId: string): { messages?: Array<{ from: string; text: string }>; pending?: unknown; decision?: unknown } {
  const raw = window.sessionStorage.getItem(storageKey(projectId));
  expect(raw, `${storageKey(projectId)} 里什么都没存 —— 这一面根本没写过存档`).not.toBeNull();
  return JSON.parse(raw!) as { messages?: Array<{ from: string; text: string }>; pending?: unknown; decision?: unknown };
}

describe("切项目不带走上一个项目的会话(判官实证 :277-294)", () => {
  it("从有存档的项目切到没有存档的项目,屏上与存档里都不留上一个项目的一个字", async () => {
    await mount("project-a");

    // 1) 在 project A 里问出一次结构化提问:一条我的消息 + 一张提问卡 + 一条 Decision。
    await askOtto(PROMPT_A);
    expect(pick(".r22-canvas-input-card"), "project A 没有进入提问流 —— 后面在核对空气").not.toBeNull();
    expect(container!.textContent).toContain(PROMPT_A);
    expect(pick(".r22-canvas-decision")).not.toBeNull();
    expect(storedSession("project-a").messages).toEqual([{ from: "me", text: PROMPT_A }]);

    // 2) 顶栏切到 project B。组件不卸载,只是 props 换了个 activeProjectId。
    await render("project-b");

    expect(container!.textContent, "上一个项目的消息跟着切过来了").not.toContain(PROMPT_A);
    expect(pick(".r22-canvas-input-card"), "上一个项目的提问卡还挂在新项目上").toBeNull();
    expect(pick(".r22-canvas-decision"), "上一个项目的 Decision 记录还挂在新项目上").toBeNull();

    // 3) 而且残留没有被写入 B 自己的存档 —— 否则刷新一次就变成 B 的「历史」。
    const leaked = storedSession("project-b");
    expect(leaked.messages, "project A 的消息被存进了 project B 的 key").toEqual([]);
    expect(leaked.pending, "project A 的提问卡被存进了 project B 的 key").toBeNull();
    expect(leaked.decision, "project A 的 Decision 被存进了 project B 的 key").toBeNull();

    // 4) 清的是内存态,不是 A 的存档:切回去,A 的会话原样还在。
    await render("project-a");
    expect(container!.textContent, "清内存态时把 project A 的存档也一起清了").toContain(PROMPT_A);
    expect(pick(".r22-canvas-input-card")).not.toBeNull();
  });
});

/**
 * 幂等的两半:一半是**同一个会话里**重复按下(下面第一条),另一半是**跨刷新**——
 * 存档把「这个请求已经答过」带回来(后面两条,钉的是 :290 的回填键与 :415 的读取键
 * 必须是同一把)。
 */
describe("同一个回答只落一次账(判官实证 :415/:419)", () => {
  const REQUEST_ID = "fixture-task-1:input:1";
  const SEEDED_FLOW = {
    title: "Creative direction",
    reason: "Two valid creative directions would produce materially different work.",
    cost: 3,
    questions: [{
      header: "Lead product",
      question: "Which product should lead this Raya concept?",
      help: "Otto found two valid products in your references.",
      multi: false,
      required: true,
      options: [{ label: "Teal batik candle", description: "Use the strongest Raya visual cue" }],
    }],
  };

  /**
   * 手工 seed 的浏览器存档:decision 已经 answered,pending 还停在最后一问。
   * 这是**跨刷新**那一半唯一能构造的形状(同一次运行里 pending 与 answered 是同一笔
   * 写入,pending 会被置空),它钉的正是 :290 回填进 `answeredRequestsRef` 的那把键
   * 与 :415 读取的那把键必须逐字一致 —— 只改读写两处、漏掉回填,这条就红。
   */
  function seedAnsweredSession(decisionVersion: number, pendingVersion: number): void {
    window.sessionStorage.setItem(storageKey("project-a"), JSON.stringify({
      // v2 = 会话记录带上「谁说的」。v1 的存档由组件当场丢弃(旧形状不去猜)。
      version: 2,
      messages: [{ from: "me", text: PROMPT_A }],
      pending: { taskId: "fixture-task-1", inputRequestId: REQUEST_ID, taskVersion: pendingVersion, flow: SEEDED_FLOW, prompt: PROMPT_A, index: 0, selected: ["Teal batik candle"], answers: [] },
      other: "",
      decision: {
        taskId: "fixture-task-1",
        inputRequestId: REQUEST_ID,
        taskVersion: decisionVersion,
        status: "answered",
        title: "Creative direction · 1 answers saved",
        detail: "Why Otto paused: two valid creative directions.",
        events: [{ kind: "resumed", label: "Task resumed", detail: `Continued from your saved answers · version ${decisionVersion} · 0 cr` }],
      },
      job: null,
    }));
  }

  it("同一次会话里连按两下 Continue task,只记一次 resumed,第二下拿回原回执", async () => {
    await mount("project-a");
    await askOtto(PROMPT_A);

    // 第一问(单选)用自由文本作答,避开 Radix 的 roving focus —— 答案内容不是这条要钉的东西。
    await act(async () => { type(otherAnswerInput(), "Teal batik candle"); });
    expect(primaryAction().textContent).toBe("Next");
    await act(async () => { primaryAction().click(); });

    // 第二问(多选)同样自由文本作答,这一问是最后一问。
    await act(async () => { type(otherAnswerInput(), "Instagram Story"); });
    const submit = primaryAction();
    expect(submit.textContent).toBe("Continue task");

    // 两下点击落在同一批里(React 要到 act 结束才 flush),就是商家手抖连点的形状。
    await act(async () => { submit.click(); submit.click(); });

    expect(noticeText(), "第二下没有走幂等分支").toContain("This answer was already accepted");
    // 幂等的两半仍然要**说给商家听**,只是换成人话:没有第二个任务、没有多扣钱。
    expect(noticeText()).toContain("no second task and no extra credits");
    const events = await openDecisionEvents();
    expect(events.filter((line) => line.includes("Task resumed")), "同一个回答记了两次 resumed").toHaveLength(1);
  });

  it("刷新后存档说这个请求已经答过,同一个版本再按一次仍然拿回原回执", async () => {
    seedAnsweredSession(1, 1);
    await mount("project-a");

    expect(primaryAction().textContent).toBe("Continue task");
    await act(async () => { primaryAction().click(); });

    expect(noticeText(), "存档回填的键与运行时读取的键对不上,重复回答被放行了").toContain("This answer was already accepted");
    const events = await openDecisionEvents();
    expect(events.filter((line) => line.includes("Task resumed"))).toHaveLength(1);
  });

  it("同一个 inputRequestId 换了 taskVersion 就是另一次回答,不当重复挡掉", async () => {
    // §9.5 的身份是三件一起。fixture 今天只发 v1,所以这条不改任何可见行为;
    // 它钉的是身份别被写窄成「只看 inputRequestId」。
    seedAnsweredSession(1, 2);
    await mount("project-a");

    await act(async () => { primaryAction().click(); });

    expect(noticeText(), "v2 被 v1 的回执挡掉了 —— 幂等键漏了 taskVersion").toContain("Decision saved in Conversation");
    const events = await openDecisionEvents();
    const resumed = events.filter((line) => line.includes("Task resumed"));
    expect(resumed).toHaveLength(2);
    expect(resumed[1], "新一轮的回执没有带上自己的版本").toContain("version 2");
  });
});
