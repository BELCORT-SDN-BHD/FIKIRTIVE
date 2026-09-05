// @vitest-environment jsdom
/**
 * FRONT-A14 —— 前门「Start with a goal」四格的摆列跟着面板走,不跟着窗口走。
 *
 * 2026-09-05 走查 P2「面板四格标题折行拥挤」:340px 的面板里两列各只剩几十 px 给标题,
 * 于是「Sell a product」折成「Sell a / product」、每条说明折三四行,四格挤成一团。
 * 病根不是字号,是尺子拿错了 —— 那一格从前写的是**视口**断点 `max-[480px]:grid-cols-1`,
 * 而面板是能拖宽窄的(`docs/specs/wave2-shell.md` §3.1:320px – min(720px,50vw)):
 * 窗口一动不动的时候面板照样在变,1440 的屏幕上那条断点**永远不生效**。
 *
 * 这份文件钉的就是「用对尺子」这件事本身,判据与面板卡片那一族同一条
 * (`components/otto/card-narrow.tsx`:一对**严格互补**的容器变体,任何宽度下恰好一条生效),
 * 断点也沿用面板已有的那一个,不新造尺寸。把它改回视口断点、或把两条写成 419/420 留一条缝,
 * 当场红。
 *
 * 一个 credit 都花不出去:开线程与服务端读全是替身。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: vi.fn(), ottoTurn: vi.fn(), createEmptyCoworkThread: vi.fn(), setAdsAutonomy: vi.fn(),
}));
vi.mock("@/lib/cowork-actions", () => ({
  coworkGenerate: vi.fn(), coworkVaryCard: vi.fn(), cancelGenJob: vi.fn(),
}));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: vi.fn() }));
vi.mock("@/lib/otto-start-thread", () => ({ startStreamedThread: vi.fn() }));
vi.mock("@/lib/reference-search-actions", () => ({ searchReferencesAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/otto",
  useSearchParams: () => new URLSearchParams(),
}));

import { OttoFrontDoor } from "@/components/otto/OttoFrontDoor";
import { CARD_NARROW_BREAKPOINT_PX } from "@/components/otto/card-narrow";
import { FRONT_DOOR_GOAL_LABELS } from "@/lib/otto-canned-starters";

function goalGrid(): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(OttoFrontDoor, {
      projectId: "proj_1",
      userName: "Rahim",
      onThreadStarted: vi.fn(),
      onStreamStart: vi.fn(),
    }),
  );
  const grid = host.querySelector<HTMLElement>(".otto-goal-grid");
  if (!grid) throw new Error("前门没渲染出目标四格 —— 下面的断言会在一张空屏上恒绿");
  // 四颗格子确实在这块网格里,否则「网格怎么摆」是一句空话。
  for (const label of Object.values(FRONT_DOOR_GOAL_LABELS)) {
    expect(grid.textContent, `目标格子「${label}」不在这块网格里`).toContain(label);
  }
  return grid;
}

describe("FRONT-A14:前门四格按面板宽度摆列", () => {
  const N = CARD_NARROW_BREAKPOINT_PX;

  it("FRONT-A14: the goal grid switches columns on its own box, not on the viewport", () => {
    const grid = goalGrid();
    // 容器上下文必须真的存在于祖先链上 —— 少了它,底下的 `@max-/@min-` 一条都不会生效。
    let node: HTMLElement | null = grid.parentElement;
    let hasContainerAncestor = false;
    while (node) {
      if (node.classList.contains("@container")) { hasContainerAncestor = true; break; }
      node = node.parentElement;
    }
    expect(hasContainerAncestor, "四格网格上方没有任何 @container 祖先").toBe(true);

    // 视口断点不许回来:`max-[…]:grid-cols-…`(没有 `@` 前缀)量的是窗口,量不到面板。
    const viewportColumnRule = [...grid.classList].find((c) => /^max-\[\d+px\]:grid-cols-/.test(c));
    expect(viewportColumnRule, "四格网格又用回了视口断点").toBeUndefined();
  });

  it("FRONT-A14: the two container rules are strictly complementary at one shared breakpoint", () => {
    const classes = [...goalGrid().classList];
    expect(classes).toContain(`@max-[${N}px]:grid-cols-1`);
    expect(classes).toContain(`@min-[${N}px]:grid-cols-2`);
    // 同一个数才没有缝:`@max-[N]` 是严格小于 N,写成 419/420 会在 419px 上谁都不生效。
    const breakpoints = new Set(
      classes.flatMap((c) => /^@(?:max|min)-\[(\d+)px\]:grid-cols-/.exec(c)?.slice(1) ?? []),
    );
    expect([...breakpoints]).toEqual([String(N)]);
  });
});
