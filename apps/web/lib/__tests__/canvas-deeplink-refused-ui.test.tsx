// @vitest-environment jsdom
/**
 * FSE-207 / FSE-207b 拒绝页自己 —— 商家真的看到了那句人话,以及两条走得通的出路。
 *
 * 规格 `docs/specs/creation-engine.md` §5(2026-09-11 登记行;Founder 2026-09-12 #1358 裁
 * 「零写入」为硬口径,本条升 P1)。复测句的第三件事是「必须有一句人话」—— 零写入与不改写
 * 地址由 `canvas-deeplink-cross-tenant-fse207.test.ts` / `canvas-deeplink-cross-tenant-
 * thread-fse207b.test.ts` 在真库上钉,这一份钉屏幕。
 *
 * 走查现场那一页什么都没说(空白新画布、零提示),所以这里连「不许说什么」一起钉:商家读
 * 到的句子里不许出现 project id、`ownerId`、tenant 这类内部词 —— 白标围栏与画布 error
 * boundary 同一把尺子。
 *
 * PR #1414 判官 P1-1:`?project=` 与 `?thread=` 两种深链共用这张页面,但说的不能是同一句
 * 话——商家自己的画布 P 配一条伪造/别家的 thread id,若沿用 project 那句
 * 「This canvas isn't in your workspace」,读出来是在指控他自己那张、确实在他 workspace
 * 里的画布。`project` 组钉默认渲染(不传 `variant`,向后兼容);`thread` 组钉传
 * `variant="thread"` 时说的是一条对话被拒,同样的两条出路、同样不区分「别家 / 已删」。
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

describe("FSE-207 跨租户画布深链的拒绝页(project 组,默认 variant)", () => {
  it("FSE-207 — says in plain words that the link is not in this workspace", () => {
    const heading = container.querySelector("h1");
    expect(heading?.textContent).toBe(CANVAS_DEEP_LINK_REFUSAL_COPY.project.heading);
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

describe("FSE-207b 跨租户 thread 深链的拒绝页(thread 组,判官 P1-1 修根,PR #1414)", () => {
  beforeEach(() => {
    act(() => root.render(createElement(CanvasDeepLinkRefused, { variant: "thread" })));
  });

  it("FSE-207b — says a conversation is refused, not the merchant's own canvas", () => {
    const heading = container.querySelector("h1");
    expect(heading?.textContent).toBe(CANVAS_DEEP_LINK_REFUSAL_COPY.thread.heading);
    expect(heading?.textContent).toBe("We can't open this conversation in your workspace");
    // 判官反例:不能沿用 project 那句 —— 那句指控的是商家自己那张、确实在他 workspace 里的画布。
    expect(heading?.textContent).not.toBe(CANVAS_DEEP_LINK_REFUSAL_COPY.project.heading);
    expect(container.textContent).toContain("This conversation belongs to a different workspace");
    expect(container.textContent).toContain("nothing was created for you");
  });

  it("FSE-207b — leaves the same two ways out", () => {
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/create/canvas", "/create"]);
  });

  it("FSE-207b — never prints the id, the owner or any internal word at the merchant", () => {
    const text = (container.textContent ?? "").toLowerCase();
    for (const word of ["thread_", "project", "ownerid", "tenant", "404", "error"]) {
      expect(text, `拒绝页说了内部词「${word}」`).not.toContain(word);
    }
  });
});
