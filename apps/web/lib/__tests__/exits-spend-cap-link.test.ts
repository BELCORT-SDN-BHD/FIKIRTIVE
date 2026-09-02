// @vitest-environment jsdom
/**
 * 上限出路句也要能点(2026-09-03 Founder 六面走查 D2,规格 docs/specs/frontend-baseline.md)。
 *
 * 走查在画布的拒绝提示里读到整句「Paused by your spend cap — this needs N credits and your cap
 * is M credits per action. Raise the cap in Billing & credits to run it.」,全句是死文字:商家
 * 已经决定要把上限调上去了,产品还是让他自己去找那一页。
 *
 * 这和 #979 那次「Top up in Billing.」不能点是同一个病 —— 渲染层
 * (`components/exits/Exits.tsx` 的 `ErrorWithTopUp`)当时只认了充值那一句常量。
 *
 * 三条钉板:
 *   ① 上限那一句渲染出真的能去 /billing 的元素,且**整句文案一字不改**(数字只有服务端知道,
 *      句子不能由渲染层重写);
 *   ② 充值那一句的行为一点没动(修一条不许碰坏另一条);
 *   ③ 不以这两句收尾的错误照旧原样渲染 —— 一条凭空的链接都不许长出来。
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ErrorWithTopUp } = await import("@/components/exits/Exits");
const {
  outOfCreditsMessage,
  spendCapBlockedMessage,
  SPEND_CAP_RAISE_CTA,
  SPEND_CAP_RAISE_HREF,
  TOP_UP_CTA,
} = await import("@/lib/credit-format");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function render(text: string): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(ErrorWithTopUp, { text })));
  return container;
}

describe("拒绝提示里的出路是一条真的能点的路", () => {
  it("上限拦下这一次时,给的是去 Billing & credits 的路,句子一字不改", async () => {
    const text = spendCapBlockedMessage(11, 5);
    const dom = await render(text);

    // 句子照旧 —— 数字、上限、措辞全是服务端那一份。
    expect(dom.textContent).toBe(text);
    const link = dom.querySelector<HTMLAnchorElement>(`a[href="${SPEND_CAP_RAISE_HREF}"]`);
    expect(link, "叫商家去把上限调上去,却没给他路").toBeTruthy();
    expect(link!.getAttribute("href")).toBe("/billing");
    expect(link!.textContent).toBe(SPEND_CAP_RAISE_CTA.replace(/\.$/, ""));
  });

  it("上限读不到那一支照旧是纯文字 —— 那时没有任何一页能改这一次的结果", async () => {
    const text = spendCapBlockedMessage(11, null);
    const dom = await render(text);

    expect(dom.textContent).toBe(text);
    expect(dom.querySelector("a")).toBeNull();
  });

  it("钱不够那一句的行为一点没动(#979)", async () => {
    const text = outOfCreditsMessage(4);
    const dom = await render(text);

    expect(dom.textContent).toBe(text);
    const link = dom.querySelector<HTMLAnchorElement>('a[href="/billing"]');
    expect(link, "钱不够那条老路被这次改动弄丢了").toBeTruthy();
    expect(link!.textContent).toBe(TOP_UP_CTA.replace(/\.$/, ""));
  });

  it("别的错误原样渲染,不凭空长出一条路", async () => {
    const text = "Couldn't reach the queue. Nothing was charged — try again in a moment.";
    const dom = await render(text);

    expect(dom.textContent).toBe(text);
    expect(dom.querySelector("a")).toBeNull();
  });
});
