import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeView, homeConnectionFromMeta, type HomeConnection } from "@/components/home/HomeView";
import { readOk, UNREADABLE, type HomeData } from "@/components/home/home-data";

const data: HomeData = {
  greeting: "Good morning, Nadia",
  credits: readOk("1,240 credits"),
  billingHref: "/settings?section=billing",
  billingLabel: "Billing & credits",
  canvases: readOk([]), thumbs: readOk([]), upcoming: readOk([]), campaigns: readOk([]), equipment: readOk([]),
};

function render(connection: HomeConnection, fixture = false) {
  return renderToStaticMarkup(createElement(HomeView, { data, connection, fixture }));
}

describe("R22 Data-first Home contract", () => {
  it("keeps sample-data language behind the explicit fixture prop", () => {
    expect(render({ kind: "not_connected" })).not.toContain("Prototype");
    expect(render({ kind: "not_connected" }, true)).toContain("Prototype · sample data");
  });

  it("does not turn an unreadable connection into disconnected or a connect CTA", () => {
    const markup = render({ kind: "unknown", message: "Read failed." });
    expect(markup).toContain("Connection status unavailable");
    expect(markup).not.toContain("Not connected");
    expect(markup).not.toContain('href="/api/meta/authorize"');
  });

  it("shows the provider-flow trigger only for a confirmed disconnected state", () => {
    const markup = render({ kind: "not_connected" });
    expect(markup).toContain("Connect your first channel");
    expect(markup).toContain("Connect</button>");
    expect(markup).not.toContain('href="/api/meta/authorize"');
  });

  it("shows performance numbers only in a verified visual fixture", () => {
    expect(render({ kind: "connected", accountLabel: "Meta account", transient: false })).not.toContain("48.2K");
    expect(render({ kind: "verified_fixture", accountLabel: "@batikhouse" }, true)).toContain("48.2K");
  });

  it("preserves Meta's unknown, disconnected, reconnect, and transient distinctions", () => {
    expect(homeConnectionFromMeta(UNREADABLE).kind).toBe("unknown");
    expect(homeConnectionFromMeta(readOk({ error: "load-failed" }))).toEqual({ kind: "unknown", message: "Connection status could not be read just now." });
    expect(homeConnectionFromMeta(readOk({ connected: false }))).toEqual({ kind: "not_connected" });
    expect(homeConnectionFromMeta(readOk({ connected: true, needsReconnect: true }))).toEqual({ kind: "needs_reconnect" });
    expect(homeConnectionFromMeta(readOk({ connected: true, transientError: true }))).toEqual({ kind: "connected", accountLabel: "Meta account", transient: true });
  });
});

/**
 * Home 收尾(Founder 2026-08-25 批的样张原始位置):步进器归位连接卡内一行。
 *
 * connect-first(未连 / 需要重连)态不再是两栏 grid、步进器占右栏 —— 卡收成单卡,步进器是
 * 卡内的一行,顺序是标题 → 渠道四行 → 步进器 → Skip for now。这里钉的是**结构**:步进器
 * 必须是连接卡这个 `<section>` 的后代,而且(disconnected 时)必须排在 Skip for now 之前。
 */
describe("connect-first:步进器归位连接卡内", () => {
  /** 从渲染出的 HTML 里把 `.r22-home-connect-card` 这个 section 的内容原样抠出来 —— 非贪婪
   *  匹配,停在它自己的第一个 `</section>`,不会吞掉后面 Performance/Analysis 那两个 section。*/
  function connectCardInner(markup: string): string {
    const match = /<section class="r22-home-connect-card[^"]*"[^>]*>([\s\S]*?)<\/section>/.exec(markup);
    expect(match, "连接卡 section 在渲染出的 markup 里找不到了").not.toBeNull();
    return match![1];
  }

  it("connect-first(未连):步进器是连接卡的后代,且排在 Skip for now 之前", () => {
    const markup = render({ kind: "not_connected" });
    const inner = connectCardInner(markup);
    const stepperIndex = inner.indexOf('class="r22-home-stepper"');
    const skipIndex = inner.indexOf('class="r22-home-skip"');
    expect(stepperIndex, "连接卡里找不到步进器").toBeGreaterThan(-1);
    expect(skipIndex, "连接卡里找不到 Skip for now").toBeGreaterThan(-1);
    expect(stepperIndex, "步进器没有排在 Skip for now 之前").toBeLessThan(skipIndex);
  });

  it("needs_reconnect:步进器同样是连接卡的后代(这一态没有 Skip for now,不参与排序断言)", () => {
    const inner = connectCardInner(render({ kind: "needs_reconnect" }));
    expect(inner, "连接卡里找不到步进器").toContain('class="r22-home-stepper"');
  });

  it("连接卡在 connect-first 态收成单卡(is-connect-first 修饰符生效)", () => {
    const markup = render({ kind: "not_connected" });
    expect(markup).toContain('class="r22-home-connect-card is-connect-first"');
  });

  it("ready 态不套 is-connect-first —— 右栏结构照旧不动", () => {
    const markup = render({ kind: "connected", accountLabel: "Meta account", transient: false });
    expect(markup).not.toContain("is-connect-first");
    expect(markup).toContain('class="r22-home-connect-card is-ready"');
  });
});
