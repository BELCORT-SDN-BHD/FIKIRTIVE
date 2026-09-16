// @vitest-environment jsdom
/**
 * FRONT-A15 —— 按住 Shift 点第二张卡，第一张不会被悄悄丢掉（Refs #1357）。
 *
 * 这一份和隔壁 `front-a15-canvas-selection.test.ts` 是两件事，刻意如此：那一份把 `@xyflow/react`
 * 换成替身，验的是 FlowCanvas 自己的接线；本病住在**真 React Flow 的时序**里，替身永远绿，所以
 * 这一份用的是真的那一个。
 *
 * 病情（CI journey 17 偶发红：run 34820228755 / 34681183175，两次都停在同一句
 * `e2e/journeys/17-canvas-selection.spec.ts:79`，收到的只有第二张卡）：
 * React Flow 的加选开关 `multiSelectionActive` 是 Shift 的 keydown 先变成 React state、再由一个
 * **passive effect** 写进 store 的；而卡的选中判定在卡自己的 `onClick` 里同步读 store。浏览器
 * 把输入事件排在 React 那个 MessageChannel 任务前面时，点击就抢在开关之前落地，`addSelectedNodes`
 * 走「换一张」而不是「加一张」—— 屏幕上第一张卡的描边没了。
 *
 * 所以这里把那个时序**摆出来**，不是等它：keydown 派出去之后不冲刷 React 的 effect，紧接着
 * 就派点击。没有 wall clock、没有重试、没有 sleep —— 事件顺序本身就是断言的内容。
 */
import { act, createElement, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReactFlow, applyNodeChanges, type Node, type NodeChange } from "@xyflow/react";
import { CanvasMultiSelectModifier } from "@/components/canvas/CanvasMultiSelectModifier";
import fs from "node:fs";
import path from "node:path";

/** jsdom 没有 ResizeObserver，而 React Flow 一挂载就要量自己。量出 0 不影响选中判定。 */
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** 板上两张卡，第一张已经选中 —— 就是 journey 17 在 Shift 点下去之前的那一刻。 */
function Board(): ReturnType<typeof createElement> {
  const [nodes, setNodes] = useState<Node[]>([
    { id: "first", position: { x: 0, y: 0 }, data: {}, selected: true },
    { id: "second", position: { x: 400, y: 0 }, data: {} },
  ]);
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, []);
  return createElement(
    ReactFlow,
    {
      nodes,
      onNodesChange,
      // FlowCanvas 交给 React Flow 的那几条选中相关的 prop，逐字同一份。
      multiSelectionKeyCode: ["Shift", "Meta", "Control"],
      selectionKeyCode: "Shift",
      selectionOnDrag: true,
      panOnDrag: false,
      deleteKeyCode: null,
    },
    // 产品里它就挂在 <ReactFlow> 底下（FlowCanvas.tsx），这里同一个位置。
    createElement(CanvasMultiSelectModifier),
  );
}

describe("FRONT-A15 Shift 加选不看 React 的脸色", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= StubResizeObserver;
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  const selected = (): string[] =>
    [...host.querySelectorAll(".react-flow__node.selected")].map((n) => n.getAttribute("data-id") ?? "");

  it("FRONT-A15: Shift 按下与点击落在同一拍里，两张卡都还在选中里", async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(Board));
    });
    expect(selected(), "开场：第一张卡是选中的").toEqual(["first"]);

    const second = host.querySelector('.react-flow__node[data-id="second"]')!;
    // 关键的一拍：keydown 之后**不**冲刷 React 的 effect，点击紧接着落地。
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true, bubbles: true }));
    second.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    await act(async () => {});

    expect(
      selected().sort(),
      "Shift 点第二张是「加一张」，不是「换一张」——第一张不该被这一下丢掉",
    ).toEqual(["first", "second"]);
  });

  /**
   * 上面那条只钉住了「加一张」。一个只会往 store 里写 `true` 的坏同步——把那一句
   * `event.shiftKey || …` 换成常量 `true`——照样能让它绿：开关常开，每一下点击都是加选。
   * 所以另一半必须同样钉死：没按修饰键的那一下，就得是「换一张」。
   * 两条合起来，这个同步才只能照着**这一下点击自己带的修饰键**写。
   */
  it("FRONT-A15: 不按修饰键点第二张就是「换一张」——开关不许常开", async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(Board));
    });
    expect(selected(), "开场：第一张卡是选中的").toEqual(["first"]);

    const second = host.querySelector('.react-flow__node[data-id="second"]')!;
    // 光秃秃的一下：没有 Shift、没有 Meta、没有 Control。
    second.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await act(async () => {});

    expect(
      selected(),
      "空手点第二张是「换一张」：手里只该剩第二张，第一张要被这一下换掉",
    ).toEqual(["second"]);
  });

  it("FRONT-A15: 真画布确实挂着这条同步（harness 与产品不脱钩）", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "..", "components", "canvas", "FlowCanvas.tsx"),
      "utf8",
    );
    expect(source, "FlowCanvas 不再挂 CanvasMultiSelectModifier，这一份就只是在测它自己").toContain(
      "<CanvasMultiSelectModifier />",
    );
    expect(source, "harness 抄的是这几条 prop，产品改了它们这一份就不再代表产品").toContain(
      'multiSelectionKeyCode={["Shift", "Meta", "Control"]}',
    );
  });
});
