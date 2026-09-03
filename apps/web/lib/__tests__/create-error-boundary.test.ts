// @vitest-environment jsdom
/**
 * 登记 2026-09-04 P0-5 —— 「导航失败＝永远的骨架屏」。
 *
 * 走查现场:`/create` 与 `/create/canvas` 各有一个 `<Suspense fallback>` 骨架,却没有自己的
 * error boundary。Railway 一次 502 之后,商家看到的是一块**永远转下去**的骨架:产品坏了但
 * 不肯说,而且没有任何出路 —— 没有重试,没有回头路,只能自己去猜要刷新。
 *
 * 这两页填上的正是那口井。断言三件:说了人话、给了「Try again」(真调 `reset()`)、留了一条
 * 回得去的路。加上白标那一条 —— 原始报错一个字不许印给商家(全族围栏另见 crash-boundary)。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: (...args: unknown[]) => captureException(...args) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: CanvasError } = await import("@/app/create/canvas/error");
const { default: CreateError } = await import("@/app/create/error");

/** 一条真实形态的报错:上游主机的话,一个字都不该出现在商家屏幕上。 */
const RAW = "502 Bad Gateway — upstream railway.app connection reset (req_77af)";

let container: HTMLDivElement;
let root: Root;

function render(Boundary: typeof CanvasError, reset = () => {}): HTMLDivElement {
  act(() => {
    root.render(createElement(Boundary, { error: Object.assign(new Error(RAW), { digest: "d1" }), reset }));
  });
  return container;
}

function buttonLabelled(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  expect(found, `应该有一颗「${text}」`).toBeDefined();
  return found!;
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("登记 2026-09-04 P0-5:画布加载失败有出路,不是永远的骨架屏", () => {
  it("登记 2026-09-04 P0-5:说人话,并且不出现技术词", () => {
    const html = render(CanvasError).textContent ?? "";
    expect(html).toContain("This canvas didn't open");
    expect(html).toContain("Nothing you made was lost");
    for (const jargon of ["502", "Bad Gateway", "railway", "req_77af", "fetch", "RSC", "Suspense"]) {
      expect(html).not.toContain(jargon);
    }
  });

  it("登记 2026-09-04 P0-5:「Try again」原地重挂这一段,不是整页刷新", () => {
    const reset = vi.fn();
    render(CanvasError, reset);
    act(() => buttonLabelled("Try again").click());
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("登记 2026-09-04 P0-5:留了一条回 Create 的路", () => {
    const link = [...render(CanvasError).querySelectorAll("a")].find((a) => a.getAttribute("href") === "/create");
    expect(link, "应该有一条回 /create 的链接").toBeDefined();
  });

  it("登记 2026-09-04 P0-5:崩溃照旧上报,不是零信号", () => {
    render(CanvasError);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      level: "error",
      tags: { surface: "route-error", digest: "d1" },
    });
    expect((captureException.mock.calls[0]![0] as Error).message).toBe(RAW);
  });
});

describe("登记 2026-09-04 P0-5:/create 首页同样有出路", () => {
  it("登记 2026-09-04 P0-5:人话 + Try again + 一条走得通的路", () => {
    const reset = vi.fn();
    const el = render(CreateError, reset);
    expect(el.textContent).toContain("Create didn't open");
    expect(el.textContent).not.toContain(RAW);
    act(() => buttonLabelled("Try again").click());
    expect(reset).toHaveBeenCalledTimes(1);
    expect([...el.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain("/otto");
  });
});
