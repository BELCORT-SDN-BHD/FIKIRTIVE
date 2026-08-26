// @vitest-environment jsdom
/**
 * r22-canvas-answer-system.test.ts —— 画布上问一句,换回来的必须是**一个答案**。
 *
 * 病灶(Founder 2026-08-25 亲述):「我原本已经把 canva 和如何 answer 的 flow 都做好好了」。
 * 他做好的那套东西在原型里叫 `responseFor(context,prompt)`(`fikirtive-prototype-r22.html`
 * L6692-6706):按话题给一张**结构化真答案**——标题、导语、若干要点、一句诚实注脚,底下
 * 一排 Copy / Helpful / Not helpful,外加一个 `aria-live` 的确认位。
 *
 * 实现层此前整套没搬,兜了一句敷衍话回去:
 *   「I can answer right here, or make something on … Ask me for images, a variant, or a
 *     caption and I'll start.」
 * 而且同一个问题连问两遍,它逐字重复同一句。一个问题换回一句「我可以回答」不是回答,
 * 是回声。
 *
 * 三条围栏,各封各的:
 *   ① **每一路都有真答案**(行为):八条分流各断一条,断的是屏上那张卡的标题与要点,
 *      不是源码里的字符串。
 *   ② **重复提问不逐字复读**(行为):同一件事问第二遍,导语换成「Same answer as above」
 *      的变体,要点照旧摆出来,两张卡的全文必须不同。
 *   ③ **聊天路径零 toast,且 toast 永不遮输入框**(行为 + 几何):答案本身就是回执;
 *      创作类的回执条按 `bottom: calc(100% + 16px)` 贴在输入框上方,几何上碰不到它。
 *
 * 零后端、零 provider、零积分:下面看的全是真挂载之后商家屏幕上的 DOM。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearToasts, installToastEnvironment, latestToast, settleToasts, toastTexts, withToaster } from "./__helpers__/toast-probe";
installToastEnvironment();
import type { ImmersiveCanvasRuntimeContext } from "@/components/canvas/NorthstarCanvasWorkspace";

const gen = vi.hoisted(() => ({
  generateImage: vi.fn(async () => false),
  quoteCosts: vi.fn(async () => ({ imageCredits: 8, videoCredits: 80 })),
  imageShapes: vi.fn(async () => ({ options: ["1:1", "9:16", "16:9"], defaultAspect: "1:1" })),
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/canvas-actions", () => ({ listCanvasNodes: vi.fn(async (): Promise<unknown[]> => []) }));
vi.mock("@/components/canvas/useCanvasGen", () => ({
  freshCanvasActionId: () => "canvas-action-test",
  useCanvasGen: () => gen,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { R22CanvasSurface, canvasAnswerFor, answerCopyText } = await import("@/components/canvas/R22CanvasSurface");

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
  clearToasts();
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
    root!.render(withToaster(createElement(R22CanvasSurface, { runtimeContext: context, entities: [] })));
  });
  await act(async () => { await Promise.resolve(); });
}

function need<T extends Element>(selector: string): T {
  const node = container!.querySelector<T>(selector);
  expect(node, `找不到 ${selector} —— 下面的断言在核对空气`).not.toBeNull();
  return node!;
}

function type(node: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
}

async function askOtto(prompt: string): Promise<void> {
  await act(async () => {
    type(need<HTMLTextAreaElement>('textarea[aria-label="Describe what to make"]'), prompt);
  });
  await act(async () => {
    need<HTMLFormElement>("form.r22-canvas-composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  // 回执现在由根布局上的 Toaster 画(审计 A-4),它要等一个宏任务才落进 DOM。
  await settleToasts();
}

function answerCards(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>("[data-otto-answer]")];
}

function cardTitle(card: HTMLElement): string {
  return card.querySelector("h4")?.textContent ?? "";
}

function cardBullets(card: HTMLElement): string[] {
  return [...card.querySelectorAll("ul li")].map((node) => node.textContent ?? "");
}

// ---------------------------------------------------------------------------
// ① 八条分流,每一路都交出一张真答案卡
// ---------------------------------------------------------------------------
describe("① 每一路提问都换回一张真答案卡(原型 responseFor 的五路 + 画布自己的三路)", () => {
  it.each([
    ["How much does this cost?", "What this costs", "3 cr per image."],
    // 参数弹层这一轮把 4:5 也接上了,所以这一面此刻真的可选的是四个形状 —— 这一句
    // 报的永远是「此刻真的可选的那几个」,不是一张写死的表。
    ["What formats can I ask for?", "Shapes you can ask for", "Available right now: 9:16 vertical · 1:1 square · 4:5 portrait · 16:9 wide."],
    ["Why does this need review?", "Why this needs review", "Approving something schedules it; it does not publish it."],
    ["What can a routine do here?", "What Otto does without you", "Otto makes work and spends credits without you only inside a routine you switched on."],
    ["Where did Otto learn this?", "Where Otto learned this", "Suggestions are not saved until you accept them."],
    ["How is performance measured?", "About these numbers", "If I am not sure of a number, I say so instead of inventing one."],
    ["Which channels can this go to?", "Where this can go", "Scheduling and publishing live in Schedule, not on this canvas."],
    ["What happens to my work here?", "Workspace help", "Work made here stays on this canvas, and anything you save is in Library."],
  ])("「%s」→ %s", async (prompt, title, bullet) => {
    await mount();

    await askOtto(prompt);

    const cards = answerCards();
    expect(cards.length, `这一路没有画出答案卡 —— 屏上是 ${container!.textContent?.slice(0, 200)}`).toBe(1);
    expect(cardTitle(cards[0]!)).toBe(title);
    expect(cardBullets(cards[0]!), "要点里少了这一路的判据").toContain(bullet);
    // 每一张卡都必须带那一句诚实注脚,而且注脚只能是一句**否定**:刚才这次答话什么都
    // 没动、什么都没跑、什么都没花。一句正面的注脚就是这条围栏要挡的东西。
    expect(cards[0]!.querySelector(".r22-canvas-answer-note")?.textContent ?? "").toMatch(/\b(did not|nothing|no)\b/i);
  });

  it("Routine 三态各有整段,不知道就说不知道", () => {
    const base = { board: "this canvas", imageCredits: 3, ratioOptions: ["9:16"] };
    const unknown = canvasAnswerFor("routine", { ...base, activeRoutines: null });
    const none = canvasAnswerFor("routine", { ...base, activeRoutines: 0 });
    const one = canvasAnswerFor("routine", { ...base, activeRoutines: 1 });
    const many = canvasAnswerFor("routine", { ...base, activeRoutines: 3 });

    expect(unknown.lead).toContain("cannot see your routines");
    expect(none.lead).toContain("No routine is switched on right now");
    expect(one.lead).toContain("1 routine is switched on right now");
    expect(many.lead).toContain("3 routines are switched on right now");
    // 三态互不复读:不知道那一态绝不能滑成「没有在跑」。
    expect(new Set([unknown.lead, none.lead, one.lead, many.lead]).size).toBe(4);
  });

  it("价钱与形状读不出来时不编数字,也不编一张形状表", () => {
    const blind = canvasAnswerFor("how much?", { board: "this canvas", imageCredits: null, ratioOptions: [], activeRoutines: null });
    expect(blind.bullets.join(" ")).toContain("still being checked");
    expect(blind.bullets.join(" "), "价格读不出来,答案里却印了一个数").not.toMatch(/\d+ cr/);

    const shapes = canvasAnswerFor("what ratio?", { board: "this canvas", imageCredits: null, ratioOptions: [], activeRoutines: null });
    expect(shapes.bullets.join(" ")).toContain("still being read");
    expect(shapes.bullets.join(" ")).not.toContain("9:16");
  });

  it("批量总价是单价推出来的,不是另写的一个数", () => {
    for (const credits of [3, 8, 11]) {
      const answer = canvasAnswerFor("price", { board: "this canvas", imageCredits: credits, ratioOptions: [], activeRoutines: null });
      expect(answer.bullets).toContain(`${credits} cr per image.`);
      expect(answer.bullets).toContain(`${credits * 4} cr for a batch of 4.`);
    }
  });

  it("提问流没有被答案截胡 ——「Make the Raya hero more premium」照旧要一次拍板", async () => {
    await mount();

    await askOtto("Make the Raya hero more premium");

    expect(need(".r22-canvas-input-card")).not.toBeNull();
    expect(answerCards().length, "该要拍板的那一条被答成了一张卡").toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ② 复制、评价、重复提问
// ---------------------------------------------------------------------------
describe("② 答案卡自己是完整的一件东西", () => {
  it("同一个问题连问两次,第二张卡不逐字复读第一张", async () => {
    await mount();

    await askOtto("How much does this cost?");
    await askOtto("How much does this cost?");

    const cards = answerCards();
    expect(cards.length).toBe(2);
    expect(cardTitle(cards[1]!), "第二次换了个话题 —— 那不是重复提问").toBe(cardTitle(cards[0]!));
    expect(cards[1]!.getAttribute("data-otto-answer-repeat")).toBe("true");
    expect(cards[1]!.querySelector("p")?.textContent).toContain("Same answer as above");
    expect(cards[1]!.textContent, "第二张卡与第一张逐字相同 —— 那是回声,不是回答").not.toBe(cards[0]!.textContent);
    // 变体只换开头,要点必须还在 —— 否则第二次问就等于什么都没答。
    expect(cardBullets(cards[1]!)).toEqual(cardBullets(cards[0]!));
  });

  /**
   * 会话面板只有 40vh 高,一张答案卡比一条消息高好几倍 —— 不跟着滚,商家问完一句还得
   * 自己往下拖才读得到答案。原型 `scrollChat()` 干的就是这件事。
   */
  it("答完之后会话滚到底,刚答出来的那张卡看得见", async () => {
    await mount();
    const list = need<HTMLUListElement>(".r22-canvas-conversation-list");
    // jsdom 不排版,scrollHeight 恒为 0 —— 给它一个真的高度,才量得到「有没有滚」。
    Object.defineProperty(list, "scrollHeight", { value: 900, configurable: true });
    list.scrollTop = 0;

    await askOtto("How much does this cost?");

    expect(list.scrollTop, "答案落在看不见的地方").toBe(900);
  });

  it("换个话题问,不算重复", async () => {
    await mount();

    await askOtto("How much does this cost?");
    await askOtto("What formats can I ask for?");

    const cards = answerCards();
    expect(cards.map(cardTitle)).toEqual(["What this costs", "Shapes you can ask for"]);
    expect(cards[1]!.hasAttribute("data-otto-answer-repeat")).toBe(false);
  });

  it("Copy 把整张卡交给剪贴板,并且当场说一声", async () => {
    const copiedText: string[] = [];
    const writeText = vi.fn(async (text: string) => { copiedText.push(text); });
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
    await mount();
    await askOtto("How much does this cost?");

    await act(async () => { need<HTMLButtonElement>("[data-otto-copy]").click(); });

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = copiedText[0]!;
    expect(copied).toContain("What this costs");
    expect(copied).toContain("3 cr per image.");
    expect(copied.split("\n").length, "复制出去的不是整张卡").toBeGreaterThan(4);
    expect(need(".r22-canvas-answer-confirm").textContent).toBe("Copied");
  });

  it("Helpful / Not helpful 只能选一个,并且答一句确认", async () => {
    await mount();
    await askOtto("How much does this cost?");
    // 两颗评价归位到 ToggleGroup `type="single"` 之后,「只能选一个」这件事由
    // `aria-checked`(一组里挑一个)说,不再是两个各自开关的 `aria-pressed`。
    const card = need("[data-otto-answer]");
    const up = card.querySelector<HTMLButtonElement>('[data-otto-vote="up"]');
    const down = card.querySelector<HTMLButtonElement>('[data-otto-vote="down"]');
    expect(up, "答案卡上没有 Helpful").not.toBeNull();
    expect(down, "答案卡上没有 Not helpful").not.toBeNull();
    expect(up!.closest('[role="radiogroup"]'), "两颗评价不在同一组里 —— 读屏会念成两个独立开关").not.toBeNull();

    await act(async () => { up!.click(); });
    expect(up!.getAttribute("aria-checked")).toBe("true");
    expect(down!.getAttribute("aria-checked")).toBe("false");
    expect(need(".r22-canvas-answer-confirm").textContent).toBe("Thanks — marked helpful");

    await act(async () => { down!.click(); });
    expect(up!.getAttribute("aria-checked"), "两个评价同时亮着").toBe("false");
    expect(down!.getAttribute("aria-checked")).toBe("true");
    expect(need(".r22-canvas-answer-confirm").textContent).toBe("Thanks — feedback recorded");
  });

  it("复制出去的文本就是屏上那张卡的每一行", () => {
    const answer = canvasAnswerFor("price", { board: "this canvas", imageCredits: 3, ratioOptions: [], activeRoutines: null });
    expect(answerCopyText(answer).split("\n")).toEqual([answer.title, answer.lead, ...answer.bullets, answer.note]);
  });
});

// ---------------------------------------------------------------------------
// ③ toast 纪律
// ---------------------------------------------------------------------------
describe("③ 聊天零回执,创作那条回执照旧出", () => {
  /**
   * 2026-08-26(审计 A-4):这一面自己画的那条 `.r22-canvas-notice` 退役了,回执与另外
   * 四扇门一起收敛到 `toast()`,由根布局上的 `<Toaster />` 画。
   *
   * 这一段因此换了量法,但量的还是同两件事:
   *   · 聊天与问答**一条回执都不该出**——它们的答案住在 Conversation 里,不是一条飘过去的
   *     横幅;
   *   · 创作那一条照旧要出,而且第一句就说清楚「排上了、还没扣钱」。
   *
   * 原来那两条几何/动效断言(回执条抬在输入框上方 `calc(100% + 16px)`、200ms transition)
   * 随那条横幅一起退役 —— 它们量的是一个不存在的元素。换上的是「那条横幅真的没了」与
   * 「回执确实由共用的 Toaster 出」两条,否则这一段会静默地不再指认任何东西。
   */
  it("问答与寒暄一条回执都不弹", async () => {
    await mount();

    for (const prompt of ["hi", "How much does this cost?", "thanks!", "Which channels can this go to?"]) {
      await askOtto(prompt);
      expect(toastTexts(), `「${prompt}」弹了一条回执`).toEqual([]);
    }
  });

  it("创作那条回执照旧出 —— 这一条不是要把回执删掉", async () => {
    await mount();

    await askOtto("Make 4 images of the teal batik candle");

    expect(latestToast()).toContain("Queued");
    expect(latestToast(), "第一句没说清楚还没扣钱").toContain("nothing has been charged yet");
  });

  it("那条自制的横幅真的退役了:css 与源码里都不再有它", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(resolve(here, "../../components/canvas/r22-canvas.css"), "utf8");
    const view = readFileSync(resolve(here, "../../components/canvas/R22CanvasSurface.tsx"), "utf8");

    expect(css, "画布还留着自己那条回执横幅的样式").not.toContain("r22-canvas-notice");
    // 认的是**画出来**的那个类名,不是注释里提到它的那一行 —— 那一行正是在说它为什么走了。
    expect(view, "画布还在自己画一条回执横幅").not.toMatch(/className=[^\n]*r22-canvas-notice/);
    expect(view, "回执没有走共用的 toast").toContain('from "sonner"');

    // Toaster 挂在根布局上 —— 五扇门共用的就是这一份,不是各挂各的。
    const layout = readFileSync(resolve(here, "../../app/layout.tsx"), "utf8");
    expect(layout).toContain("<Toaster />");
  });

  it("重试那颗键跟着那条回执走,不再是横幅上一颗要自己判断出不出现的按钮", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const view = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../components/canvas/R22CanvasSurface.tsx"), "utf8");

    const failure = view.slice(view.indexOf("That request was not confirmed"));
    expect(failure.slice(0, 400), "失败回执上没有挂重试动作").toContain("retryFixtureSend");
  });
});
