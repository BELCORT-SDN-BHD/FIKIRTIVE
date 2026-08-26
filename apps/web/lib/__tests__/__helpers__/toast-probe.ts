/**
 * toast-probe.ts —— 读 sonner 回执的那把尺子。
 *
 * 2026-08-26(审计 A-4)五扇门各自手搓的回执条(`.r22-lib-notice` / `.r22-canvas-notice` /
 * `.r22-settings-notice` / `.r22-iq-hub-notice` / `.r22-library-notice`)全部收敛到
 * `toast()`。回执因此不再长在被测组件的子树里,而是由挂在根布局上的 `<Toaster />` 渲染 ——
 * 于是每一份「回执出现了没有」的测试都要做两件事:把 Toaster 一起挂上,再来这里读。
 *
 * 三件事这份文件替所有测试做一次,不让它们各写一遍(各写一遍 = 迟早各写各的):
 *   ① `installToastEnvironment()` —— jsdom 缺的那几件(`matchMedia`)。**只补环境,不改
 *      行为**:少了它 sonner 的 Toaster 在挂载时就抛,和被测的东西无关。
 *   ② `withToaster(element)` —— 把被测组件与 Toaster 挂进同一棵树。生产上它们也在同一棵
 *      树里(`app/layout.tsx`),所以这不是替身,是把真实布局补齐。
 *   ③ `settleToasts()` —— sonner 的那一条要等一个宏任务才落进 DOM。真时钟等 30ms,
 *      假时钟推 1ms(实测两者都够;假时钟只推 1ms 是为了不误触被测组件自己的 320/920ms
 *      节拍)。
 *
 * DOM 顺序是**新的在前**(实测):`toastTexts()[0]` 就是最后说的那一句。
 */
import { act, createElement, Fragment, type ReactElement, type ReactNode } from "react";
import { vi } from "vitest";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";

/** jsdom 没有 `matchMedia`,sonner 的主题探测挂载即用。只补这一件,别的都不动。 */
export function installToastEnvironment(): void {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
}

/** 被测组件 + Toaster,同一棵树 —— 与 `app/layout.tsx` 上的真实关系一致。 */
export function withToaster(element: ReactNode): ReactElement {
  return createElement(Fragment, null, element, createElement(Toaster));
}

/** 等那一条真的落进 DOM。假时钟下只推 1ms,免得顺手把被测组件的定时器也推过去。 */
export async function settleToasts(): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) vi.advanceTimersByTime(1);
    else await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

/** 屏上全部回执,新的在前。 */
export function toastTexts(): string[] {
  return [...document.body.querySelectorAll("[data-sonner-toast] [data-title]")].map((node) => node.textContent ?? "");
}

/** 最后说的那一句;一条都没有就是空串(与旧那条 `noticeText()` 的空串同义)。 */
export function latestToast(): string {
  return toastTexts()[0] ?? "";
}

/** 回执上那颗后续动作。`label` 给了就按文字认,没给就取最新那一条上的第一颗。 */
export function toastAction(label?: string): HTMLElement | null {
  const buttons = [...document.body.querySelectorAll<HTMLElement>("[data-sonner-toast] [data-button], [data-sonner-toast] a")];
  if (!label) return buttons[0] ?? null;
  return buttons.find((node) => (node.textContent ?? "").trim() === label) ?? null;
}

/** 每条测试收尾时清账 —— 不清的话,下一条测试会读到上一条的回执。 */
export function clearToasts(): void {
  toast.dismiss();
}
