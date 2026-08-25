// @vitest-environment jsdom
/**
 * 画布壳的**委派契约** —— `NorthstarCanvasWorkspace` 把 props 原样交给 `R22CanvasSurface`。
 *
 * ── 退役立碑(Founder 2026-08-25 授权的旧架构归位)────────────────────────────────
 *
 * 这个文件原本是「北极星 Canvas 页 = 北极星的皮 + 修真内核的芯」(#600 · spec #599 D1/D2)的
 * 验收:它挂起真的 `FlowCanvas` 内核、替身掉 `@xyflow/react` 与 `useCanvasGen`,然后逐条钉
 * 商家看得见的结果 —— 内核画的板(`syncOttoCanvasNodes` 读、真 ImageNode 卡)、常显 credits、
 * 缩放控件、嵌入式 Otto 输入、多选批量条、落位不压卡、邻近落位、@ 引用整条链路。共 10 条。
 *
 * 那套内核架构已经**整体让位**:Founder 2026-08-24 检查点亲选 direction 2(「2 很棒」),
 * R22 Data-first 换壳落地后 `components/canvas/R22CanvasSurface.tsx` 是画布唯一的可见 surface,
 * 而 `NorthstarCanvasWorkspace.tsx` 缩成了一层**纯转发壳**(整个文件只剩一次 `<R22CanvasSurface
 * runtimeContext={…} entities={…} />`)。上面那 10 条断言钉的是这层壳身上早已不存在的东西:
 *
 *   · `syncOttoCanvasNodes` / `FlowCanvas` / `@xyflow/react` —— 壳不再引用它们中的任何一个;
 *   · 「常显 credits」("1,240 credits")—— 设计原则第 18 条(Founder 2026-08-21 裁决)把余额
 *     收归 Billing 一处,画布上出现常驻余额本身就是违规,断言在钉一件**不该发生**的事;
 *   · 缩放控件 / 批量条 / 落位算法 / @ 引用 —— 全部搬进 R22 surface,由它自己的契约测试与
 *     `r22-canvas-parity-contract.test.ts` 覆盖;在这里重挂一份等于把 surface 的实现细节
 *     钉进壳的测试里,而壳恰恰是那个应该什么都不知道的角色。
 *
 * 强行改写那 10 条只会得到一份「测 surface、却假装在测壳」的测试。所以整份退役,换成这份
 * 精瘦的委派契约 —— 壳只剩一个职责,这里就只钉那一个职责,外加一条旧板永不回来的守卫。
 *
 * 零后端、零生成:文件系统 + 一次挂载,一个积分都花不出去。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  surfaceProps: { current: null as null | Record<string, unknown> },
}));

// 唯一的替身:承重的那一面。壳把什么交出来,这里就原样接住什么 —— 中间没有第二个组件
// 有机会补货或改写,所以「原样转发」这件事是被真的验到的,不是读源码读出来的。
vi.mock("@/components/canvas/R22CanvasSurface", () => ({
  R22CanvasSurface: (props: Record<string, unknown>) => {
    mocks.surfaceProps.current = props;
    return createElement("div", { "data-testid": "r22-canvas-surface" });
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { NorthstarCanvasWorkspace } = await import("@/components/canvas/NorthstarCanvasWorkspace");
type RuntimeContext = import("@/components/canvas/NorthstarCanvasWorkspace").ImmersiveCanvasRuntimeContext;
type Entity = import("@/lib/types").EntityDTO;

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = (relativePath: string): string => readFileSync(resolve(WEB_ROOT, relativePath), "utf8");

const SHELL = "components/canvas/NorthstarCanvasWorkspace.tsx";

const RUNTIME_CONTEXT: RuntimeContext = {
  projects: [
    { id: "p1", name: "Kedai Kopi" },
    { id: "p2", name: "Raya Campaign" },
  ],
  threads: [
    { id: "t1", projectId: "p1", title: "Morning shots", updatedAt: "2026-08-01T00:00:00.000Z", pinnedAt: null },
  ],
  activeProjectId: "p1",
  activeThreadId: "t1",
  initialBalance: 1240,
  initialPrompt: "a cup steaming",
  visualFixture: null,
};

const ENTITY = { id: "e-mug", type: "PRODUCT", name: "Signature mug" } as unknown as Entity;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  mocks.surfaceProps.current = null;
  vi.clearAllMocks();
});

async function renderShell(element: ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(element); });
}

describe("画布壳只做一件事:把 props 原样交给 R22 surface", () => {
  it("交出去的 runtimeContext 就是收进来的那一个对象 —— 中途没人改写", async () => {
    await renderShell(createElement(NorthstarCanvasWorkspace, { runtimeContext: RUNTIME_CONTEXT, entities: [ENTITY] }));

    expect(container!.querySelector('[data-testid="r22-canvas-surface"]'), "壳没有渲染 R22 surface").not.toBeNull();
    // 同一性(toBe 而不是 toEqual):壳复制一份再传,就是又一个可以悄悄漂移的真相。
    expect(mocks.surfaceProps.current!.runtimeContext).toBe(RUNTIME_CONTEXT);
    expect(mocks.surfaceProps.current!.entities).toEqual([ENTITY]);
  });

  it("没传 entities 时给的是空清单,不是 undefined —— surface 不必替调用方兜底", async () => {
    await renderShell(createElement(NorthstarCanvasWorkspace, { runtimeContext: RUNTIME_CONTEXT }));

    expect(mocks.surfaceProps.current!.entities).toEqual([]);
  });

  it("壳自己不多发明一个 prop:交出去的就是这两个", async () => {
    await renderShell(createElement(NorthstarCanvasWorkspace, { runtimeContext: RUNTIME_CONTEXT, entities: [] }));

    expect(Object.keys(mocks.surfaceProps.current!).sort()).toEqual(["entities", "runtimeContext"]);
  });
});

describe("壳不再认识旧内核", () => {
  it("源码里一条旧内核的 import 都没有", () => {
    const shell = source(SHELL);
    for (const gone of ["FlowCanvas", "@xyflow/react", "otto-canvas-bridge", "syncOttoCanvasNodes", "useCanvasGen", "canvas-actions"]) {
      expect(shell, `${SHELL} 又认识 ${gone} 了 —— 壳开始自己承重,委派就不再是唯一的路`).not.toContain(gone);
    }
  });

  /**
   * 手搓板退场(#600 验收① → #606 T7 收尾)—— 这条与 R22 换壳无关,照旧有效:
   * T7 把手搓板整个文件从树里删掉,第二块画布实现无处可回来。同一条守住它专用的运行时。
   */
  it("手搓板与它专用的运行时都不在树里", () => {
    expect(existsSync(resolve(WEB_ROOT, "components/northstar/create/canvas-page.tsx"))).toBe(false);
    expect(existsSync(resolve(WEB_ROOT, "components/canvas/immersive-canvas-runtime.ts"))).toBe(false);
    for (const file of [SHELL, "components/canvas/ImmersiveCanvasEntry.tsx", "app/create/canvas/page.tsx"]) {
      expect(source(file), `${file} 又引用了手搓板`).not.toContain("northstar/create/canvas-page");
    }
  });
});
