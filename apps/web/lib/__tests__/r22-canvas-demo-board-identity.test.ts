// @vitest-environment jsdom
/**
 * 样例板归**演示项目**,不归工作区(Founder 2026-08-26 第 4 件的后半;编排者真机实证)。
 *
 * 上一版的判据是「还在不在 Batik House 这个工作区里」。于是商家在 Create 对话里说完一句
 * 话、按下建项目,进去看到的是:Raya 那一批四张样例、一张写着别人网址的摘录卡、一张别人
 * 的便签,Otto 状态头还随板派生出「All 4 images are done」加三条打了勾的步骤。他一个字
 * 都没做,却被告知做完了 —— 而这四张图属于 Raya launch 那个演示项目,不属于他刚建的空板。
 *
 * 判据改成**项目身份**之后,这四条钉的是商家屏幕上真实出现(与真实不出现)的东西:
 *   ① 刚建出来的项目板上零样例:零批次、零便签、零摘录卡,空态该出的起手模板那一排在场;
 *   ② 演示项目 Raya launch 的样例一根毫毛不动 —— 判据是项目身份,不是板子空不空;
 *   ③ 在 Create 对话里已经做出了一批再进画布(handoff):板上只有他真做的那一批;
 *   ④ 空板的 Otto 状态头一句完成语都没有,报的是「brief 读到了,等你说第一句」。
 * 外加一条 ⑤:handoff 板的状态头报的是这块板自己的数,不是写死的 4。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImmersiveCanvasRuntimeContext } from "@/components/canvas/NorthstarCanvasWorkspace";
import {
  CANVAS_FIXTURE_SESSION_VERSION,
  canvasFixtureSessionKey,
  fixtureBatchHome,
  NEW_PROJECT_FIXTURE_ID,
  type FixtureBatch,
} from "@/components/canvas/r22-canvas-fixture";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/canvas-actions", () => ({ listCanvasNodes: vi.fn().mockResolvedValue([]) }));
vi.mock("@/components/canvas/useCanvasGen", () => ({
  freshCanvasActionId: () => "canvas-action-test",
  useCanvasGen: () => ({ generateImage: vi.fn(), quoteCosts: vi.fn(), imageShapes: vi.fn() }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { R22CanvasSurface } = await import("@/components/canvas/R22CanvasSurface");

/** `DEFAULT_R22_WORKSPACE_DIRECTORY.activeId` —— 没有 seed directory 时的默认 workspace。 */
const WORKSPACE_ID = "batik-house";
/** 演示项目。样例板是它自己的东西。 */
const DEMO_PROJECT = "fixture-raya";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function runtimeContext(activeProjectId: string): ImmersiveCanvasRuntimeContext {
  return {
    projects: [
      { id: DEMO_PROJECT, name: "Raya launch" },
      { id: NEW_PROJECT_FIXTURE_ID, name: "New project" },
    ],
    threads: [],
    activeProjectId,
    activeThreadId: null,
    initialBalance: null,
    visualFixture: "r22",
  };
}

async function mount(activeProjectId: string): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(R22CanvasSurface, { runtimeContext: runtimeContext(activeProjectId), entities: [] }));
  });
  await act(async () => { await Promise.resolve(); });
}

function all<T extends Element>(selector: string): T[] {
  return Array.from(container!.querySelectorAll<T>(selector));
}

function need<T extends Element>(selector: string): T {
  const node = container!.querySelector<T>(selector);
  expect(node, `找不到 ${selector} —— 下面的断言在核对空气`).not.toBeNull();
  return node!;
}

function batchIds(): string[] {
  return all<HTMLElement>("[data-canvas-batch]").map((node) => node.dataset.canvasBatch!);
}

/** Otto 状态头此刻写着的那一整段(那句话 + 那几条勾)。 */
function ottoBody(): string {
  return need<HTMLElement>(".r22-canvas-otto-body").textContent ?? "";
}

/** 「在 Create 对话里已经做出了一批」落进画布会话的样子(与 `appendCanvasFixtureHandoff` 同形)。 */
function seedHandoff(projectId: string, artCount: number): FixtureBatch {
  const batch: FixtureBatch = {
    id: "batch-1",
    kind: "image",
    ratio: "9:16",
    credits: 3 * artCount,
    madeFrom: null,
    references: [],
    home: fixtureBatchHome(1),
    art: Array.from({ length: artCount }, (_, index) => ({
      id: `handoff-${index + 1}`,
      label: `Image ${index + 1}`,
      src: "/fixtures/r22-canvas/art-1.jpg",
      alt: `Handoff ${index + 1}`,
    })),
  };
  window.sessionStorage.setItem(
    `${canvasFixtureSessionKey(projectId, null)}:${WORKSPACE_ID}`,
    JSON.stringify({
      version: CANVAS_FIXTURE_SESSION_VERSION,
      messages: [{ from: "me", text: "A pandan candle on white linen" }],
      batches: [batch],
    }),
  );
  return batch;
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe("样例板归演示项目,不归工作区", () => {
  it("① 刚建出来的项目:板上零批次、零便签、零摘录卡,起手模板那一排在场", async () => {
    await mount(NEW_PROJECT_FIXTURE_ID);

    expect(batchIds(), "商家一个字都没做,板上却摆着别人那一批").toEqual([]);
    expect(container!.querySelector('[data-canvas-object="sticky"]'), "别人的便签长到了他的空板上").toBeNull();
    expect(container!.querySelector('[data-canvas-object="research"]'), "写着 harvestcandle.co 的摘录卡长到了他的空板上").toBeNull();
    expect(ottoBody(), "空板上还写着别人网址").not.toContain("harvestcandle.co");
    expect(container!.querySelector("[data-r22-template-row]"), "空板上没有起手模板那一排").toBeTruthy();
  });

  it("② 演示项目 Raya launch 的样例一根毫毛不动", async () => {
    await mount(DEMO_PROJECT);

    expect(batchIds(), "演示项目开局那一批被误删了").toEqual(["batch"]);
    expect(all('[data-canvas-batch="batch"] [data-canvas-select]').length, "开局那一批不是四张了").toBe(4);
    expect(need('[data-canvas-object="sticky"]').textContent).toContain("Teal + gold table set");
    expect(need('[data-canvas-object="research"]').textContent).toContain("harvestcandle.co");
    expect(container!.querySelector("[data-r22-template-row]"), "板上有东西了还在劝商家从头起手").toBeNull();
  });

  it("③ 在 Create 对话里做完再进来:板上只有他真做的那一批", async () => {
    const handoff = seedHandoff(NEW_PROJECT_FIXTURE_ID, 1);
    await mount(NEW_PROJECT_FIXTURE_ID);

    expect(batchIds(), "他自己那一批之外还多出了样例那一批").toEqual([handoff.id]);
    expect(all("[data-canvas-select]").map((node) => node.getAttribute("aria-label")))
      .toEqual([handoff.art[0]!.label]);
    expect(container!.querySelector('[data-canvas-object="research"]'), "他自己做的那块板上出现了别人的摘录卡").toBeNull();
  });

  it("④ 空板的状态头一句完成语都没有 —— 报的是「等你说第一句」", async () => {
    await mount(NEW_PROJECT_FIXTURE_ID);

    const body = ottoBody();
    expect(body, "一块空板配一段完成汇报").not.toContain("All 4 images are done");
    expect(body, "一个字都没做,却被告知做完了").not.toMatch(/\bdone\b/i);
    expect(body, "空板上还在报「ready」").not.toMatch(/\bready\b/i);
    expect(body).toContain("Your brief is loaded.");
    expect(body).toContain("Waiting for your first request");
  });

  it("⑤ handoff 板的状态头报的是这块板自己的数,不是写死的 4", async () => {
    seedHandoff(NEW_PROJECT_FIXTURE_ID, 1);
    await mount(NEW_PROJECT_FIXTURE_ID);

    const body = ottoBody();
    expect(body, "一张图的板上报着「All 4 images are done」").not.toContain("All 4 images");
    expect(body).toContain("1 image on this board");
  });
});
