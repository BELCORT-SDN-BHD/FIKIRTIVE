// @vitest-environment jsdom
/**
 * canvas-library-picker-a11y — Codex 只读 E2E **E2E-CRE-PAV-006**（P2 Accessibility）。
 *
 * 走查用真实浏览器打开 `CanvasLibraryPicker`（composer 的「Choose from Library」半屏）：视觉上
 * 每个素材有缩略图与 caption,但 AX tree 里每个 item 只是一个无名称的 `button` 包一个无 alt 的
 * `image` —— 键盘用户 Tab 过去听不到在选哪一件,screen reader 用户更无从判断。
 *
 * 规格口径归 **FRONT-A14**（六面走查「视觉与交互与已批准的设计文档一致」,画布面;
 * `docs/specs/frontend-baseline.md`）——「一致」包含无障碍语义,不只是像素。
 *
 * 修法(单一源头 `libraryItemAccessibleName`,`CanvasLibraryPicker.tsx`):
 *   ① 每个 item 的按钮加 `aria-label` = 素材名字 + 媒体类型(`"…tumbler, image"`);没有名字时
 *      退回媒体类型本身(`"Image"`/`"Video"`),不是空字符串。
 *   ② 缩略图 `<img alt="">`(装饰,名字已经在按钮上,不重复播报)。
 *   ③ `<video>` 加 `aria-hidden`,理由相同。
 *
 * 「来源」(generated in this Canvas / uploaded)这一段有意不做:`LibraryItem`
 * (`lib/library-actions.ts`)当前不带画布名或上传/生成的区分,编一个就是向商家撒谎。
 *
 * 2026-09-04 Codex staging 审计 **LIB-STG-P2-005** 追加:名字本身(整段生成提示词)也可能过
 * 长甚至重复两遍。截断/去重规则挪进单一源头 `lib/library-item-a11y.ts`(`StuffLibrary.tsx`
 * 的 Library 主网格同一个 helper),这里的用例照该模块的规则更新了预期值——超过 60 字符的
 * 默认夹具因此改成带省略号的短标题,其余短提示词不受影响。规则本身的用例在
 * `lib/__tests__/library-item-a11y.test.ts`。
 *
 * 挂法照抄 `library-failure-human-copy.test.ts` 的配方(`react-dom/client` 的 `createRoot` +
 * `act`,这个仓库没有 `@testing-library/react`);Dialog 的 polyfill 抄
 * `overlay-design-system.test.tsx`(`ResizeObserver`/pointer capture/`scrollIntoView` 存根,
 * jsdom 没有这几个浏览器 API,base-ui 的 Dialog 会用到)。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@/lib/library-actions";

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
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ getGenerationHistory: vi.fn() }));
vi.mock("@/lib/library-actions", () => ({ getGenerationHistory: mocks.getGenerationHistory }));

const { CanvasLibraryPicker } = await import("@/components/canvas/CanvasLibraryPicker");

const mounted: { root: Root; container: HTMLDivElement }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  document.body.replaceChildren();
});

function item(over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: "gen_tumbler",
    projectId: "canvas_1",
    assetId: "asset_1",
    url: "/files/org/aa/bb/tumbler.png",
    kind: "image",
    // 段②A 把 `LibraryItem` 撑宽了(来源、文件名、两条边、时长)。引擎产物的那一行就长
    // 这样:`source: "generated"`、没有商家给的文件名、尺寸与时长按真库可空。
    source: "generated",
    filename: "",
    width: null,
    height: null,
    durationS: null,
    prompt: "A premium coral-orange insulated tumbler, ribbed grip, silver lid",
    favorite: false,
    createdAt: "2026-09-04T00:00:00.000Z",
    ...over,
  };
}

/** 打开 picker(受控 `open`,不用先点 trigger),把 effect 里那趟 `getGenerationHistory().then()`
 *  排空,回读到的是已挂载的整个 document。 */
async function mountPicker(items: LibraryItem[]): Promise<HTMLElement> {
  mocks.getGenerationHistory.mockResolvedValue({ items, nextCursor: null, hasMore: false });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () =>
    root.render(
      createElement(CanvasLibraryPicker, { open: true, onOpenChange: () => {}, onPick: () => {} }),
    ),
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return document.body;
}

function pickerButtons(): HTMLButtonElement[] {
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog, "the picker dialog did not mount").toBeTruthy();
  return Array.from(dialog!.querySelectorAll<HTMLButtonElement>("li button"));
}

describe("E2E-CRE-PAV-006 / FRONT-A14: Library picker items are readable by keyboard and screen reader", () => {
  it("FRONT-A14: an image item's button carries an accessible name — CONCISE asset title + media type, not the raw prompt", async () => {
    await mountPicker([item()]);
    const buttons = pickerButtons();
    expect(buttons).toHaveLength(1);
    // The fixture prompt is 65 chars — over the 60-char title cap (lib/library-item-a11y.ts),
    // so it truncates on a word boundary with an ellipsis instead of reading the full prompt.
    expect(buttons[0]!.getAttribute("aria-label")).toBe(
      "A premium coral-orange insulated tumbler, ribbed grip,…, image",
    );
    // The full prompt is not lost — it still reaches sighted users/tooltips via `title`.
    expect(buttons[0]!.getAttribute("title")).toBe(
      "A premium coral-orange insulated tumbler, ribbed grip, silver lid",
    );
  });

  it("FRONT-A14: a video item's accessible name says 'video', not 'image'", async () => {
    await mountPicker([
      item({ id: "gen_clip", kind: "video", prompt: "Xinyi holding the tumbler, 5s clip" }),
    ]);
    const [button] = pickerButtons();
    expect(button!.getAttribute("aria-label")).toBe("Xinyi holding the tumbler, 5s clip, video");
  });

  it("FRONT-A14: an untitled item still gets a name — falls back to the media type, never blank", async () => {
    await mountPicker([item({ id: "gen_untitled", prompt: "" })]);
    const [button] = pickerButtons();
    // Never an empty string and never a bare comma — a name with nothing in front of it.
    expect(button!.getAttribute("aria-label")).toBe("Image");
  });

  it("FRONT-A14: the thumbnail <img> is decorative — empty alt, the name lives on the button only", async () => {
    await mountPicker([item()]);
    const dialog = document.querySelector('[role="dialog"]')!;
    const img = dialog.querySelector("img");
    expect(img, "expected an <img> for an image-kind item").toBeTruthy();
    expect(img!.getAttribute("alt")).toBe("");
  });

  it("FRONT-A14: a video thumbnail is hidden from assistive tech the same way", async () => {
    await mountPicker([item({ id: "gen_clip", kind: "video" })]);
    const dialog = document.querySelector('[role="dialog"]')!;
    const video = dialog.querySelector("video");
    expect(video, "expected a <video> for a video-kind item").toBeTruthy();
    expect(video!.getAttribute("aria-hidden")).not.toBeNull();
  });

  it("FRONT-A14: two items with the same title still get distinguishable names by media type", async () => {
    await mountPicker([
      item({ id: "gen_a", kind: "image", prompt: "Xinyi with the tumbler" }),
      item({ id: "gen_b", kind: "video", prompt: "Xinyi with the tumbler" }),
    ]);
    const names = pickerButtons().map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
    expect(names).toContain("Xinyi with the tumbler, image");
    expect(names).toContain("Xinyi with the tumbler, video");
  });
});
