/**
 * 「焦点被带进弹窗里了吗」—— **有界等待**版。
 *
 * 为什么需要它:Radix 的 FocusScope 把焦点移进弹窗是**异步**的(挂载之后的下一拍,走宏任务),
 * 而 `await act(...)` 只 flush 微任务与 effect。所以「弹窗一开焦点就在里面」这件事在同一个
 * tick 里**不保证**成立 —— 大多数时候成立,机器忙的时候不成立。
 *
 * 实证(判官 2026-09-02,独占测试库、独占 worktree、无并发):apps/web 全量跑两趟,
 * 第 1 趟 `library-real-route-986.test.ts` 的
 * `expect(dialog.contains(document.activeElement)).toBe(true)` 红了一条
 * (`Test Files 1 failed | 458 passed`),同一份文件单跑 16 条全绿,第 2 趟全量 460 份全绿。
 * 这是**等待不足**,不是行为不对 —— 而 CI 会随机翻车。
 *
 * 断言强度一格没降:焦点最终没进弹窗,照旧红(最后那一条 `expect` 永远会跑)。
 * 变的只有「必须在第一拍就完成」这个多余的时间要求。
 */
import { act } from "react";
import { expect } from "vitest";

/** 每拍让出一次事件循环;上限 100 拍(~100ms 起,足够 FocusScope 的下一拍)。 */
const MAX_TICKS = 100;

export async function expectFocusInside(
  surface: Element,
  message = "焦点还留在弹窗外面",
): Promise<void> {
  for (let tick = 0; tick < MAX_TICKS; tick += 1) {
    if (surface.contains(document.activeElement)) break;
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
  }
  expect(surface.contains(document.activeElement), message).toBe(true);
}
