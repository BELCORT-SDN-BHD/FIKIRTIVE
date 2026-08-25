// @vitest-environment jsdom
/**
 * r22-brand-voice-honesty.test.ts —— Otto IQ · Brand Voice 的「生成」在生产上是假的。
 *
 * 判官实证(全表面对账舰队 cross-laws/brand-iq,2026-08-25):`BrandVoiceFlow` 进入
 * `generating` 之后有一个 560ms 的定时器,**无条件**把一段写死的描述与三条写死的摘录
 * 塞进状态并推进到 review。它不看 `fixture`。于是生产上的商家:
 *
 *   1. 粘了自己的一千字,按「Generate voice」;
 *   2. 读到一段与自己粘的内容毫无关系的「你的品牌声音是这样的」;
 *   3. 编辑它、按 Save,这时才撞上 `save()` 里那句实话
 *      「Brand Voice generation and source ingestion are not connected. Nothing was saved.」
 *
 * 而同一块屏幕上,generating 那一步自己写着「FIKIRTIVE does not show success until
 * analysis finishes」—— 一句话在同屏否掉正在发生的事。
 *
 * 同文件的四个兄弟流程都判了生产:KnowledgeBaseFlow 的假处理带 `!fixture` 判定,
 * Audience / StyleGuide / VisualGuideline 走真 `addMemory`。漏的是 Brand Voice 一处。
 *
 * 修法是最小的诚实:非 fixture 时**根本不进**伪造那一步,当场用**同一句**实话收场。
 * 下面两条钉的就是这一条修法的两面 —— 生产不许出现写死的文案,fixture 一个字节不变
 * (它是演示,那正是它该有的样子)。
 *
 * 零后端、零积分:两次真挂载 + 真点击,断言看的是商家屏幕上的 DOM。
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Radix 的 Dialog / Tabs 在 jsdom 里要这几样(popper 量尺寸、指针捕获、滚动到选中项)。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
// 这一条路径上一次也不该走到服务端动作 —— 替身在这里同时充当断言对象。
vi.mock("@/lib/memory-actions", () => ({
  addMemory: vi.fn(async () => ({ id: "mem_1" })),
  updateMemory: vi.fn(async () => ({ ok: true })),
  deleteMemory: vi.fn(async () => ({ ok: true })),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { R22OttoIQView } = await import("@/components/otto-iq/R22OttoIQView");
const { addMemory } = await import("@/lib/memory-actions");

/** 写死的演示描述开头那几个字 —— 生产上出现它,就是商家读到了别人的品牌。 */
const FAKE_GENERATED = "Clear, warm and practical";
/** 已经在 `save()` 里的那句实话。修法复用它,不发明新文案。 */
const HONEST_BLOCK = "Brand Voice generation and source ingestion are not connected. Nothing was saved.";
/** 1000 字符下限是这一步自己的规则,喂够了才走得到「生成」。 */
const APPROVED_TEXT = "Batik House writes plainly about what a piece is made of and who made it. ".repeat(20);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.sessionStorage.clear();
});

/** 弹窗走 portal,长在 body 上而不在 container 里 —— 断言范围必须是整个文档。 */
function screenText(): string {
  return document.body.textContent ?? "";
}

function buttonWithText(text: string): HTMLButtonElement {
  const node = Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  expect(node, `屏幕上找不到「${text}」按钮 —— 后面的断言在核对空气`).toBeDefined();
  return node!;
}

function typeInto(node: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
}

function need<T extends Element>(selector: string): T {
  const node = document.body.querySelector<T>(selector);
  expect(node, `找不到 ${selector}`).not.toBeNull();
  return node!;
}

async function click(node: HTMLElement): Promise<void> {
  await act(async () => { node.click(); });
}

/** 挂 Brand Voice 面,一路走到按下「Generate voice」为止。 */
async function generateBrandVoice(fixture: boolean): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(R22OttoIQView, { initialMemory: [], initialPane: "voice", fixture }));
  });
  await act(async () => { await Promise.resolve(); });

  await click(buttonWithText("Add Brand Voice"));
  await act(async () => { typeInto(need<HTMLInputElement>(".r22-brand-voice-fields input"), "Batik House voice"); });
  await click(buttonWithText("Next"));
  await act(async () => { typeInto(need<HTMLTextAreaElement>(".r22-brand-voice-fields textarea"), APPROVED_TEXT); });
  await click(buttonWithText("Generate voice"));
  // 假生成那个定时器是 560ms。等够它 —— 它要是还在跑,下面第一条就会红。
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 800)); });
}

describe("Brand Voice · 生产上不许假生成", () => {
  it("非 fixture 按下生成时当场说实话,不制造任何写死的「生成结果」", async () => {
    await generateBrandVoice(false);

    expect(screenText()).toContain(HONEST_BLOCK);
    expect(screenText(), "生产上出现了写死的演示文案 —— 商家读到的是别人的品牌").not.toContain(FAKE_GENERATED);
    // 连那块自称「分析完才报成功」的等待画面都不该出现:没有分析在跑。
    expect(screenText()).not.toContain("Generating Brand Voice");
    expect(screenText()).not.toContain("Review and edit");
    // 实话是当场说的,不是等到 Save 才说 —— 商家没被要求先编辑一份不存在的东西。
    expect(buttonWithText("Generate voice")).toBeDefined();
    expect(addMemory).not.toHaveBeenCalled();
  });

  it("fixture 的演示流程一个字节不变 —— 它本来就是演示", async () => {
    await generateBrandVoice(true);

    expect(screenText(), "fixture 的假生成被顺手改坏了").toContain(FAKE_GENERATED);
    expect(screenText()).toContain("Review and edit");
    expect(screenText()).not.toContain(HONEST_BLOCK);
    expect(addMemory).not.toHaveBeenCalled();
  });
});
