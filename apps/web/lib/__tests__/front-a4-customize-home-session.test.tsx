// @vitest-environment jsdom
/**
 * FRONT-A4 —— Customize home 这段「临时模式」自己的两条(2026-09-05 走查 P2③⑥)。
 *
 * 版面存哪儿、谁能存,`home-layout-persistence.test.ts` 与 `marketing-home-view.test.tsx`
 * 已经钉住了。这一份钉的是商家在这段模式里**当场**看到与按到的两件:
 *
 *   ③ 「Previewing unsaved changes」只在真的有未存改动时出现。从前它挂在「面板开着」上 ——
 *      面板一打开就说他有一份没存的改动,而他一个格子都还没动。那句话是给「离开会丢东西」
 *      用的,挂错了地方它就从警告退化成装饰。
 *   ⑥ Escape 退出这段模式,语义与 Cancel 逐字相同(丢草稿、回到已存版面)。从前只有 ✕ 与
 *      Cancel 两条出路,Escape 按下去什么都不发生。
 *
 * 用 jsdom 真挂载、真点、真按键 —— 纯字符串渲染看不出「按了没反应」这一类回退。
 * 一个 credit 都花不出去:这一段不碰钱路,存盘那颗按钮本测试一次都不按。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketingHomeView } from "@/components/home/MarketingHomeView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UNSAVED_NOTE = "Previewing unsaved changes";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  // `useDesktopHome()` 读 matchMedia;jsdom 没有它。Home 只在桌面渲染,所以这里说 true。
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function render(element: ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}

async function click(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

async function pressEscape(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
}

function byLabel(label: string): HTMLElement {
  const el = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!el) throw new Error(`找不到 aria-label 为「${label}」的控件`);
  return el;
}

function buttonLabelled(label: string): HTMLButtonElement {
  const el = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!el) throw new Error(`找不到写着「${label}」的按钮`);
  return el;
}

function customizePanel(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[aria-label="Customize home"]');
}

function pageText(): string {
  return document.body.textContent ?? "";
}

const health = {
  state: "partial",
  goal: "online-sales",
  period: "30-days",
  freshness: { status: "unknown", label: "Freshness unavailable" },
  evidenceStrength: "limited",
  source: { id: "meta-ads", label: "Meta ads" },
  metrics: [],
  chart: null,
  insight: null,
};

async function openCustomize(): Promise<void> {
  await render(
    createElement(MarketingHomeView, {
      filters: { goal: "online-sales", range: "30-days", comparison: "previous-period" },
      recents: { ok: true, value: [] },
      health,
      components: ["marketing-health"],
      offeredComponents: ["marketing-health"],
      recommendedComponents: ["marketing-health"],
      canManageHome: true,
    } as never),
  );
  await click(buttonLabelled("Customize home"));
  expect(customizePanel(), "Customize 面板没打开 —— 下面每一条都会恒绿").not.toBeNull();
}

describe("FRONT-A4:Customize home 这段模式里的两条", () => {
  it("FRONT-A4: opening Customize home does not claim there are unsaved changes yet", async () => {
    await openCustomize();
    expect(pageText()).not.toContain(UNSAVED_NOTE);
  });

  it("FRONT-A4: the unsaved-changes note appears only once the draft really differs, and goes away again", async () => {
    await openCustomize();

    // 把唯一那一块从版面里去掉 —— 草稿与已存版面从这一刻起真的不一样了。
    await click(byLabel("Marketing health"));
    expect(pageText()).toContain(UNSAVED_NOTE);

    // 再勾回来,草稿又与已存版面逐格相同 —— 那句话必须跟着消失,不是一开就贴到底。
    await click(byLabel("Marketing health"));
    expect(pageText()).not.toContain(UNSAVED_NOTE);
  });

  it("FRONT-A4: Escape leaves Customize home the same way Cancel does", async () => {
    await openCustomize();
    await click(byLabel("Marketing health"));
    expect(pageText()).toContain(UNSAVED_NOTE);

    await pressEscape();

    expect(customizePanel(), "Escape 之后 Customize 面板还开着").toBeNull();
    // 与 Cancel 逐字相同:草稿丢弃,入口回来。
    expect(pageText()).not.toContain(UNSAVED_NOTE);
    expect(buttonLabelled("Customize home")).toBeTruthy();
  });

  it("FRONT-A4: Escape does nothing when Customize home was never opened", async () => {
    await render(
      createElement(MarketingHomeView, {
        filters: { goal: "online-sales", range: "30-days", comparison: "previous-period" },
        recents: { ok: true, value: [] },
        health,
        components: ["marketing-health"],
        offeredComponents: ["marketing-health"],
        recommendedComponents: ["marketing-health"],
        canManageHome: true,
      } as never),
    );

    await pressEscape();

    expect(buttonLabelled("Customize home")).toBeTruthy();
    expect(customizePanel()).toBeNull();
  });
});
