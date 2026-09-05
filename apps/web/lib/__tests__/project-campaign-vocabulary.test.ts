// @vitest-environment jsdom
/**
 * project-campaign-vocabulary.test.ts — #546 (E2E-S0 F-06): a Project is never a Campaign.
 *
 * Vocabulary authority: docs/BLUEPRINT.md:191 (Campaign is an independent object, a
 * Project is never a campaign) and CONTEXT.md (Project _Avoid:_ Campaign; Project Brief
 * is the per-project brief — brand-constant facts live in Brand memory).
 *
 * W2-11(换壳切换总票)删掉了这个文件原来的另外两组断言 —— 不是这条纪律不成立了,是它们
 * 测的组件本身不在了:
 *   - F-04(导轨创建入口的按钮文案)测的是 `OttoNav.tsx`,随旧壳一起删除。新壳的创建入口是
 *     `/create` 页面自己的 `StartSomething`,不说 "New campaign"(已抽查确认)。
 *   - 第三组("the getting-started card...")测的是 `OttoOnboarding.tsx`,同样随旧壳删除 ——
 *     它守的那句「Two quick things before your first project」原样搬进了 Home 自己的
 *     「把 Otto 装备好」区块(`components/home/home-data.ts`),不是没了,是挪了家。
 * F-06 测的 `QuickBrief` 组件仍然是真的那一套(挂在新面板的 `OttoFrontDoor` 里),留着。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { setCoworkBriefMock, getCoworkBriefMock } = vi.hoisted(() => ({
  setCoworkBriefMock: vi.fn(),
  // #791-1: QuickBrief reads the stored brief when it opens (so a save can't silently
  // replace it). This file asserts vocabulary, so the read just resolves empty.
  getCoworkBriefMock: vi.fn(async () => ({ brief: "" })),
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

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("#546 F-06 — the per-project brief is a Project brief, not a brand brief", () => {
  it("labels the intake toggle 'Project brief' and points store-level facts to Brand memory", async () => {
    const dom = await render(createElement(QuickBrief, { projectId: "p1" }));

    const toggle = Array.from(dom.querySelectorAll("button")).find((b) =>
      /brief/i.test(b.textContent ?? ""),
    );
    expect(toggle, "the brief toggle must exist").toBeTruthy();
    // "Set up brand brief" was the 2026-07 UI drift: it stored Project.coworkBrief
    // (per-project, gone when you switch projects) while sounding like the org-level
    // Brand memory. The vocabulary name is "Project brief".
    expect(toggle!.textContent).toContain("Project brief");
    expect(toggle!.textContent).not.toMatch(/brand brief/i);

    // Open it: the form must carry the one-line pointer that brand-constant facts
    // live in Brand memory (so merchants stop typing their shop identity in here).
    await click(toggle!);
    expect(dom.textContent).toContain("Brand memory");
  });

  it("keeps the original four-field brief capability while scoping every prompt to this Project", async () => {
    setCoworkBriefMock.mockResolvedValue({ ok: true });
    const dom = await render(createElement(QuickBrief, { projectId: "p1" }));
    const toggle = Array.from(dom.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Project brief"),
    );
    await click(toggle!);

    const offer = dom.querySelector<HTMLInputElement>("#qb-offer");
    const audience = dom.querySelector<HTMLInputElement>("#qb-audience");
    const platform = dom.querySelector<HTMLInputElement>("#qb-platform");
    const budget = dom.querySelector<HTMLInputElement>("#qb-budget");
    expect(offer).toBeTruthy();
    expect(audience).toBeTruthy();
    expect(platform).toBeTruthy();
    expect(budget).toBeTruthy();
    // 词汇本身在 2026-09-06 由 FRONT-A14 词汇围栏统一到 `lib/product-vocabulary.ts`:
    // 商家面前 Project 一律说 Canvas(IA README §6,Founder 2026-08-30)。这条断言守的
    // 仍是 F-06 原意 —— 这四格问的是**这一件作品**的 offer/audience/channel/budget,
    // 不是店铺层面的常量事实(那些在 Brand memory)。
    expect(dom.textContent).toContain("Offer for this Canvas");
    expect(dom.textContent).toContain("Audience for this Canvas");
    expect(dom.textContent).toContain("Where this Canvas will run");
    expect(dom.textContent).toContain("Budget for this Canvas");
    expect(dom.textContent).not.toContain("for this project");
    expect(dom.textContent).not.toContain("What you sell / offer");

    await typeInto(offer!, "The summer collection");
    await typeInto(audience!, "First-time home buyers");
    await typeInto(platform!, "TikTok");
    await typeInto(budget!, "$500/month");
    await submit(dom.querySelector("form")!);

    expect(setCoworkBriefMock).toHaveBeenCalledWith({
      projectId: "p1",
      brief:
        "We offer: The summer collection. Audience: First-time home buyers. " +
        "Posts on: TikTok. Budget vibe: $500/month",
    });
  });
});
