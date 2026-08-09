// @vitest-environment jsdom
/**
 * #791-1(表单面):QuickBrief 打开时必须先把「现在的 brief」摆出来。
 *
 * 原状:表单四个字段永远空着,Save 用 updateMany 直接覆写 Project.coworkBrief。
 * 商家(或 Otto 的 updateBrief)之前写过的方向,在这张表单里一个字都看不见 ——
 * 只要再开一次表单随手填一格,先前那段就无声消失了。
 *
 * 这里钉的是两件事:打开就读、并且把读到的原文显示出来,还要说清楚保存会替换它。
 * RED on 修复前的 QuickBrief(它从不调用任何读接口,也不渲染现有 brief)。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { setCoworkBriefMock, getCoworkBriefMock } = vi.hoisted(() => ({
  setCoworkBriefMock: vi.fn(),
  getCoworkBriefMock: vi.fn(),
}));
vi.mock("@/lib/cowork-actions", () => ({
  setCoworkBrief: setCoworkBriefMock,
  getCoworkBrief: getCoworkBriefMock,
}));

import { QuickBrief } from "@/components/otto/QuickBrief";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function toggleOf(dom: HTMLElement): HTMLButtonElement {
  const button = Array.from(dom.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes("Project brief"),
  );
  if (!button) throw new Error("Project brief toggle not found");
  return button as HTMLButtonElement;
}

describe("#791-1 QuickBrief 打开时显示当前 brief", () => {
  it("展开表单时读这个项目的 brief,并把原文摆出来", async () => {
    getCoworkBriefMock.mockResolvedValue({ brief: "We offer: neon mugs. Audience: students" });
    const dom = await render(createElement(QuickBrief, { projectId: "p1" }));

    await click(toggleOf(dom));
    await act(async () => { await Promise.resolve(); });

    expect(getCoworkBriefMock).toHaveBeenCalledWith("p1");
    expect(dom.textContent).toContain("We offer: neon mugs. Audience: students");
    // 覆盖风险要说出口,而不是让商家自己发现。
    expect(dom.textContent).toMatch(/replace/i);
  });

  it("这个项目还没有 brief 时说「还没有」,不假装有一段", async () => {
    getCoworkBriefMock.mockResolvedValue({ brief: "" });
    const dom = await render(createElement(QuickBrief, { projectId: "p1" }));

    await click(toggleOf(dom));
    await act(async () => { await Promise.resolve(); });

    expect(dom.textContent).toMatch(/no brief yet/i);
    expect(dom.textContent).not.toMatch(/replace/i);
  });

  it("读失败时不谎称「还没有 brief」—— 说读不到", async () => {
    getCoworkBriefMock.mockResolvedValue({ error: "Couldn't read the brief — please try again." });
    const dom = await render(createElement(QuickBrief, { projectId: "p1" }));

    await click(toggleOf(dom));
    await act(async () => { await Promise.resolve(); });

    expect(dom.textContent).not.toMatch(/no brief yet/i);
    expect(dom.textContent).toMatch(/couldn't read/i);
  });
});
