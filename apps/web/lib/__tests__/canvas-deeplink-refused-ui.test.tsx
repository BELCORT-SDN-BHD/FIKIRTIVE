// @vitest-environment jsdom
/**
 * FSE-207 拒绝页自己 —— 商家真的看到了那句人话,以及两条走得通的出路。
 *
 * 规格 `docs/specs/creation-engine.md` §5(2026-09-11 登记行;Founder 2026-09-12 #1358 裁
 * 「零写入」为硬口径,本条升 P1)。复测句的第三件事是「必须有一句人话」—— 零写入与不改写
 * 地址由 `canvas-deeplink-cross-tenant-fse207.test.ts` 在真库上钉,这一份钉屏幕。
 *
 * 走查现场那一页什么都没说(空白新画布、零提示),所以这里连「不许说什么」一起钉:商家读
 * 到的句子里不许出现 project id、`ownerId`、tenant 这类内部词 —— 白标围栏与画布 error
 * boundary 同一把尺子。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { CanvasDeepLinkRefused, CANVAS_DEEP_LINK_REFUSAL_COPY } = await import(
  "@/components/canvas/CanvasDeepLinkRefused"
);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(CanvasDeepLinkRefused)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("FSE-207 跨租户画布深链的拒绝页", () => {
  it("FSE-207 — says in plain words that the link is not in this workspace", () => {
    const heading = container.querySelector("h1");
    expect(heading?.textContent).toBe(CANVAS_DEEP_LINK_REFUSAL_COPY.heading);
    expect(heading?.textContent).toBe("This canvas isn't in your workspace");
    expect(container.textContent).toContain("This link belongs to a different workspace");
    // 零写入这件事商家也读得到 —— 他点了一条链接,屏幕要敢说「什么都没给你建」。
    expect(container.textContent).toContain("nothing was created for you");
  });

  it("FSE-207 — leaves two ways out instead of a dead end", () => {
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/create/canvas", "/create"]);
  });

  it("FSE-207 — never prints the id, the owner or any internal word at the merchant", () => {
    const text = (container.textContent ?? "").toLowerCase();
    for (const word of ["canvas_", "project", "ownerid", "tenant", "404", "error"]) {
      expect(text, `拒绝页说了内部词「${word}」`).not.toContain(word);
    }
  });
});
